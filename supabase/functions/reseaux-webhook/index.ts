// Fonction « reseaux-webhook » : Meta la prévient quand quelqu'un tague @michel.beer.32 sur Instagram,
// dans un commentaire ou dans la légende d'une publication d'un autre compte, et Michel répond.
// - Abonnement : produit Instagram de l'appli Meta, champ « mentions » (docs/REPONSES-RESEAUX.md).
// - GET : vérification de l'adresse par Meta (hub.verify_token = secret META_WEBHOOK_VERIFY_TOKEN).
// - POST : chaque envoi est signé (X-Hub-Signature-256, HMAC SHA-256 avec META_APP_SECRET) ; sans
//   signature valide, rien n'est lu. La fonction répond 200 tout de suite et travaille ensuite.
// - Mêmes garde-fous que « reseaux » : une seule réponse par mention (public.reponses_reseaux),
//   reseaux_max_auteur_jour par personne et par jour, mentions plus vieilles que reseaux_fenetre_heures
//   ignorées, silence devant les insultes et le spam, alerte à Mathieu pour ce qui demande un humain.
// - Coupée par app_config.reseaux_reponses_actif = 'false' ou reseaux_mentions = 'false'.
// Déployée sans vérification du JWT : Meta n'en a pas, l'authenticité vient de la signature.
import {
  APP_SECRET,
  auteurAuPlafond,
  finir,
  graph,
  GraphErreur,
  alerteJeton,
  hmacHex,
  json,
  lirePage,
  loadConfig,
  nombre,
  PAGE_TOKEN,
  reserver,
  traiter,
  versionGraph,
} from "../_shared/reseaux.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";

type Changement = { field?: string; value?: { media_id?: string; comment_id?: string } };
type Envoi = { object?: string; entry?: { id?: string; changes?: Changement[] }[] };

type Mentionne = {
  id: string;
  texte: string;
  date: string | null;
  auteur: string | null;
  media_id: string;
  publication: string;
  mention: "commentaire" | "legende";
};

// Comparaison en temps constant, pour ne rien laisser deviner de la signature attendue.
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Ce que dit la mention : le commentaire (et la publication dessous) ou la légende de la publication.
async function lireMention(version: string, igId: string, v: { media_id: string; comment_id?: string }): Promise<Mentionne> {
  if (v.comment_id) {
    const r = await graph<{ mentioned_comment?: { id: string; text?: string; timestamp?: string; username?: string; media?: { id: string; caption?: string } } }>(
      version,
      igId,
      { fields: `mentioned_comment.comment_id(${v.comment_id}){id,text,timestamp,username,media{id,caption}}` },
    );
    const c = r.mentioned_comment;
    return {
      id: `mention:${v.comment_id}`,
      texte: c?.text ?? "",
      date: c?.timestamp ?? null,
      auteur: c?.username ?? null,
      media_id: c?.media?.id ?? v.media_id,
      publication: c?.media?.caption ?? "",
      mention: "commentaire",
    };
  }
  const r = await graph<{ mentioned_media?: { id: string; caption?: string; timestamp?: string; username?: string } }>(
    version,
    igId,
    { fields: `mentioned_media.media_id(${v.media_id}){id,caption,timestamp,username}` },
  );
  const m = r.mentioned_media;
  return {
    id: `mention:media:${v.media_id}`,
    texte: m?.caption ?? "",
    date: m?.timestamp ?? null,
    auteur: m?.username ?? null,
    media_id: v.media_id,
    publication: "",
    mention: "legende",
  };
}

async function traiterEnvoi(envoi: Envoi) {
  const config = await loadConfig();
  if (config.reseaux_reponses_actif !== "true" || config.reseaux_mentions === "false" || !PAGE_TOKEN) return;
  const version = versionGraph(config);
  const fenetre = nombre(config.reseaux_fenetre_heures, 72);
  const maxAuteur = nombre(config.reseaux_max_auteur_jour, 3);

  let ig: { id: string; username?: string } | undefined;
  try {
    ig = (await lirePage(version)).instagram_business_account;
  } catch (e) {
    if (e instanceof GraphErreur && e.jetonCasse) await alerteJeton(e.message);
    console.error("reseaux-webhook", e);
    return;
  }
  if (!ig) return;

  for (const entree of envoi.entry ?? []) {
    // Un envoi qui ne concerne pas le compte de Michel ne nous regarde pas.
    if (entree.id && entree.id !== ig.id) continue;
    for (const ch of entree.changes ?? []) {
      const v = ch.value;
      if (ch.field !== "mentions" || !v?.media_id) continue;
      let m: Mentionne;
      try {
        m = await lireMention(version, ig.id, { media_id: v.media_id, comment_id: v.comment_id });
      } catch (e) {
        if (e instanceof GraphErreur && e.jetonCasse) await alerteJeton(e.message);
        console.error("mention", e);
        continue;
      }
      if (!m.texte.trim() || (ig.username && m.auteur === ig.username)) continue;
      if (m.date && Date.parse(m.date) < Date.now() - fenetre * 3600_000) continue;
      if (m.auteur && await auteurAuPlafond("instagram", m.auteur, maxAuteur)) continue;

      const pris = await reserver({
        reseau: "instagram",
        commentaire_id: m.id,
        publication_id: m.media_id,
        auteur_id: m.auteur,
        auteur: m.auteur,
        commentaire: m.texte,
        commente_at: m.date,
      });
      if (!pris) continue;
      const r = await traiter(
        m.id,
        { reseau: "instagram", publication: m.publication, auteur: m.auteur, texte: m.texte, mention: m.mention },
        config,
        async (texte) => {
          const params: Record<string, string> = { media_id: m.media_id, message: texte };
          if (v.comment_id) params.comment_id = v.comment_id;
          return (await graph<{ id?: string }>(version, `${ig!.id}/mentions`, params, "POST")).id ?? null;
        },
        { publication_id: m.media_id, mention: true },
      );
      // Meta ne renverra pas cette mention : une réservation rendue serait perdue. On la garde en échec,
      // avec la raison, pour que Mathieu la voie dans le journal.
      if (r.issue === "plus_tard") {
        await reserver({ reseau: "instagram", commentaire_id: m.id, publication_id: m.media_id, auteur_id: m.auteur, auteur: m.auteur, commentaire: m.texte, commente_at: m.date });
        await finir(m.id, { statut: "echec", raison: r.erreur ?? "plus tard" });
      }
      if (r.jetonCasse) return;
    }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // Vérification de l'adresse, une fois, quand Mathieu enregistre le webhook chez Meta.
    const ok = VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" &&
      egal(url.searchParams.get("hub.verify_token") ?? "", VERIFY_TOKEN);
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Interdit", { status: 403 });
  }
  if (req.method !== "POST") return json(405, { error: "GET ou POST seulement" });
  if (!APP_SECRET) return json(500, { error: "META_APP_SECRET manquant" });

  const brut = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!egal(signature, `sha256=${await hmacHex(APP_SECRET, brut)}`)) return json(401, { error: "signature" });

  let envoi: Envoi;
  try {
    envoi = JSON.parse(brut);
  } catch {
    return json(400, { error: "JSON" });
  }
  // Meta veut sa réponse vite : le travail continue après.
  if (envoi.object === "instagram") EdgeRuntime.waitUntil(traiterEnvoi(envoi).catch((e) => console.error("reseaux-webhook", e)));
  return json(200, { ok: true });
});
