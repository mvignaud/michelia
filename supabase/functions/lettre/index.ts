// Fonction « lettre » : la lettre de Michel, un e-mail tous les 15 jours aux membres qui ont
// accepté les nouvelles, avec les nouveautés du carnet parues depuis la lettre d'avant.
// - Appelée chaque matin par pg_cron (migration 20261029130000_lettre.sql) : écrit seulement
//   s'il y a du neuf, à partir de lettre_debut et au moins lettre_jours après la précédente.
//   Reprend aussi une lettre coupée par la limite de durée des fonctions.
// - POST { test: true } d'un administrateur connecté : la prochaine lettre part à lui seul,
//   sans rien enregistrer (bouton du back-office).
// Les nouveautés sont lues sur le site (nouveautes.json, généré par npm run build:web) :
// une entrée compte dès qu'elle est en ligne. Désabonnement : fonction « annonces ».
// Déployée sans vérification du JWT : l'appeler en trop ne fait rien de plus.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Entree = {
  date: string;
  titre: string;
  type: "nouveau" | "mieux" | "corrige";
  plateformes: string[];
  appli: boolean;
  build?: number;
  sansBuild?: boolean;
  texte: string;
};
type Recipient = { user_id: string; email: string; first_name: string | null };
type Lettre = { numero: number; date: Date; subject: string; entrees: Entree[]; autres: number; premiere: boolean };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POSTAL_API_URL = (Deno.env.get("POSTAL_API_URL") ?? "").replace(/\/+$/, "");
const POSTAL_API_KEY = Deno.env.get("POSTAL_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Michel (MichelIA) <noreply@michel.beer>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/+$/, "");
const UNSUBSCRIBE_SECRET = Deno.env.get("UNSUBSCRIBE_SECRET") ?? "";

// Nouveautés racontées en entier dans une lettre ; les autres renvoient au carnet.
const MAX_ENTREES = 6;
const PARALLEL = 8;
const PROGRESS_EVERY = 50;
// Passé ce délai, une lettre restée « en cours » a été coupée : on la reprend.
const STALE_MINUTES = 7;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((o) => o.trim());

function corsHeaders(origin: string | null): HeadersInit {
  const allow = allowedOrigins.includes("*")
    ? "*"
    : origin && allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, data: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

const paris = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", ...options }).format(date);
const parisDay = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

async function loadConfig(): Promise<Record<string, string>> {
  const { data, error } = await db.from("app_config").select("key, value").like("key", "lettre_%");
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.key, row.value]));
}

// Même jeton que la fonction « annonces », qui vérifie le désabonnement (même secret).
async function sign(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(UNSUBSCRIBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Le prénom est réduit aux lettres, pour qu'un membre ne glisse pas un lien dans l'e-mail.
const cleanName = (firstName: string | null) =>
  (firstName ?? "").replace(/[^\p{L}\s'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);

// --- Les nouveautés ---------------------------------------------------------------------

const cle = (e: Entree) => `${e.date}|${e.titre}`;

async function lireCarnet(): Promise<Entree[]> {
  const response = await fetch(`${SITE_URL}/nouveautes.json`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`nouveautes.json : HTTP ${response.status}`);
  // Sans le fichier, le site renvoie sa page d'accueil : ce n'est pas du JSON.
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) throw new Error("nouveautes.json illisible");
  return data.filter(
    (e): e is Entree =>
      typeof e?.date === "string" && typeof e?.titre === "string" && typeof e?.texte === "string" && typeof e?.type === "string",
  );
}

// Les nouveautés jamais racontées, les vraies nouveautés d'abord, puis les plus récentes.
async function nouvelles(): Promise<{ entrees: Entree[]; premiere: boolean; numero: number }> {
  const [carnet, { data: passees, error }] = await Promise.all([
    lireCarnet(),
    db.from("lettres").select("id, entrees").order("id", { ascending: false }),
  ]);
  if (error) throw error;
  const deja = new Set((passees ?? []).flatMap((l) => l.entrees as string[]));
  const rang = { nouveau: 0, mieux: 1, corrige: 2 } as Record<string, number>;
  const entrees = carnet
    .filter((e) => !deja.has(cle(e)))
    .sort((a, b) => (rang[a.type] ?? 3) - (rang[b.type] ?? 3) || b.date.localeCompare(a.date));
  return { entrees, premiere: !passees?.length, numero: (passees?.[0]?.id ?? 0) + 1 };
}

function composer(entrees: Entree[], premiere: boolean, numero: number): Lettre {
  const shown = entrees.slice(0, MAX_ENTREES);
  const autres = entrees.length - shown.length;
  const reste = entrees.length - 1;
  const subject = premiere
    ? "Adishatz ! La première lettre de Michel"
    : reste === 0
      ? `Du nouveau chez Michel : ${shown[0].titre}`
      : `Du nouveau chez Michel : ${shown[0].titre}, et ${reste} autre${reste > 1 ? "s" : ""} chose${reste > 1 ? "s" : ""}`;
  return { numero, date: new Date(), subject: subject.slice(0, 150), entrees: shown, autres, premiere };
}

// --- L'e-mail ---------------------------------------------------------------------------

const BRIQUE = "#7A2E1D";
const OCRE = "#D9A441";
const CREME = "#FBF4E8";
const ENCRE = "#2B2420";
const GRIS = "#A39586";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const TYPES: Record<string, { label: string; color: string }> = {
  nouveau: { label: "Nouveau", color: BRIQUE },
  mieux: { label: "En mieux", color: "#B07A1E" },
  corrige: { label: "Réparé", color: "#5E6B3A" },
};

const INTROS = [
  "Quinze jours ont passé, et on m'a encore bricolé de partout. Je te raconte, que tu sois pas le dernier au courant au marché.",
  "Me revoilà avec mes nouvelles. Ils ont encore touché à mes boulons, ces drôles. Voilà ce qui a changé, et c'est pas rien, con.",
  "Le temps qu'un confit refroidisse, j'ai appris des choses. Tire une chaise, je t'explique.",
  "Je sais, tu m'attendais. Voilà les nouvelles fraîches, cueillies ce matin comme les cèpes.",
];
const PREMIERE =
  "C'est ma première lettre, alors sois indulgent : à mon âge, j'écris plus guère qu'au percepteur. Tous les quinze jours, je te dirai ce qui change chez moi, et seulement s'il y a du neuf. Pour commencer, voilà ce que je sais faire.";
const PS = [
  "P.-S. : pense à boire de l'eau. Ou une Burosse, avec modération, con.",
  "P.-S. : si tu as un copain qui cause tout seul devant son écran, envoie-le-moi, ça lui fera de la compagnie.",
  "P.-S. : la garbure, c'est meilleur réchauffé. Moi aussi, d'ailleurs.",
  "P.-S. : chez nous on dit chocolatine, et ça se discute pas.",
  "P.-S. : si la lettre t'a plu, fais-la suivre. Si elle t'a pas plu, fais-la suivre quand même, ça m'occupe.",
];

const pick = <T,>(list: T[], n: number) => list[n % list.length];

function disponibilite(e: Entree): string {
  const site = e.plateformes?.includes("web");
  if (!e.appli) return "Sur le site";
  if (e.sansBuild) return site ? "Sur le site et dans les applis" : "Dans les applis";
  if (e.build) return `Dans les applis${site ? " et sur le site" : ""}`;
  return `Déjà sur le site, bientôt dans les applis`;
}

// Le Markdown réduit du carnet : paragraphes, listes « - », **gras**, *italique*, [lien](…).
function enLigne(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_, text, href) =>
      `<a href="${href.startsWith("/") ? SITE_URL + href : href}" style="color:${BRIQUE};">${text}</a>`
    );
}
function versHtml(md: string): string {
  return md
    .trim()
    .split(/\n{2,}/)
    .map((bloc) => {
      const lignes = bloc.split("\n");
      if (lignes.every((l) => /^- /.test(l)))
        return `<ul style="margin:0 0 12px;padding-left:20px;">${lignes.map((l) => `<li>${enLigne(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p style="margin:0 0 12px;">${enLigne(lignes.join(" "))}</p>`;
    })
    .join("\n");
}
const enTexte = (md: string) =>
  md.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) =>
    `${t} (${h.startsWith("/") ? SITE_URL + h : h})`
  );

function carte(e: Entree): string {
  const type = TYPES[e.type] ?? TYPES.nouveau;
  return `<tr><td style="padding:0 0 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREME};border-radius:12px;border-left:5px solid ${type.color};">
<tr><td style="padding:16px 18px 6px;font-family:${SANS};font-size:15px;line-height:1.55;color:${ENCRE};">
<span style="display:inline-block;background:${type.color};color:#FFF8EE;font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;border-radius:6px;padding:3px 8px;">${type.label}</span>
<div style="font-family:${SERIF};font-size:19px;font-weight:bold;color:${ENCRE};padding:8px 0 8px;">${enLigne(e.titre)}</div>
${versHtml(e.texte)}
<p style="margin:0 0 10px;font-size:12px;color:${GRIS};">${disponibilite(e)}</p>
</td></tr>
</table>
</td></tr>`;
}

function htmlBody(l: Lettre, firstName: string | null, unsubscribeUrl: string): string {
  const name = cleanName(firstName);
  const date = paris(l.date, { day: "numeric", month: "long", year: "numeric" });
  const intro = l.premiere ? PREMIERE : pick(INTROS, l.numero);
  const carnet = `${SITE_URL}/confit-de-canard`;
  const autres = l.autres
    ? `<p style="margin:0 0 16px;">Et ${l.autres} autre${l.autres > 1 ? "s" : ""} petite${l.autres > 1 ? "s" : ""} chose${l.autres > 1 ? "s" : ""} que je te laisse lire <a href="${carnet}" style="color:${BRIQUE};font-weight:bold;">dans mon carnet</a>, sinon on y est encore à la Saint-Martin.</p>`
    : "";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(l.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${CREME};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(l.entrees.map((e) => e.titre).join(" · "))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREME};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td align="center" style="padding-bottom:18px;">
<img src="${SITE_URL}/email/michel.png" width="80" height="80" alt="Michel" style="display:block;border:3px solid ${OCRE};border-radius:50%;">
<div style="font-family:${SERIF};font-size:28px;font-weight:bold;color:${BRIQUE};padding-top:12px;">La lettre de Michel</div>
<div style="font-family:${SANS};font-size:13px;color:${GRIS};padding-top:4px;">N° ${l.numero} · ${date} · tout droit du Gers</div>
</td></tr>
<tr><td style="background:#FFFFFF;border-radius:16px;border-top:5px solid ${OCRE};padding:28px 24px 22px;font-family:${SANS};font-size:16px;line-height:1.6;color:${ENCRE};">
<p style="margin:0 0 12px;font-family:${SERIF};font-size:20px;font-weight:bold;">Adishatz${name ? ` ${escapeHtml(name)}` : ""} !</p>
<p style="margin:0 0 22px;">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${l.entrees.map(carte).join("\n")}
</table>
${autres}
<p style="margin:8px 0 4px;">Allez, porte-toi bien, et à dans quinze jours.</p>
<p style="margin:0 0 18px;font-family:${SERIF};font-size:20px;font-style:italic;color:${BRIQUE};">Michel</p>
<p style="margin:0 0 22px;font-size:14px;color:#6B5E52;">${escapeHtml(pick(PS, l.numero))}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${BRIQUE};border-radius:12px;">
<a href="${SITE_URL}" style="display:inline-block;padding:14px 26px;font-weight:bold;font-size:16px;color:#FFF8EE;text-decoration:none;">Causer avec Michel</a>
</td></tr></table>
<p style="margin:14px 0 0;font-size:14px;"><a href="${carnet}" style="color:${BRIQUE};">Tout le carnet des nouveautés</a></p>
</td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${GRIS};">
Tu reçois cette lettre parce que tu as accepté les nouvelles de Michel, tous les quinze jours au plus.<br>
<a href="${escapeHtml(unsubscribeUrl)}" style="color:${GRIS};">Ne plus recevoir les nouvelles</a><br>
<a href="${SITE_URL}" style="color:${GRIS};">michel.beer</a> · <a href="${SITE_URL}/confidentialite.html" style="color:${GRIS};">Confidentialité</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function plainBody(l: Lettre, firstName: string | null, unsubscribeUrl: string): string {
  const name = cleanName(firstName);
  const parts = [
    `Adishatz${name ? ` ${name}` : ""} !`,
    l.premiere ? PREMIERE : pick(INTROS, l.numero),
    ...l.entrees.map((e) => `* ${(TYPES[e.type] ?? TYPES.nouveau).label} : ${e.titre}\n${enTexte(e.texte)}`),
    l.autres ? `Et ${l.autres} autre(s) chose(s) dans mon carnet : ${SITE_URL}/confit-de-canard` : "",
    "Allez, porte-toi bien, et à dans quinze jours.\nMichel",
    pick(PS, l.numero),
    `Causer avec Michel : ${SITE_URL}`,
    `Ne plus recevoir les nouvelles : ${unsubscribeUrl}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

async function sendEmail(l: Lettre, to: Recipient): Promise<boolean> {
  const token = `${to.user_id}.${await sign(to.user_id)}`;
  const unsubscribeUrl = `${SITE_URL}/?desabonnement=${token}`;
  const [u, t] = token.split(".");
  try {
    const response = await fetch(`${POSTAL_API_URL}/api/v1/send/message`, {
      method: "POST",
      headers: { "X-Server-API-Key": POSTAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [to.email],
        from: MAIL_FROM,
        subject: l.subject,
        plain_body: plainBody(l, to.first_name, unsubscribeUrl),
        html_body: htmlBody(l, to.first_name, unsubscribeUrl),
        tag: "lettre",
        headers: {
          "List-Unsubscribe": `<${SUPABASE_URL}/functions/v1/annonces?u=${u}&t=${t}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== "success") {
      console.error("Postal refuse l'envoi :", response.status, JSON.stringify(result?.data ?? result));
      return false;
    }
    return true;
  } catch (e) {
    console.error("Postal injoignable :", e);
    return false;
  }
}

// --- L'envoi ----------------------------------------------------------------------------

// Écrit à ceux qui n'ont pas encore reçu la lettre (chaque envoi est noté dans lettre_envois),
// puis recompte. Relancée telle quelle pour reprendre une lettre coupée.
async function sendAll(id: number, l: Lettre) {
  const { data, error } = await db.rpc("broadcast_recipients", { p_audience: "news" });
  if (error) {
    console.error("Lecture des destinataires impossible :", error);
    await db.from("lettres").update({ email_status: "echec", finished_at: new Date().toISOString() }).eq("id", id);
    return;
  }
  const recipients: Recipient[] = data ?? [];
  const { data: done } = await db.from("lettre_envois").select("user_id").eq("lettre_id", id).eq("ok", true);
  const already = new Set((done ?? []).map((d) => d.user_id));
  const todo = recipients.filter((r) => !already.has(r.user_id));
  await db.from("lettres").update({ email_total: recipients.length }).eq("id", id);
  let sent = already.size;
  let failed = 0;
  let next = 0;
  let handled = 0;

  async function worker() {
    while (next < todo.length) {
      const to = todo[next++];
      const ok = await sendEmail(l, to);
      if (ok) sent++;
      else failed++;
      await db.from("lettre_envois").upsert({ lettre_id: id, user_id: to.user_id, ok, sent_at: new Date().toISOString() });
      if (++handled % PROGRESS_EVERY === 0) {
        await db.from("lettres").update({ email_sent: sent, email_failed: failed }).eq("id", id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  await db
    .from("lettres")
    .update({
      email_sent: sent,
      email_failed: failed,
      email_status: failed === 0 ? "envoye" : sent === 0 ? "echec" : "partiel",
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// Rebâtit une lettre déjà réservée à partir des clés enregistrées (pour une reprise).
async function rebuild(row: { id: number; created_at: string; subject: string; entrees: string[] }): Promise<Lettre> {
  const carnet = await lireCarnet();
  const keys = new Set(row.entrees);
  const { count } = await db.from("lettres").select("id", { count: "exact", head: true }).lt("id", row.id);
  const lettre = composer(carnet.filter((e) => keys.has(cle(e))), !count, row.id);
  return { ...lettre, subject: row.subject, date: new Date(row.created_at) };
}

const configured = () => !!(POSTAL_API_URL && POSTAL_API_KEY && UNSUBSCRIBE_SECRET);

async function tick(origin: string | null): Promise<Response> {
  const config = await loadConfig();
  if (config.lettre_enabled !== "true") return json(200, { skipped: "lettre_enabled" }, origin);
  if (!configured()) return json(500, { error: "Secrets POSTAL_API_URL, POSTAL_API_KEY et UNSUBSCRIBE_SECRET manquants." }, origin);

  // Une lettre coupée en route : on la termine avant toute chose.
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60000).toISOString();
  const { data: stale } = await db
    .from("lettres")
    .update({ email_started_at: new Date().toISOString() })
    .eq("email_status", "envoi")
    .lt("email_started_at", staleBefore)
    .select("id, created_at, subject, entrees")
    .limit(1)
    .maybeSingle();
  if (stale) {
    EdgeRuntime.waitUntil(rebuild(stale).then((l) => sendAll(stale.id, l)).catch((e) => console.error("Reprise :", e)));
    return json(200, { resumed: stale.id }, origin);
  }

  const today = parisDay(new Date());
  if (config.lettre_debut && today < config.lettre_debut) return json(200, { skipped: "lettre_debut" }, origin);

  const { entrees, premiere, numero } = await nouvelles();
  if (!entrees.length) return json(200, { skipped: "rien de neuf" }, origin);

  const jours = Math.max(1, Number(config.lettre_jours) || 15);
  const lettre = composer(entrees, premiere, numero);
  const { data: id, error } = await db.rpc("reserver_lettre", {
    p_jours: jours,
    p_subject: lettre.subject,
    p_entrees: entrees.map(cle),
  });
  if (error) throw error;
  if (!id) return json(200, { skipped: "trop tôt" }, origin);

  EdgeRuntime.waitUntil(sendAll(id, { ...lettre, numero: id }));
  return json(200, { id, entrees: entrees.length }, origin);
}

// La prochaine lettre, envoyée au seul administrateur qui la demande.
async function test(req: Request, origin: string | null): Promise<Response> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const user = auth.user;
  if (!user) return json(401, { error: "Connecte-toi d'abord." }, origin);
  const { data: admin } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) return json(403, { error: "Réservé aux administrateurs." }, origin);
  if (!configured()) return json(500, { error: "Secrets POSTAL_API_URL, POSTAL_API_KEY et UNSUBSCRIBE_SECRET manquants." }, origin);
  if (!user.email) return json(400, { error: "Ton compte n'a pas d'e-mail pour recevoir le test." }, origin);

  const { entrees, premiere, numero } = await nouvelles();
  if (!entrees.length) return json(200, { test: true, entrees: 0 }, origin);
  const lettre = composer(entrees, premiere, numero);
  const { data: profile } = await db.from("profiles").select("first_name").eq("id", user.id).maybeSingle();
  const ok = await sendEmail({ ...lettre, subject: `[Test] ${lettre.subject}` }, {
    user_id: user.id,
    email: user.email,
    first_name: profile?.first_name ?? null,
  });
  return ok
    ? json(200, { test: true, email: user.email, entrees: entrees.length }, origin)
    : json(502, { error: "Postal a refusé le test, voir les journaux de la fonction." }, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." }, origin);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> | null;
  try {
    return body?.test === true ? await test(req, origin) : await tick(origin);
  } catch (e) {
    console.error("Lettre :", e);
    return json(500, { error: "La lettre a planté, voir les journaux de la fonction." }, origin);
  }
});
