// Fonction « reseaux-webhook » : Meta la prévient quand quelqu'un tague @michel.beer.32 sur Instagram
// (dans un commentaire ou dans la légende d'une publication d'un autre compte), ou écrit à Michel en
// message privé sur Messenger ou Instagram, et Michel répond.
// - Abonnements (docs/REPONSES-RESEAUX.md) : produit Instagram, champs « mentions » et « messages » ;
//   produit Page (Messenger), champs « messages » et « message_echoes ».
// - GET : vérification de l'adresse par Meta (hub.verify_token = secret META_WEBHOOK_VERIFY_TOKEN).
// - POST : chaque envoi est signé (X-Hub-Signature-256, HMAC SHA-256 avec META_APP_SECRET) ; sans
//   signature valide, rien n'est lu. La fonction répond 200 tout de suite et travaille ensuite.
// - Mêmes garde-fous que « reseaux » : une seule réponse par mention (public.reponses_reseaux),
//   reseaux_max_auteur_jour par personne et par jour, mentions plus vieilles que reseaux_fenetre_heures
//   ignorées, silence devant les insultes et le spam, alerte à Mathieu pour ce qui demande un humain.
// - Messages privés : Michel répond dans les 24 heures (règle de Meta), avec ce qui s'est dit avant ; des
//   messages envoyés coup sur coup reçoivent une seule réponse ; il se retire de la conversation pour
//   reseaux_messages_pause_heures dès que Mathieu y répond à la main ou qu'il lui a passé la main ; au plus
//   reseaux_messages_max_jour réponses par personne et par jour.
// - Coupée par app_config.reseaux_reponses_actif = 'false' ; reseaux_mentions = 'false' coupe les mentions,
//   reseaux_messages = 'false' les messages privés, reseaux_facebook / reseaux_instagram un réseau.
// Déployée sans vérification du JWT : Meta n'en a pas, l'authenticité vient de la signature.
import {
  admin,
  APP_SECRET,
  auteurAuPlafond,
  finir,
  graph,
  GraphErreur,
  alerteJeton,
  hmacHex,
  json,
  lirePage,
  type Page,
  type Reservation,
  type Reseau,
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
type Evenement = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; is_unsupported?: boolean };
};
type Envoi = { object?: string; entry?: { id?: string; changes?: Changement[]; messaging?: Evenement[] }[] };

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// Une mention Instagram : Michel passe dire un mot sous le commentaire ou la publication.
async function traiterMention(version: string, ig: { id: string; username?: string }, v: { media_id: string; comment_id?: string }, config: Record<string, string>): Promise<boolean> {
  const fenetre = nombre(config.reseaux_fenetre_heures, 72);
  const maxAuteur = nombre(config.reseaux_max_auteur_jour, 3);
  let m: Mentionne;
  try {
    m = await lireMention(version, ig.id, v);
  } catch (e) {
    if (e instanceof GraphErreur && e.jetonCasse) await alerteJeton(e.message);
    console.error("mention", e);
    return true;
  }
  if (!m.texte.trim() || (ig.username && m.auteur === ig.username)) return true;
  if (m.date && Date.parse(m.date) < Date.now() - fenetre * 3600_000) return true;
  if (m.auteur && await auteurAuPlafond("instagram", m.auteur, maxAuteur)) return true;

  const reservation = {
    reseau: "instagram" as const,
    commentaire_id: m.id,
    publication_id: m.media_id,
    auteur_id: m.auteur,
    auteur: m.auteur,
    commentaire: m.texte,
    commente_at: m.date,
  };
  if (!await reserver(reservation)) return true;
  const r = await traiter(
    m.id,
    { reseau: "instagram", publication: m.publication, auteur: m.auteur, texte: m.texte, mention: m.mention },
    config,
    async (texte) => {
      const params: Record<string, string> = { media_id: m.media_id, message: texte };
      if (v.comment_id) params.comment_id = v.comment_id;
      return (await graph<{ id?: string }>(version, `${ig.id}/mentions`, params, "POST")).id ?? null;
    },
    { publication_id: m.media_id, mention: true },
  );
  await garderEnEchec(r, reservation);
  return !r.jetonCasse;
}

// Meta ne renvoie ni une mention ni un message déjà reçus : une réservation rendue (Claude ou Meta
// indisponibles) serait perdue. On la garde en échec, avec la raison, pour que Mathieu la voie au journal.
async function garderEnEchec(r: { issue: string; erreur?: string }, reservation: Reservation) {
  if (r.issue !== "plus_tard") return;
  await reserver(reservation);
  await finir(reservation.commentaire_id, { statut: "echec", raison: r.erreur ?? "plus tard" });
}

// Le prénom (Messenger) ou le pseudo (Instagram) de la personne, si Meta veut bien le dire.
async function nomDe(version: string, reseau: Reseau, id: string): Promise<string | null> {
  try {
    const r = await graph<{ first_name?: string; name?: string; username?: string }>(
      version,
      id,
      { fields: reseau === "facebook" ? "first_name" : "name,username" },
    );
    return r.first_name ?? r.name ?? r.username ?? null;
  } catch {
    return null;
  }
}

// Un message privé, reçu par Michel (ou envoyé depuis son compte : un « écho »).
async function traiterMessage(version: string, reseau: Reseau, soi: string, ev: Evenement, config: Record<string, string>): Promise<boolean> {
  const msg = ev.message;
  if (!msg?.mid || msg.is_deleted || msg.is_unsupported) return true;
  // La personne, de l'autre côté de la conversation.
  const personne = msg.is_echo ? ev.recipient?.id : ev.sender?.id;
  if (!personne || personne === soi) return true;
  const conversation = `dm:${personne}`;

  if (msg.is_echo) {
    // L'écho d'une réponse de Michel arrive parfois avant qu'il l'ait notée : tant qu'il a un message en
    // cours de traitement dans cette conversation, on attend (une minute au plus). Sinon c'est Mathieu.
    for (let essai = 0; essai < 20; essai++) {
      const { data: nous } = await admin.from("reponses_reseaux").select("id").eq("reponse_id", msg.mid).limit(1);
      if (nous?.length) return true;
      const { data: enCours } = await admin.from("reponses_reseaux").select("id")
        .eq("reseau", reseau).eq("auteur_id", conversation).eq("statut", "en_cours")
        .not("commentaire_id", "like", "dm:mathieu:%").limit(1);
      if (!enCours?.length) break;
      await attendre(3000);
    }
    // Personne d'autre que Michel ou Mathieu n'écrit depuis le compte : c'est Mathieu, Michel se retire.
    await reserver({
      reseau,
      commentaire_id: `dm:mathieu:${msg.mid}`,
      publication_id: null,
      auteur_id: conversation,
      auteur: null,
      commentaire: msg.text ?? "",
      commente_at: ev.timestamp ? new Date(ev.timestamp).toISOString() : null,
    });
    await finir(`dm:mathieu:${msg.mid}`, { statut: "silence", raison: "Mathieu a répondu à la main" });
    return true;
  }

  const texte = msg.text?.trim() ?? "";
  // Photo, vocal, autocollant sans texte : rien à dire.
  if (!texte) return true;
  const quand = ev.timestamp ?? Date.now();
  // Meta ne permet de répondre que dans les 24 heures.
  if (quand < Date.now() - 23 * 3600_000) return true;

  // Mathieu a repris la conversation, ou Michel la lui a passée : on ne s'en mêle plus pendant un moment.
  // Vérifié à l'arrivée du message, puis encore juste avant d'envoyer la réponse.
  const pauseHeures = nombre(config.reseaux_messages_pause_heures, 24);
  const repris = async () => {
    const { data } = await admin.from("reponses_reseaux").select("commentaire_id, statut")
      .eq("reseau", reseau).eq("auteur_id", conversation)
      .gte("created_at", new Date(Date.now() - pauseHeures * 3600_000).toISOString());
    return (data ?? []).some((l) => l.statut === "mathieu" || l.commentaire_id.startsWith("dm:mathieu:"))
      ? "Mathieu a repris la conversation"
      : null;
  };
  if (await repris()) return true;
  if (await auteurAuPlafond(reseau, conversation, nombre(config.reseaux_messages_max_jour, 20))) return true;

  const id = `dm:${msg.mid}`;
  const auteur = await nomDe(version, reseau, personne);
  const reservation = {
    reseau,
    commentaire_id: id,
    publication_id: null,
    auteur_id: conversation,
    auteur,
    commentaire: texte,
    commente_at: new Date(quand).toISOString(),
  };
  if (!await reserver(reservation)) return true;

  // Des messages envoyés coup sur coup : on attend un peu, et seul le dernier reçoit une réponse (qui voit
  // les précédents dans l'historique). L'ordre : l'heure du message, puis l'ordre d'arrivée en base.
  await attendre(8000);
  const { data: lignes } = await admin.from("reponses_reseaux").select("id, commentaire_id, commente_at, commentaire, reponse, statut")
    .eq("reseau", reseau).eq("auteur_id", conversation).like("commentaire_id", "dm:%")
    .not("commentaire_id", "like", "dm:mathieu:%")
    .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  const rang = (l: { id: number; commente_at: string | null }) => [Date.parse(l.commente_at ?? "") || 0, l.id];
  const avantQue = (a: number[], b: number[]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const conv = (lignes ?? []).slice().sort((a, b) => (avantQue(rang(a), rang(b)) ? -1 : 1));
  const moi = conv.find((l) => l.commentaire_id === id);
  if (!moi) return true;
  if (conv.some((l) => avantQue(rang(moi), rang(l)))) {
    await finir(id, { statut: "silence", raison: "regroupé avec le message suivant" });
    return true;
  }

  // Ce qui s'est dit dans les dernières 24 heures, dans l'ordre.
  const historique: { de: "personne" | "michel"; texte: string }[] = [];
  for (const l of conv.filter((l) => l !== moi).slice(-12)) {
    if (l.commentaire) historique.push({ de: "personne", texte: l.commentaire });
    if (l.statut === "repondu" && l.reponse) historique.push({ de: "michel", texte: l.reponse });
  }

  const r = await traiter(
    id,
    { reseau, publication: "", auteur, texte, message: { historique } },
    config,
    async (reponse) =>
      (await graph<{ message_id?: string }>(version, "me/messages", {
        recipient: JSON.stringify({ id: personne }),
        messaging_type: "RESPONSE",
        message: JSON.stringify({ text: reponse }),
      }, "POST")).message_id ?? null,
    { message: true },
    repris,
  );
  await garderEnEchec(r, reservation);
  return !r.jetonCasse;
}

async function traiterEnvoi(envoi: Envoi) {
  const config = await loadConfig();
  if (config.reseaux_reponses_actif !== "true" || !PAGE_TOKEN) return;
  const version = versionGraph(config);

  let page: Page;
  try {
    page = await lirePage(version);
  } catch (e) {
    if (e instanceof GraphErreur && e.jetonCasse) await alerteJeton(e.message);
    console.error("reseaux-webhook", e);
    return;
  }
  const ig = page.instagram_business_account;
  const reseau: Reseau = envoi.object === "page" ? "facebook" : "instagram";
  const soi = reseau === "facebook" ? page.id : ig?.id;
  if (!soi) return;
  const messagesActifs = config.reseaux_messages !== "false" && config[`reseaux_${reseau}`] !== "false";

  for (const entree of envoi.entry ?? []) {
    // Un envoi qui ne concerne pas la page ou le compte de Michel ne nous regarde pas.
    if (entree.id && entree.id !== soi) continue;
    if (ig && reseau === "instagram" && config.reseaux_mentions !== "false") {
      for (const ch of entree.changes ?? []) {
        const v = ch.value;
        if (ch.field !== "mentions" || !v?.media_id) continue;
        if (!await traiterMention(version, ig, { media_id: v.media_id, comment_id: v.comment_id }, config)) return;
      }
    }
    if (!messagesActifs) continue;
    // Chaque conversation à son rythme : les messages de personnes différentes sont traités en même temps.
    const suites = await Promise.all((entree.messaging ?? []).map((ev) =>
      traiterMessage(version, reseau, soi, ev, config).catch((e) => {
        console.error("message", e);
        return true;
      })
    ));
    if (suites.includes(false)) return;
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
  if (envoi.object === "instagram" || envoi.object === "page") EdgeRuntime.waitUntil(traiterEnvoi(envoi).catch((e) => console.error("reseaux-webhook", e)));
  return json(200, { ok: true });
});
