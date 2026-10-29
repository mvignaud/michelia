// Fonction « annonces » : envoi des annonces du back-office et désabonnement des nouvelles.
// - POST d'un administrateur connecté : enregistre l'annonce, envoie les e-mails par Postal
//   (en tâche de fond) et réveille la fonction « push » si les notifications sont cochées.
// - POST avec ?u=…&t=… (bouton « Se désabonner » des messageries, RFC 8058)
//   ou { unsubscribe: "u.t" } (lien des e-mails, ouvert dans l'appli) : coupe les nouvelles.
// Déployée sans vérification du JWT : le droit d'administrateur est vérifié ici.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Audience = "news" | "service";
type Channel = "email" | "push";
type Recipient = { user_id: string; email: string; first_name: string | null };
type Message = { subject: string; body: string; audience: Audience };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POSTAL_API_URL = (Deno.env.get("POSTAL_API_URL") ?? "").replace(/\/+$/, "");
const POSTAL_API_KEY = Deno.env.get("POSTAL_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Michel (MichelIA) <noreply@michel.beer>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/+$/, "");
const UNSUBSCRIBE_SECRET = Deno.env.get("UNSUBSCRIBE_SECRET") ?? "";

// Envois simultanés vers Postal, et fréquence de mise à jour du compteur affiché.
const PARALLEL = 8;
const PROGRESS_EVERY = 50;

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

// Jeton de désabonnement : HMAC de l'identifiant, pour qu'on ne puisse pas désabonner quelqu'un d'autre.
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

async function unsubscribe(userId: string, token: string): Promise<boolean> {
  if (!UNSUBSCRIBE_SECRET || !/^[0-9a-f-]{36}$/.test(userId)) return false;
  const expected = await sign(userId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  if (diff !== 0) return false;
  const { error } = await db.from("profiles").update({ news_opt_in: false }).eq("id", userId);
  return !error;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// {prenom} dans le texte devient le prénom du membre (ou disparaît s'il n'en a pas).
// Le prénom est réduit aux lettres, pour qu'un membre ne glisse pas un lien dans l'objet ou le texte.
const personalize = (text: string, firstName: string | null) => {
  const name = (firstName ?? "").replace(/[^\p{L}\s'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
  return text.replace(/ ?\{prenom\}/g, name ? ` ${name}` : "");
};

function htmlBody(message: Message, firstName: string | null, unsubscribeUrl: string | null): string {
  const paragraphs = personalize(message.body, firstName)
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const why = unsubscribeUrl
    ? `Tu reçois ce message parce que tu as accepté les nouvelles de Michel.<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#A39586;">Ne plus recevoir les nouvelles</a>`
    : "Message d'information sur le service MichelIA, envoyé à tous les membres.";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(message.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FBF4E8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF4E8;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding-bottom:20px;">
<img src="${SITE_URL}/email/michel.png" width="72" height="72" alt="Michel" style="display:block;border:3px solid #D9A441;border-radius:50%;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;color:#2B2420;padding-top:10px;">MichelIA</div>
</td></tr>
<tr><td style="background:#FFFFFF;border-radius:16px;padding:28px 28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2B2420;">
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;"><tr><td style="background:#7A2E1D;border-radius:12px;">
<a href="${SITE_URL}" style="display:inline-block;padding:14px 26px;font-weight:bold;font-size:16px;color:#FFF8EE;text-decoration:none;">Causer avec Michel</a>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#A39586;">
${why}<br>
<a href="${SITE_URL}" style="color:#A39586;">michel.beer</a> · <a href="${SITE_URL}/confidentialite.html" style="color:#A39586;">Confidentialité</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

async function sendEmail(message: Message, to: Recipient): Promise<boolean> {
  let unsubscribeUrl: string | null = null;
  const headers: Record<string, string> = {};
  if (message.audience === "news") {
    const token = `${to.user_id}.${await sign(to.user_id)}`;
    unsubscribeUrl = `${SITE_URL}/?desabonnement=${token}`;
    const [u, t] = token.split(".");
    headers["List-Unsubscribe"] = `<${SUPABASE_URL}/functions/v1/annonces?u=${u}&t=${t}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const plain =
    personalize(message.body, to.first_name).trim() +
    `\n\n${SITE_URL}\n\n` +
    (unsubscribeUrl ? `Ne plus recevoir les nouvelles : ${unsubscribeUrl}` : "Message d'information sur le service MichelIA.");
  try {
    const response = await fetch(`${POSTAL_API_URL}/api/v1/send/message`, {
      method: "POST",
      headers: { "X-Server-API-Key": POSTAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [to.email],
        from: MAIL_FROM,
        subject: personalize(message.subject, to.first_name),
        plain_body: plain,
        html_body: htmlBody(message, to.first_name, unsubscribeUrl),
        tag: message.audience === "news" ? "nouvelles" : "service",
        headers,
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

// Envoie l'annonce aux destinataires qui ne l'ont pas encore reçue (chaque envoi est noté
// dans broadcast_deliveries), puis recompte. Relancée telle quelle pour reprendre un envoi coupé.
async function sendAll(id: number, message: Message, recipients: Recipient[]) {
  const { data: done } = await db.from("broadcast_deliveries").select("user_id").eq("broadcast_id", id).eq("ok", true);
  const already = new Set((done ?? []).map((d) => d.user_id));
  const todo = recipients.filter((r) => !already.has(r.user_id));
  let sent = already.size;
  let failed = 0;
  let next = 0;
  let handled = 0;

  async function worker() {
    while (next < todo.length) {
      const to = todo[next++];
      const ok = await sendEmail(message, to);
      if (ok) sent++;
      else failed++;
      await db.from("broadcast_deliveries").upsert({ broadcast_id: id, user_id: to.user_id, ok, sent_at: new Date().toISOString() });
      if (++handled % PROGRESS_EVERY === 0) {
        await db.from("broadcasts").update({ email_sent: sent, email_failed: failed }).eq("id", id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  await db
    .from("broadcasts")
    .update({
      email_total: recipients.length,
      email_sent: sent,
      email_failed: failed,
      email_status: failed === 0 ? "envoye" : sent === 0 ? "echec" : "partiel",
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// Une fonction Edge est coupée au bout de quelques minutes : passé ce délai, un envoi
// resté « en cours » est considéré comme interrompu et peut être repris.
const STALE_MINUTES = 7;

async function resume(id: number, origin: string | null): Promise<Response> {
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60000).toISOString();
  const { data: row } = await db
    .from("broadcasts")
    .update({ email_status: "envoi", email_started_at: new Date().toISOString(), finished_at: null })
    .eq("id", id)
    .contains("channels", ["email"])
    .or(`email_status.in.(partiel,echec),and(email_status.eq.envoi,email_started_at.lt.${staleBefore})`)
    .select("id, subject, body, audience")
    .maybeSingle();
  if (!row) return json(409, { error: "Cet envoi tourne encore ou est déjà terminé." }, origin);
  const { data, error } = await db.rpc("broadcast_recipients", { p_audience: row.audience });
  if (error) return json(500, { error: "Lecture des destinataires impossible." }, origin);
  const recipients: Recipient[] = data ?? [];
  EdgeRuntime.waitUntil(sendAll(row.id, row as Message, recipients));
  return json(200, { id: row.id, emails: recipients.length, resumed: true }, origin);
}

// Réveille la fonction « push » (fil des notifications) ; sans elle, l'annonce reste en attente.
async function wakePush() {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    });
  } catch (e) {
    console.error("Fonction push injoignable :", e);
  }
}

function parseMessage(body: Record<string, unknown>): (Message & { channels: Channel[]; test: boolean }) | string {
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const audience = body.audience;
  const channels = Array.isArray(body.channels) ? [...new Set(body.channels)] : [];
  if (!subject || subject.length > 150) return "Titre manquant ou trop long (150 caractères au plus).";
  if (!text || text.length > 10000) return "Texte manquant ou trop long (10 000 caractères au plus).";
  if (audience !== "news" && audience !== "service") return "Public inconnu.";
  if (!channels.length || channels.some((c) => c !== "email" && c !== "push")) return "Choisis e-mail et/ou notification.";
  return { subject, body: text, audience, channels: channels as Channel[], test: body.test === true };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "Méthode non permise." }, origin);

  // Désabonnement en un clic depuis la messagerie (Gmail, Apple Mail…).
  const url = new URL(req.url);
  const u = url.searchParams.get("u");
  const t = url.searchParams.get("t");
  if (u && t) {
    const ok = await unsubscribe(u, t);
    return json(ok ? 200 : 400, ok ? { ok } : { error: "Lien de désabonnement invalide." }, origin);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json(400, { error: "Requête illisible." }, origin);

  // Désabonnement depuis le lien de l'e-mail, ouvert dans l'appli.
  if (typeof body.unsubscribe === "string") {
    const [userId, token] = body.unsubscribe.split(".");
    const ok = !!userId && !!token && (await unsubscribe(userId, token));
    return json(ok ? 200 : 400, ok ? { ok } : { error: "Lien de désabonnement invalide." }, origin);
  }

  // Annonce : réservée aux administrateurs.
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const user = auth.user;
  if (!user) return json(401, { error: "Connecte-toi d'abord." }, origin);
  const { data: admin } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) return json(403, { error: "Réservé aux administrateurs." }, origin);

  if (typeof body.resume === "number") return resume(body.resume, origin);

  const message = parseMessage(body);
  if (typeof message === "string") return json(400, { error: message }, origin);

  const wantsEmail = message.channels.includes("email");
  if (wantsEmail && (!POSTAL_API_URL || !POSTAL_API_KEY || !UNSUBSCRIBE_SECRET)) {
    return json(500, { error: "Envoi d'e-mails pas configuré : secrets POSTAL_API_URL, POSTAL_API_KEY et UNSUBSCRIBE_SECRET." }, origin);
  }

  // Test : l'e-mail part seulement à l'administrateur, rien n'est enregistré.
  if (message.test) {
    if (!wantsEmail) return json(400, { error: "Le test se fait par e-mail." }, origin);
    if (!user.email) return json(400, { error: "Ton compte n'a pas d'e-mail pour recevoir le test." }, origin);
    const { data: profile } = await db.from("profiles").select("first_name").eq("id", user.id).maybeSingle();
    const ok = await sendEmail(message, { user_id: user.id, email: user.email, first_name: profile?.first_name ?? null });
    return ok
      ? json(200, { test: true, email: user.email }, origin)
      : json(502, { error: "Postal a refusé le test, voir les journaux de la fonction." }, origin);
  }

  // Double clic ou nouvel essai : la même annonce n'est pas renvoyée dans les dix minutes.
  const { data: twin } = await db
    .from("broadcasts")
    .select("id")
    .eq("subject", message.subject)
    .eq("body", message.body)
    .gt("created_at", new Date(Date.now() - 10 * 60000).toISOString())
    .limit(1)
    .maybeSingle();
  if (twin) return json(409, { error: "Cette annonce vient déjà de partir." }, origin);

  let recipients: Recipient[] = [];
  if (wantsEmail) {
    const { data, error } = await db.rpc("broadcast_recipients", { p_audience: message.audience });
    if (error) return json(500, { error: "Lecture des destinataires impossible." }, origin);
    recipients = data ?? [];
  }

  const wantsPush = message.channels.includes("push");
  const { data: row, error } = await db
    .from("broadcasts")
    .insert({
      subject: message.subject,
      body: message.body,
      audience: message.audience,
      channels: message.channels,
      created_by: user.id,
      email_status: wantsEmail ? (recipients.length ? "envoi" : "envoye") : null,
      email_total: recipients.length,
      email_started_at: wantsEmail ? new Date().toISOString() : null,
      push_status: wantsPush ? "en_attente" : null,
      finished_at: wantsEmail && recipients.length ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !row) return json(500, { error: "Enregistrement de l'annonce impossible." }, origin);

  await db.from("admin_audit").insert({
    admin_id: user.id,
    action: "broadcast",
    detail: { broadcast: row.id, audience: message.audience, channels: message.channels, recipients: recipients.length },
  });

  const work: Promise<unknown>[] = [];
  if (wantsEmail && recipients.length) work.push(sendAll(row.id, message, recipients));
  if (wantsPush) work.push(wakePush());
  if (work.length) EdgeRuntime.waitUntil(Promise.all(work));

  return json(200, { id: row.id, emails: recipients.length, push: wantsPush }, origin);
});
