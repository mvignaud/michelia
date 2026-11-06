// Fonction « reseaux » : Michel répond lui-même aux commentaires laissés sous les publications de sa page
// Facebook et de son compte Instagram, avec le même caractère que dans le chat.
// - Appelée toutes les 10 minutes par pg_cron (migration 20261106010000_reponses_reseaux.sql).
// - Lit l'API Graph de Meta avec le jeton de la page (secret META_PAGE_TOKEN). Mode d'emploi :
//   docs/REPONSES-RESEAUX.md. Le code partagé avec « reseaux-webhook » est dans _shared/reseaux.ts.
// - Un commentaire n'est traité qu'une fois : il est réservé dans public.reponses_reseaux (clé unique)
//   avant d'appeler Claude ; deux appels simultanés ne répondent jamais deux fois.
// - Garde-fous : seulement les commentaires de premier niveau, récents (reseaux_fenetre_heures), au plus
//   reseaux_max_passage réponses par passage et reseaux_max_auteur_jour par personne et par jour ; rien
//   si Mathieu (la page) a déjà répondu ; Michel se tait devant les insultes, le spam et les sujets qui
//   fâchent, et passe la main à Mathieu (alerte « reseaux ») pour ce qui demande un humain.
// - Le journal est purgé au bout de reseaux_conservation_jours (90 par défaut).
// - Coupée par app_config.reseaux_reponses_actif = 'false'.
// Déployée sans vérification du JWT : l'appeler en trop ne fait que relire les commentaires.
import {
  admin,
  alerteJeton,
  appeler,
  auteurAuPlafond,
  finir,
  graph,
  GraphErreur,
  json,
  lirePage,
  loadConfig,
  nombre,
  type Page,
  PAGE_TOKEN,
  reserver,
  traiter,
  versionGraph,
} from "../_shared/reseaux.ts";

type Commentaire = {
  reseau: "facebook" | "instagram";
  id: string;
  publication_id: string;
  publication: string;
  auteur_id: string | null;
  auteur: string | null;
  texte: string;
  date: string;
  dejaRepondu: boolean;
};

// Une liste de l'API Graph, page après page (l'adresse « next » porte déjà le jeton et la preuve),
// tant que continuer() le permet et au plus PAGES_MAX pages : un trop-plein attend le passage suivant.
type Liste<T> = { data: T[]; paging?: { next?: string } };
const PAGES_MAX = 5;
async function toutes<T>(premiere: Liste<T> | undefined, continuer: (dernier: T) => boolean = () => true): Promise<T[]> {
  const tout = [...(premiere?.data ?? [])];
  let suite = premiere?.paging?.next;
  for (let n = 1; suite && n < PAGES_MAX && tout.length && continuer(tout[tout.length - 1]); n++) {
    const page = await appeler<Liste<T>>(suite, "page suivante");
    tout.push(...page.data);
    suite = page.paging?.next;
  }
  return tout;
}

type FbCommentaire = {
  id: string;
  message?: string;
  created_time: string;
  from?: { id: string; name?: string };
  comments?: { data: { from?: { id: string } }[] };
};
type FbPublication = { id: string; message?: string; comments?: Liste<FbCommentaire> };
type IgCommentaire = {
  id: string;
  text?: string;
  timestamp: string;
  username?: string;
  from?: { id: string; username?: string };
  replies?: { data: { username?: string }[] };
};
type IgMedia = { id: string; caption?: string; timestamp: string; comments?: Liste<IgCommentaire> };

// Une publication ancienne peut recevoir un commentaire neuf : on remonte 30 jours de plus que la fenêtre.
const RECUL_PUBLICATIONS = 30 * 86400_000;

async function commentairesFacebook(version: string, page: Page, depuis: Date): Promise<Commentaire[]> {
  const premiere = await graph<Liste<FbPublication>>(version, "me/posts", {
    fields:
      "id,message,comments.filter(toplevel).order(reverse_chronological).limit(25)" +
      "{id,message,created_time,from{id,name},comments.limit(25){from{id}}}",
    since: String(Math.floor((depuis.getTime() - RECUL_PUBLICATIONS) / 1000)),
    limit: "15",
  });
  const publications = await toutes(premiere);
  const resultat: Commentaire[] = [];
  for (const pub of publications) {
    // Du plus récent au plus ancien : on s'arrête dès qu'on sort de la fenêtre.
    const commentaires = await toutes(pub.comments, (c) => Date.parse(c.created_time) >= depuis.getTime());
    for (const c of commentaires) {
      if (c.from?.id === page.id) continue;
      resultat.push({
        reseau: "facebook",
        id: c.id,
        publication_id: pub.id,
        publication: pub.message ?? "",
        auteur_id: c.from?.id ?? null,
        auteur: c.from?.name ?? null,
        texte: c.message ?? "",
        date: c.created_time,
        dejaRepondu: (c.comments?.data ?? []).some((r) => r.from?.id === page.id),
      });
    }
  }
  return resultat;
}

async function commentairesInstagram(version: string, ig: { id: string; username?: string }, depuis: Date): Promise<Commentaire[]> {
  const premiere = await graph<Liste<IgMedia>>(version, `${ig.id}/media`, {
    fields: "id,caption,timestamp,comments.limit(25){id,text,timestamp,username,from{id,username},replies.limit(25){username}}",
    limit: "15",
  });
  // Les médias arrivent du plus récent au plus ancien.
  const medias = (await toutes(premiere, (m) => Date.parse(m.timestamp) >= depuis.getTime() - RECUL_PUBLICATIONS))
    .filter((m) => Date.parse(m.timestamp) >= depuis.getTime() - RECUL_PUBLICATIONS);
  const resultat: Commentaire[] = [];
  for (const media of medias) {
    // L'ordre des commentaires Instagram n'est pas garanti : on lit toutes les pages (dans la limite de PAGES_MAX).
    for (const c of await toutes(media.comments)) {
      const pseudo = c.from?.username ?? c.username ?? null;
      if (ig.username && pseudo === ig.username) continue;
      resultat.push({
        reseau: "instagram",
        id: c.id,
        publication_id: media.id,
        publication: media.caption ?? "",
        auteur_id: c.from?.id ?? pseudo,
        auteur: pseudo,
        texte: c.text ?? "",
        date: c.timestamp,
        dejaRepondu: !!ig.username && (c.replies?.data ?? []).some((r) => r.username === ig.username),
      });
    }
  }
  return resultat;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  const config = await loadConfig();
  if (config.reseaux_reponses_actif !== "true") return json(200, { actif: false });
  if (!PAGE_TOKEN) return json(200, { actif: true, jeton: false });

  const version = versionGraph(config);
  const fenetre = nombre(config.reseaux_fenetre_heures, 72);
  const maxPassage = nombre(config.reseaux_max_passage, 10);
  const maxAuteur = nombre(config.reseaux_max_auteur_jour, 3);
  const conservation = nombre(config.reseaux_conservation_jours, 90);
  const depuis = new Date(Date.now() - fenetre * 3600_000);

  // Une réservation restée « en_cours » (fonction coupée en route) est rendue au bout d'une demi-heure ;
  // le journal ne garde rien au-delà de la durée de conservation (voir la page de confidentialité).
  await admin.from("reponses_reseaux").delete().eq("statut", "en_cours")
    .lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString());
  await admin.from("reponses_reseaux").delete()
    .lt("created_at", new Date(Date.now() - conservation * 86400_000).toISOString());

  let commentaires: Commentaire[] = [];
  const erreurs: string[] = [];
  try {
    const page = await lirePage(version);
    const lectures: Promise<Commentaire[]>[] = [];
    if (config.reseaux_facebook !== "false") lectures.push(commentairesFacebook(version, page, depuis));
    if (config.reseaux_instagram !== "false" && page.instagram_business_account) {
      lectures.push(commentairesInstagram(version, page.instagram_business_account, depuis));
    }
    for (const r of await Promise.allSettled(lectures)) {
      if (r.status === "fulfilled") commentaires.push(...r.value);
      else {
        if (r.reason instanceof GraphErreur && r.reason.jetonCasse) await alerteJeton(r.reason.message);
        erreurs.push(String(r.reason?.message ?? r.reason));
      }
    }
  } catch (e) {
    if (e instanceof GraphErreur && e.jetonCasse) await alerteJeton(e.message);
    console.error("reseaux", e);
    return json(502, { error: String((e as Error).message) });
  }

  commentaires = commentaires
    .filter((c) => c.texte.trim() && Date.parse(c.date) >= depuis.getTime())
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (!commentaires.length) return json(200, { actif: true, nouveaux: 0, erreurs });

  // Ceux déjà vus ne coûtent rien : on les écarte avant d'appeler Claude.
  const { data: vus } = await admin.from("reponses_reseaux").select("commentaire_id")
    .in("commentaire_id", commentaires.map((c) => c.id));
  const dejaVus = new Set((vus ?? []).map((v) => v.commentaire_id));
  const nouveaux = commentaires.filter((c) => !dejaVus.has(c.id));

  const bilan = { repondu: 0, silence: 0, mathieu: 0, echec: 0, plus_tard: 0 };
  for (const c of nouveaux) {
    if (bilan.repondu >= maxPassage) {
      bilan.plus_tard++;
      continue;
    }
    if (c.auteur_id && !c.dejaRepondu && await auteurAuPlafond(c.reseau, c.auteur_id, maxAuteur)) {
      bilan.plus_tard++;
      continue;
    }
    const pris = await reserver({
      reseau: c.reseau,
      commentaire_id: c.id,
      publication_id: c.publication_id,
      auteur_id: c.auteur_id,
      auteur: c.auteur,
      commentaire: c.texte,
      commente_at: c.date,
    });
    if (!pris) continue;

    if (c.dejaRepondu) {
      await finir(c.id, { statut: "silence", raison: "la page a déjà répondu" });
      bilan.silence++;
      continue;
    }
    const chemin = c.reseau === "facebook" ? `${c.id}/comments` : `${c.id}/replies`;
    const r = await traiter(
      c.id,
      c,
      config,
      async (texte) => (await graph<{ id?: string }>(version, chemin, { message: texte }, "POST")).id ?? null,
      { publication_id: c.publication_id },
    );
    bilan[r.issue]++;
    if (r.erreur) erreurs.push(r.erreur);
    // Claude indisponible ou Meta qui dit d'attendre : la suite au prochain passage.
    if (r.issue === "plus_tard") break;
  }
  return json(200, { actif: true, nouveaux: nouveaux.length, ...bilan, erreurs });
});
