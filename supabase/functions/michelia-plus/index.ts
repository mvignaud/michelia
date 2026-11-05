// Fonction « michelia-plus » : l'abonnement MichelIA+ sur le site, par carte ou prélèvement SEPA
// (voir docs/MICHELIA-PLUS.md).
// Il faut un compte Michel avec une adresse e-mail (pas un visiteur anonyme), et le navigateur passe la
// session Supabase. Le prix vient toujours de app_config (michelia_plus_prix), jamais du navigateur.
// {souscrire: "mois" | "an", carte, captcha} : premier paiement par l'API v1 de Stancer, carte enregistrée
// chez Stancer pour les échéances suivantes ; renvoie payé, refusé, ou l'adresse du 3D Secure de la banque.
// {souscrire: "mois" | "an", moyen: "sepa", iban, titulaire, telephone, captcha} : Michel envoie un code
// par SMS ; {signer: {code, iban, titulaire}} : signe le mandat SEPA, l'enregistre chez Stancer et lance
// le premier prélèvement. L'IBAN traverse la fonction, il n'est jamais gardé (seulement ses 4 derniers).
// Les premiers prélèvements déjà passés par la page Stancer (payment intent pi_…) restent confirmables.
// {confirmer: paym_… | pi_…} : relit le paiement chez Stancer après le 3D Secure ou la page Stancer.
// {resilier: true} : arrête le renouvellement ; MichelIA+ reste jusqu'à la fin de la période payée.
// {reprendre: true} : annule la résiliation avant la fin de la période, sur la même carte ou le même mandat.
// {changer: {moyen: "carte", carte, captcha}} : nouvelle carte, vérifiée par une autorisation de 0,50 € avec
// 3D Secure, jamais encaissée ; {confirmer_changement: paym_…} la relit et bascule l'abonnement dessus.
// {changer: {moyen: "sepa", iban, titulaire, telephone, captcha}} : nouveau compte, mandat signé par code SMS
// ({signer: …} comme à la souscription), sans prélèvement : les échéances suivantes partent dessus.
// La carte traverse la fonction le temps d'un appel à Stancer : jamais gardée, jamais dans les journaux.
// Mêmes garde-fous que le comptoir : Turnstile à chaque carte et plafonds d'essais (comptoir_reserver).
import { admin, cleanCard, isCardPaymentId, isPaymentIntentId, stancer, stancerConfigured, stancerCustomer, stancerTest } from "../_shared/stancer.ts";
import { abandonnerSepa, AUTH_FAILED, confirmerEcheance, confirmerSepa, echecSur, FAILED, finDePeriode, type Formule, isSepaId, libelle, menageEnAttente, premierPrelevementSepa, prixDe, safeError } from "../_shared/abonnement.ts";
import { CREANCIER, envoyerCourrier, mandatSigne } from "../_shared/courriers.ts";
import { base64, cleanIban, cleanMobile, cleanTitulaire, empreinte, envoyerSms, masquerTelephone, memeEmpreinte, nouveauCode, nouvelleRum, pdfMandat, smsConfigure } from "../_shared/mandat.ts";
import { corsHeaders, origineRefusee } from "../_shared/cors.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/$/, "");
// Retour du 3D Secure : cette fonction, qui accepte le POST de la banque et renvoie sur la page.
const RETOUR_3DS = `${Deno.env.get("SUPABASE_URL")}/functions/v1/michelia-plus?retour=3ds`;
const PAGE = "/la-cotisation";

const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });

async function config(key: string): Promise<string | undefined> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? undefined;
}

type Membre = { id: string; email: string; ip: string };

// Le compte derrière la requête : un vrai compte (pas anonyme) avec son adresse e-mail.
async function membre(req: Request): Promise<Membre | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if (!user || user.is_anonymous || !user.email) return null;
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);
  return { id: user.id, email: user.email.toLowerCase(), ip };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (new URL(req.url).searchParams.get("retour") === "3ds") {
    return new Response(null, { status: 303, headers: { Location: `${SITE_URL}${PAGE}?retour=3ds` } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "Méthode non permise" }, origin);
  if (origineRefusee(origin)) {
    return reply(403, { error: "Origine non autorisée" }, origin);
  }
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Corps illisible" }, origin);
  }

  const qui = await membre(req);
  if (!qui) return reply(401, { error: "Compte requis" }, origin);

  // Résilier marche toujours, même si l'abonnement a été refermé entre-temps.
  if (body?.resilier === true) return resilier(qui, origin);
  if (body?.reprendre === true) return reprendre(qui, origin);

  // Fermé : seuls passent les essais avec une clé de test Stancer (aucun argent réel), et les
  // administrateurs de Michel, pour un vrai essai avant l'ouverture (page /la-cotisation?essai=1).
  const ouvert = (await config("michelia_plus_actif")) === "true";
  if (!ouvert && !stancerTest() && !(await estAdmin(qui.id))) return reply(403, { error: "MichelIA+ n'est pas encore ouvert" }, origin);
  if (!stancerConfigured()) return reply(500, { error: "Paiement non configuré" }, origin);

  if (body?.confirmer !== undefined) {
    const id = body.confirmer;
    if (!(isCardPaymentId(id) || isPaymentIntentId(id)) || !(await echeanceDe(id, qui.id))) {
      return reply(400, { error: "Paiement inconnu" }, origin);
    }
    return reply(200, isPaymentIntentId(id) ? await confirmerSepa(id) : await confirmerEcheance(id), origin);
  }
  if (body?.signer !== undefined) return signerMandat(req, qui, body.signer, origin);
  if (body?.changer?.moyen === "carte") return changerCarte(req, qui, body.changer, origin);
  if (body?.changer?.moyen === "sepa") return changerCompte(qui, body.changer, origin);
  if (body?.confirmer_changement !== undefined) return confirmerChangement(qui, body.confirmer_changement, origin);
  if (body?.souscrire === "mois" || body?.souscrire === "an") {
    return body?.moyen === "sepa" ? souscrireSepa(qui, body.souscrire, body, origin) : souscrire(req, qui, body.souscrire, body, origin);
  }
  return reply(400, { error: "Demande inconnue" }, origin);
});

// L'échéance (paiement paym_… ou, pour un premier prélèvement SEPA, payment intent pi_…) appartient-elle
// bien à ce compte ?
async function echeanceDe(paiementId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("abonnement_echeances")
    .select("abonnements!inner(user_id)")
    .eq(isPaymentIntentId(paiementId) ? "stancer_intent" : "paiement_id", paiementId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  return (data as any)?.abonnements?.user_id === userId;
}

// deno-lint-ignore no-explicit-any
async function souscrire(req: Request, qui: Membre, formule: Formule, body: any, origin: string | null): Promise<Response> {
  const carte = cleanCard(body?.carte);
  if (!carte) return reply(400, { error: "Carte invalide" }, origin);
  const { data: vivant } = await admin
    .from("abonnements")
    .select("id")
    .eq("user_id", qui.id)
    .in("statut", ["actif", "impaye", "resilie"])
    .limit(1);
  if (vivant?.length) return reply(409, { error: "Déjà abonné" }, origin);
  if (!(await captchaOk(body?.captcha, qui.ip))) return reply(403, { error: "Vérification anti-robot échouée" }, origin);
  const prix = await prixDe(formule);
  if (!prix) return reply(500, { error: "Prix illisible" }, origin);

  // Un abonnement en attente par essai de souscription ; deux cartes au plus par essai. Un seul en
  // attente par compte (index unique abonnements_vivant_idx) : un double clic ou un second onglet
  // reçoit 409 au lieu d'un second paiement. Un essai abandonné depuis 5 minutes laisse la place.
  // Une page de prélèvement ouverte depuis un quart d'heure sans signature laisse la place (relue chez Stancer).
  await abandonnerSepa(900_000, qui.id);
  await menageEnAttente(300_000, qui.id);
  const essai = stancerTest();
  const { data: abonnement, error } = await admin
    .from("abonnements")
    .insert({ user_id: qui.id, source: "web", formule, moyen: "carte", statut: "en_attente", prix_cents: prix, email: qui.email, essai })
    .select("id")
    .single();
  if (error?.code === "23505") return reply(409, { error: "Souscription déjà en cours" }, origin);
  if (error || !abonnement) {
    console.error("MichelIA+ : abonnement non créé", error?.message);
    return reply(500, { error: "Abonnement indisponible" }, origin);
  }
  const place = await reserver(qui, `abo:${abonnement.id}`);
  if (place !== "ok") return reply(place === "erreur" ? 500 : 429, { error: "Trop d'essais" }, origin);

  const [nom, numeroRecu] = await Promise.all([nomDuCompte(qui.id), prochainNumeroRecu()]);
  const client = await stancerCustomer(qui.email, nom, qui.id);
  if (client) await admin.from("abonnements").update({ stancer_client: client }).eq("id", abonnement.id);
  const suffixe = crypto.getRandomValues(new Uint8Array(3)).reduce((t, b) => t + b.toString(16).padStart(2, "0"), "");
  const res = await stancer("POST", "/v1/checkout/", {
    amount: prix,
    currency: "eur",
    description: libelle(formule),
    unique_id: `abo_${abonnement.id}.${suffixe}`,
    ...(numeroRecu ? { order_id: numeroRecu } : {}),
    ...(client ? { customer: client } : {}),
    // tokenize : Stancer garde la carte (jeton card_…) pour les échéances suivantes.
    card: { number: carte.numero, exp_month: carte.mois, exp_year: carte.annee, cvc: carte.cvc, tokenize: true },
    auth: { status: "request", return_url: RETOUR_3DS },
    device: {
      ip: qui.ip,
      port: 443,
      ...(req.headers.get("user-agent") ? { user_agent: req.headers.get("user-agent")!.slice(0, 256) } : {}),
      ...(req.headers.get("accept") ? { http_accept: req.headers.get("accept")!.slice(0, 2048) } : {}),
      ...(req.headers.get("accept-language") ? { languages: req.headers.get("accept-language")!.slice(0, 32) } : {}),
    },
  });
  const paymentId = res.data?.id;
  if (!res.ok || !isCardPaymentId(paymentId)) {
    console.error(res.status >= 500 ? "MichelIA+ : ALERTE premier paiement sans réponse nette, à vérifier chez Stancer" : "MichelIA+ : premier paiement refusé", abonnement.id, res.status, safeError(res.data));
    // Refus net : la souscription s'arrête, la personne peut réessayer. Sinon (Stancer en panne,
    // paiement peut-être créé), elle reste en attente et le ménage la reprend plus tard.
    if (res.status < 500) await echecSur(abonnement.id);
    return reply(200, { etat: res.status >= 500 ? "attente" : "refuse" }, origin);
  }
  const debut = new Date();
  const { error: noteErr } = await admin.from("abonnement_echeances").insert({
    abonnement_id: abonnement.id,
    paiement_id: paymentId,
    montant_cents: prix,
    periode_debut: debut.toISOString(),
    periode_fin: finDePeriode(debut, formule).toISOString(),
    numero_recu: numeroRecu,
    essai,
  });
  if (noteErr) {
    // Le paiement existe chez Stancer sans échéance chez nous : à rembourser à la main.
    console.error("MichelIA+ : ALERTE échéance non enregistrée pour un paiement Stancer", paymentId, noteErr.message);
    return reply(500, { error: "Abonnement indisponible" }, origin);
  }
  const redirect = res.data.auth?.redirect_url;
  const statut = String(res.data.status ?? "");
  if (typeof redirect === "string" && redirect.startsWith("https://") && !statut) {
    return reply(200, { etat: "authentification", url: redirect, paiement: paymentId }, origin);
  }
  return reply(200, await confirmerEcheance(paymentId), origin);
}

// Prélèvement SEPA, en deux temps, tout chez Michel. 1) {souscrire, moyen: "sepa", iban, titulaire,
// telephone, captcha} : abonnement en attente, puis Michel envoie un code à 6 chiffres par SMS. Rien
// n'est gardé de l'IBAN, sauf une empreinte pour vérifier qu'on signe bien le même. 2) {signer: {code,
// iban, titulaire}} : le navigateur renvoie l'IBAN avec le code ; s'ils correspondent, Michel signe le
// mandat (PDF), l'enregistre chez Stancer avec l'IBAN (sepa_…) et lance le premier prélèvement.
// deno-lint-ignore no-explicit-any
async function souscrireSepa(qui: Membre, formule: Formule, body: any, origin: string | null): Promise<Response> {
  const iban = cleanIban(body?.iban);
  const titulaire = cleanTitulaire(body?.titulaire);
  const telephone = cleanMobile(body?.telephone);
  if (!iban) return reply(400, { error: "IBAN invalide", champ: "iban" }, origin);
  if (!titulaire) return reply(400, { error: "Titulaire invalide", champ: "titulaire" }, origin);
  if (!telephone) return reply(400, { error: "Mobile invalide", champ: "telephone" }, origin);
  if (!smsConfigure()) {
    console.error("MichelIA+ : ALERTE secrets Twilio manquants, prélèvement impossible");
    return reply(503, { error: "Prélèvement indisponible" }, origin);
  }
  const { data: vivant } = await admin
    .from("abonnements")
    .select("id")
    .eq("user_id", qui.id)
    .in("statut", ["actif", "impaye", "resilie"])
    .limit(1);
  if (vivant?.length) return reply(409, { error: "Déjà abonné" }, origin);
  if (!(await captchaOk(body?.captcha, qui.ip))) return reply(403, { error: "Vérification anti-robot échouée" }, origin);
  const prix = await prixDe(formule);
  if (!prix) return reply(500, { error: "Prix illisible" }, origin);

  // Une signature en cours dans un autre onglet (code déjà accepté) : on ne la remplace pas.
  const { data: enCours } = await admin.from("mandats_sepa_codes").select("id").eq("user_id", qui.id)
    .gt("utilise_le", new Date(Date.now() - 120_000).toISOString()).limit(1);
  if (enCours?.length) return reply(409, { error: "Signature déjà en cours" }, origin);
  // Un nouveau code remplace l'essai précédent du compte, s'il n'a pas abouti.
  await abandonnerSepa(900_000, qui.id);
  // Un prélèvement encore en route (ancienne page Stancer pas finie) : on attend qu'il soit tranché.
  const { data: enRoute } = await admin.from("abonnement_echeances").select("id, abonnements!inner(user_id, statut, moyen)")
    .eq("statut", "en_cours").eq("abonnements.user_id", qui.id).eq("abonnements.statut", "en_attente").eq("abonnements.moyen", "sepa").limit(1);
  if (enRoute?.length) return reply(409, { error: "Signature déjà en cours" }, origin);
  await admin.from("abonnements").update({ statut: "expire", updated_at: new Date().toISOString() })
    .eq("user_id", qui.id).eq("source", "web").eq("moyen", "sepa").eq("statut", "en_attente").is("stancer_sepa", null);
  await menageEnAttente(300_000, qui.id);
  const essai = stancerTest();
  const { data: abonnement, error } = await admin
    .from("abonnements")
    .insert({ user_id: qui.id, source: "web", formule, moyen: "sepa", statut: "en_attente", prix_cents: prix, email: qui.email, essai })
    .select("id")
    .single();
  if (error?.code === "23505") return reply(409, { error: "Souscription déjà en cours" }, origin);
  if (error || !abonnement) {
    console.error("MichelIA+ : abonnement non créé", error?.message);
    return reply(500, { error: "Abonnement indisponible" }, origin);
  }
  // Chaque SMS compte comme un essai de paiement (plafonds par compte, par adresse IP et global).
  const place = await reserver(qui, `abo:${abonnement.id}`, "paiement");
  if (place !== "ok") {
    await echecSur(abonnement.id);
    return reply(place === "erreur" ? 500 : 429, { error: "Trop d'essais" }, origin);
  }

  const envoi = await envoyerCode(qui, abonnement.id, { iban, titulaire, telephone }, `MichelIA+, ${eurosTexte(prix)} ${formule === "mois" ? "par mois" : "par an"}`, false);
  if (envoi !== "ok") {
    await echecSur(abonnement.id);
    return envoi === "sms" ? reply(502, { error: "SMS non envoyé", champ: "telephone" }, origin) : reply(500, { error: "Prélèvement indisponible" }, origin);
  }
  return reply(200, { etat: "code", telephone: masquerTelephone(telephone) }, origin);
}

// Le code de signature : enregistré (empreintes salées seulement), puis envoyé par SMS.
async function envoyerCode(
  qui: Membre,
  abonnementId: number,
  m: { iban: string; titulaire: string; telephone: string },
  objet: string,
  changement: boolean,
): Promise<"ok" | "sms" | "erreur"> {
  const code = nouveauCode();
  const sel = crypto.randomUUID();
  const { error: codeErr } = await admin.from("mandats_sepa_codes").insert({
    user_id: qui.id,
    abonnement_id: abonnementId,
    sel,
    code_empreinte: await empreinte(sel, code),
    iban_empreinte: await empreinte(sel, m.iban),
    titulaire: m.titulaire,
    telephone_masque: masquerTelephone(m.telephone),
    expire_le: new Date(Date.now() + 600_000).toISOString(),
    changement,
  });
  if (codeErr) {
    console.error("MichelIA+ : code de mandat non enregistré", codeErr.message);
    return "erreur";
  }
  const envoye = await envoyerSms(
    m.telephone,
    `Michel : ton code pour signer le mandat de prélèvement SEPA de ${CREANCIER.nom} (${objet}) : ${code}. Valable 10 minutes. Ne le donne à personne.`,
  );
  return envoye ? "ok" : "sms";
}

// L'abonnement du site qu'on peut faire changer de carte ou de compte : en cours, impayé ou résilié
// (la période payée court encore). Jamais un abonnement pris dans une appli.
async function abonnementVivant(userId: string) {
  const { data } = await admin
    .from("abonnements")
    .select("id, formule, moyen, prix_cents, statut, stancer_client, essai")
    .eq("user_id", userId)
    .eq("source", "web")
    .in("statut", ["actif", "impaye", "resilie"])
    .limit(1)
    .maybeSingle();
  return data;
}

// Nouveau compte pour les prélèvements : même parcours qu'à la souscription (code SMS), sans prélèvement.
// deno-lint-ignore no-explicit-any
async function changerCompte(qui: Membre, body: any, origin: string | null): Promise<Response> {
  const iban = cleanIban(body?.iban);
  const titulaire = cleanTitulaire(body?.titulaire);
  const telephone = cleanMobile(body?.telephone);
  if (!iban) return reply(400, { error: "IBAN invalide", champ: "iban" }, origin);
  if (!titulaire) return reply(400, { error: "Titulaire invalide", champ: "titulaire" }, origin);
  if (!telephone) return reply(400, { error: "Mobile invalide", champ: "telephone" }, origin);
  if (!smsConfigure()) {
    console.error("MichelIA+ : ALERTE secrets Twilio manquants, changement de compte impossible");
    return reply(503, { error: "Prélèvement indisponible" }, origin);
  }
  const ab = await abonnementVivant(qui.id);
  if (!ab) return reply(404, { error: "Pas d'abonnement" }, origin);
  if (!(await captchaOk(body?.captcha, qui.ip))) return reply(403, { error: "Vérification anti-robot échouée" }, origin);
  const { data: enCours } = await admin.from("mandats_sepa_codes").select("id").eq("user_id", qui.id)
    .gt("utilise_le", new Date(Date.now() - 120_000).toISOString()).limit(1);
  if (enCours?.length) return reply(409, { error: "Signature déjà en cours" }, origin);
  const place = await reserver(qui, `chg:${ab.id}:${Date.now()}`, "paiement");
  if (place !== "ok") return reply(place === "erreur" ? 500 : 429, { error: "Trop d'essais" }, origin);
  const envoi = await envoyerCode(qui, ab.id, { iban, titulaire, telephone }, `MichelIA+, ${eurosTexte(ab.prix_cents)} ${ab.formule === "mois" ? "par mois" : "par an"}`, true);
  if (envoi !== "ok") {
    return envoi === "sms" ? reply(502, { error: "SMS non envoyé", champ: "telephone" }, origin) : reply(500, { error: "Prélèvement indisponible" }, origin);
  }
  return reply(200, { etat: "code", telephone: masquerTelephone(telephone) }, origin);
}

// Nouvelle carte : autorisation de 0,50 € avec 3D Secure (jamais encaissée, la banque la libère), qui
// enregistre la carte chez Stancer. L'abonnement ne bascule dessus qu'une fois la banque d'accord.
const MONTANT_VERIF = 50;
// deno-lint-ignore no-explicit-any
async function changerCarte(req: Request, qui: Membre, body: any, origin: string | null): Promise<Response> {
  const carte = cleanCard(body?.carte);
  if (!carte) return reply(400, { error: "Carte invalide" }, origin);
  const ab = await abonnementVivant(qui.id);
  if (!ab) return reply(404, { error: "Pas d'abonnement" }, origin);
  if (!(await captchaOk(body?.captcha, qui.ip))) return reply(403, { error: "Vérification anti-robot échouée" }, origin);
  const place = await reserver(qui, `chg:${ab.id}:${Date.now()}`);
  if (place !== "ok") return reply(place === "erreur" ? 500 : 429, { error: "Trop d'essais" }, origin);
  const suffixe = crypto.getRandomValues(new Uint8Array(3)).reduce((t, b) => t + b.toString(16).padStart(2, "0"), "");
  const res = await stancer("POST", "/v1/checkout/", {
    amount: MONTANT_VERIF,
    currency: "eur",
    description: "MichelIA+ : vérification de la carte, non débitée",
    unique_id: `chg_${ab.id}.${suffixe}`,
    ...(ab.stancer_client ? { customer: ab.stancer_client } : {}),
    card: { number: carte.numero, exp_month: carte.mois, exp_year: carte.annee, cvc: carte.cvc, tokenize: true },
    capture: false,
    auth: { status: "request", return_url: RETOUR_3DS },
    device: {
      ip: qui.ip,
      port: 443,
      ...(req.headers.get("user-agent") ? { user_agent: req.headers.get("user-agent")!.slice(0, 256) } : {}),
      ...(req.headers.get("accept") ? { http_accept: req.headers.get("accept")!.slice(0, 2048) } : {}),
      ...(req.headers.get("accept-language") ? { languages: req.headers.get("accept-language")!.slice(0, 32) } : {}),
    },
  });
  const paymentId = res.data?.id;
  if (!res.ok || !isCardPaymentId(paymentId)) {
    console.error("MichelIA+ : vérification de carte refusée", ab.id, res.status, safeError(res.data));
    return reply(200, { etat: res.status >= 500 ? "attente" : "refuse" }, origin);
  }
  const { error } = await admin.from("abonnement_changements").insert({ abonnement_id: ab.id, user_id: qui.id, paiement_id: paymentId });
  if (error) {
    console.error("MichelIA+ : changement de carte non enregistré", paymentId, error.message);
    return reply(500, { error: "Changement indisponible" }, origin);
  }
  const redirect = res.data.auth?.redirect_url;
  if (typeof redirect === "string" && redirect.startsWith("https://") && !res.data.status) {
    return reply(200, { etat: "authentification", url: redirect, paiement: paymentId }, origin);
  }
  return confirmerChangement(qui, paymentId, origin);
}

// Relit la vérification de la nouvelle carte chez Stancer ; une fois autorisée, l'abonnement passe dessus.
async function confirmerChangement(qui: Membre, paiementId: unknown, origin: string | null): Promise<Response> {
  if (!isCardPaymentId(paiementId)) return reply(400, { error: "Paiement inconnu" }, origin);
  const { data: chg } = await admin.from("abonnement_changements").select("id, abonnement_id, statut")
    .eq("paiement_id", paiementId).eq("user_id", qui.id).maybeSingle();
  if (!chg) return reply(400, { error: "Paiement inconnu" }, origin);
  if (chg.statut !== "en_cours") return reply(200, { etat: chg.statut === "fait" ? "change" : "refuse" }, origin);
  const payment = await stancer("GET", `/v1/checkout/${paiementId}`);
  if (!payment.ok || !payment.data) return reply(200, { etat: "attente" }, origin);
  if (Number(payment.data.amount) !== MONTANT_VERIF) {
    console.error("MichelIA+ : vérification de carte au montant inattendu", paiementId);
    return reply(200, { etat: "attente" }, origin);
  }
  let statut = String(payment.data.status ?? "");
  const auth = String(payment.data.auth?.status ?? "");
  if (!statut && AUTH_FAILED.includes(auth)) statut = "refused";
  // 3D Secure réussi : on demande l'autorisation à la banque, sans jamais encaisser.
  if (!statut && auth === "success") {
    const demande = await stancer("PATCH", `/v1/checkout/${paiementId}`, { status: "authorize" });
    statut = String((demande.status === 409 ? (await stancer("GET", `/v1/checkout/${paiementId}`)).data : demande.data)?.status ?? "");
  }
  if (FAILED.includes(statut)) {
    await admin.from("abonnement_changements").update({ statut: "refuse" }).eq("id", chg.id).eq("statut", "en_cours");
    return reply(200, { etat: "refuse" }, origin);
  }
  if (statut !== "authorized") return reply(200, { etat: "attente" }, origin);
  const carte = payment.data.card;
  const jeton = typeof carte?.id === "string" && /^card_[A-Za-z0-9]{6,64}$/.test(carte.id) ? carte.id : null;
  const chiffres = typeof carte?.last4 === "string" && /^\d{4}$/.test(carte.last4) ? carte.last4 : null;
  if (!jeton) {
    console.error("MichelIA+ : ALERTE carte vérifiée sans jeton", paiementId);
    return reply(200, { etat: "attente" }, origin);
  }
  const { data: pris } = await admin.from("abonnement_changements").update({ statut: "fait" }).eq("id", chg.id).eq("statut", "en_cours").select("id");
  if (!pris?.length) return reply(200, { etat: "change" }, origin);
  await basculer(chg.abonnement_id, { moyen: "carte", stancer_carte: jeton, derniers_chiffres: chiffres });
  return reply(200, { etat: "change" }, origin);
}

// L'abonnement passe sur la nouvelle carte ou le nouveau mandat. Impayé : Michel réessaie au prochain
// passage du cron, sur le nouveau moyen.
async function basculer(abonnementId: number, moyen: { moyen: "carte" | "sepa"; stancer_carte?: string; stancer_sepa?: string; derniers_chiffres: string | null }) {
  const maintenant = new Date().toISOString();
  const { data, error } = await admin.from("abonnements")
    // Prélevé par E-KO : le cron lui transmet le nouveau moyen (eko_moyen_change_le).
    .update({ ...moyen, updated_at: maintenant, eko_moyen_change_le: maintenant })
    .eq("id", abonnementId).eq("source", "web").in("statut", ["actif", "impaye", "resilie"]).select("statut");
  if (error || !data?.length) {
    console.error("MichelIA+ : ALERTE nouveau moyen de paiement non posé", abonnementId, error?.message ?? "abonnement terminé");
    return false;
  }
  if (data[0].statut === "impaye") await admin.from("abonnements").update({ prochain_essai: null }).eq("id", abonnementId).eq("statut", "impaye");
  return true;
}

// deno-lint-ignore no-explicit-any
async function signerMandat(req: Request, qui: Membre, signature: any, origin: string | null): Promise<Response> {
  const code = typeof signature?.code === "string" ? signature.code.replace(/\s/g, "") : "";
  const iban = cleanIban(signature?.iban);
  const titulaire = cleanTitulaire(signature?.titulaire);
  if (!/^\d{6}$/.test(code) || !iban || !titulaire) return reply(400, { error: "Code invalide" }, origin);
  const { data: attente } = await admin
    .from("mandats_sepa_codes")
    .select("id, abonnement_id, sel, code_empreinte, iban_empreinte, titulaire, telephone_masque, essais, expire_le, changement, abonnements!inner(statut, source, formule, prix_cents, essai, stancer_client)")
    .eq("user_id", qui.id)
    .is("utilise_le", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const ab = (attente as any)?.abonnements;
  // Souscription : l'abonnement attend son premier prélèvement. Changement de compte : il court déjà.
  const changement = attente?.changement === true;
  const abOk = changement ? ab?.source === "web" && ["actif", "impaye", "resilie"].includes(ab?.statut) : ab?.statut === "en_attente";
  if (!attente || !abOk || new Date(attente.expire_le).getTime() < Date.now() || attente.essais >= 5) {
    return reply(410, { error: "Code expiré : demande un nouveau code" }, origin);
  }
  // L'essai compte avant la vérification : pas plus de 5 codes tentés, même en parallèle.
  const { data: compte } = await admin.from("mandats_sepa_codes").update({ essais: attente.essais + 1 })
    .eq("id", attente.id).eq("essais", attente.essais).is("utilise_le", null).select("id");
  if (!compte?.length) return reply(409, { error: "Réessaie" }, origin);
  const bonCode = memeEmpreinte(await empreinte(attente.sel, code), attente.code_empreinte);
  const bonIban = memeEmpreinte(await empreinte(attente.sel, iban), attente.iban_empreinte);
  if (!bonCode || !bonIban || titulaire !== attente.titulaire) {
    return reply(400, { error: "Code incorrect", essais_restants: Math.max(0, 4 - attente.essais) }, origin);
  }
  // Code consommé, et ses empreintes effacées : celle de l'IBAN ne doit pas traîner en base. La ligne
  // reste quelques minutes pour qu'un autre onglet ne remplace pas la signature en cours.
  const { data: pris } = await admin.from("mandats_sepa_codes")
    .update({ utilise_le: new Date().toISOString(), code_empreinte: "", iban_empreinte: "" })
    .eq("id", attente.id).is("utilise_le", null).select("id");
  if (!pris?.length) return reply(409, { error: "Déjà signé" }, origin);

  const abonnementId = attente.abonnement_id as number;
  const formule = ab.formule as Formule;
  const prix = ab.prix_cents as number;
  const signeLe = new Date();
  const rum = nouvelleRum(abonnementId);
  const libelleMandat = `${libelle(formule)}, ${eurosTexte(prix)} ${formule === "mois" ? "par mois" : "par an"}, prélevé à la date anniversaire de l'abonnement.`;
  const pdf = await pdfMandat({
    rum,
    titulaire,
    iban,
    email: qui.email,
    libelle: libelleMandat,
    signeLe,
    telephoneMasque: attente.telephone_masque,
    ip: qui.ip,
  });

  // Le compte et le mandat chez Stancer : l'IBAN y part, et n'est gardé nulle part chez Michel.
  const sepa = await stancer("POST", "/v1/sepa/", { iban, name: titulaire, mandate: rum, date_mandate: Math.floor(signeLe.getTime() / 1000) });
  const sepaId = sepa.data?.id ?? sepa.data?.error?.message?.id;
  if (!isSepaId(sepaId)) {
    console.error("MichelIA+ : compte SEPA refusé par Stancer", abonnementId, sepa.status, safeError(sepa.data));
    await echecSur(abonnementId);
    return reply(200, { etat: "refuse", raison: "iban" }, origin);
  }
  const iban4 = iban.slice(-4);
  if (changement) {
    if (!(await basculer(abonnementId, { moyen: "sepa", stancer_sepa: sepaId, derniers_chiffres: iban4 }))) {
      return reply(410, { error: "Abonnement terminé" }, origin);
    }
    // L'ancien mandat de l'abonnement ne sert plus.
    await admin.from("mandats_sepa").update({ revoque_le: signeLe.toISOString() })
      .eq("abonnement_id", abonnementId).neq("stancer_sepa", sepaId).is("revoque_le", null);
    await rangerMandat(req, qui, { abonnementId, sepaId, rum, titulaire, iban4, signeLe, telephoneMasque: attente.telephone_masque, pdf });
    return reply(200, { etat: "change" }, origin);
  }
  // L'abonnement doit être encore en attente (pas remplacé ni effacé entre-temps) : sinon, aucun
  // prélèvement. Une fois le mandat posé, il n'est plus ni remplacé ni effacé par le ménage. updated_at
  // garde l'heure de la signature : le cron s'en sert pour relancer le premier prélèvement.
  const { data: tenu } = await admin.from("abonnements")
    .update({ stancer_sepa: sepaId, derniers_chiffres: iban4, updated_at: signeLe.toISOString() })
    .eq("id", abonnementId).eq("statut", "en_attente").is("stancer_sepa", null).select("id");
  if (!tenu?.length) {
    console.error("MichelIA+ : abonnement plus en attente à la signature, rien n'est prélevé", abonnementId);
    return reply(410, { error: "Code expiré : demande un nouveau code" }, origin);
  }
  await rangerMandat(req, qui, { abonnementId, sepaId, rum, titulaire, iban4, signeLe, telephoneMasque: attente.telephone_masque, pdf });

  // Premier prélèvement, sur le mandat tout juste signé. Sans réponse nette, le cron le relance avec le
  // même identifiant (premierPrelevementSepa), donc jamais deux fois.
  const etat = await premierPrelevementSepa(
    { id: abonnementId, formule, prix_cents: prix, essai: ab.essai, stancer_client: ab.stancer_client, stancer_sepa: sepaId },
    signeLe,
  );
  return reply(etat.etat === "inconnu" ? 500 : 200, etat, origin);
}

// Le mandat signé : PDF dans le stockage privé, ligne mandats_sepa avec la preuve, copie par e-mail.
async function rangerMandat(
  req: Request,
  qui: Membre,
  m: { abonnementId: number; sepaId: string; rum: string; titulaire: string; iban4: string; signeLe: Date; telephoneMasque: string; pdf: Uint8Array },
) {
  const chemin = `${qui.id}/${m.rum}.pdf`;
  const { error: stockErr } = await admin.storage.from("mandats").upload(chemin, m.pdf, { contentType: "application/pdf", upsert: false });
  if (stockErr) console.error("MichelIA+ : ALERTE mandat PDF non rangé", m.rum, stockErr.message);
  const { error: mandatErr } = await admin.from("mandats_sepa").upsert({
    user_id: qui.id,
    abonnement_id: m.abonnementId,
    stancer_sepa: m.sepaId,
    rum: m.rum,
    titulaire: m.titulaire,
    iban_derniers: m.iban4,
    signe_le: m.signeLe.toISOString(),
    pdf_chemin: stockErr ? null : chemin,
    preuve: {
      methode: "code SMS Michel",
      telephone: m.telephoneMasque,
      ip: qui.ip,
      navigateur: (req.headers.get("user-agent") ?? "").slice(0, 256),
      pdf_sha256: await empreinte(base64(m.pdf)),
    },
  }, { onConflict: "stancer_sepa" });
  if (mandatErr) console.error("MichelIA+ : ALERTE mandat SEPA non rangé", m.rum, mandatErr.message);
  const courrier = mandatSigne({ prenom: null, rum: m.rum, iban4: m.iban4, creancier: CREANCIER, date: m.signeLe });
  EdgeRuntime.waitUntil(
    envoyerCourrier(qui.email, courrier, "mandat", [{ nom: `mandat-sepa-${m.rum}.pdf`, type: "application/pdf", base64: base64(m.pdf) }])
      .then((ok) => ok || console.error("MichelIA+ : e-mail du mandat non envoyé", m.rum)),
  );
}

const eurosTexte = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

// Résiliation en un geste : plus de renouvellement, le droit court jusqu'à la fin de la période payée.
// Seulement pour un abonnement pris sur le site (ceux des applis se résilient dans la boutique).
async function resilier(qui: Membre, origin: string | null): Promise<Response> {
  const { data } = await admin
    .from("abonnements")
    .update({ statut: "resilie", resilie_le: new Date().toISOString(), prochain_essai: null, updated_at: new Date().toISOString() })
    .eq("user_id", qui.id)
    .eq("source", "web")
    .in("statut", ["actif", "impaye"])
    .select("fin_periode");
  if (!data?.length) {
    const { data: deja } = await admin.from("abonnements").select("source, statut").eq("user_id", qui.id).in("statut", ["actif", "impaye", "resilie"]).maybeSingle();
    if (deja?.statut === "resilie") return reply(200, { etat: "resilie" }, origin);
    if (deja) return reply(409, { error: "Abonnement pris dans l'appli : à résilier dans la boutique", source: deja.source }, origin);
    return reply(404, { error: "Pas d'abonnement" }, origin);
  }
  return reply(200, { etat: "resilie", fin_periode: data[0].fin_periode }, origin);
}

// Reprise d'une cotisation résiliée, tant que la période payée court encore : le renouvellement
// repart à la même date, sur la carte ou le mandat SEPA déjà enregistrés chez Stancer. Rien n'est
// prélevé tout de suite.
// Une fois la période finie, l'abonnement est terminé et il faut souscrire à nouveau.
async function reprendre(qui: Membre, origin: string | null): Promise<Response> {
  const { data } = await admin
    .from("abonnements")
    .update({ statut: "actif", resilie_le: null, updated_at: new Date().toISOString() })
    .eq("user_id", qui.id)
    .eq("source", "web")
    .eq("statut", "resilie")
    .gt("fin_periode", new Date().toISOString())
    .or("and(moyen.eq.carte,stancer_carte.not.is.null),and(moyen.eq.sepa,stancer_sepa.not.is.null)")
    .select("fin_periode");
  if (!data?.length) return reply(409, { error: "Rien à reprendre : souscris à nouveau" }, origin);
  return reply(200, { etat: "actif", fin_periode: data[0].fin_periode }, origin);
}

async function estAdmin(userId: string): Promise<boolean> {
  const { data } = await admin.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

async function nomDuCompte(userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle();
  const nom = [data?.first_name, data?.last_name].map((n) => (typeof n === "string" ? n.trim().slice(0, 30) : "")).filter(Boolean).join(" ");
  return nom || null;
}

async function prochainNumeroRecu(): Promise<string | null> {
  const { data, error } = await admin.rpc("prochain_numero_recu");
  return !error && typeof data === "string" && data.length <= 36 ? data : null;
}

async function reserver(qui: Membre, essai: string, genre: "carte" | "paiement" = "carte"): Promise<string> {
  const { data, error } = await admin.rpc("comptoir_reserver", { p_genre: genre, p_user: qui.id, p_ip: qui.ip, p_paiement: essai });
  if (error) {
    console.error("MichelIA+ : plafond illisible", error.message);
    return "erreur";
  }
  if (data === "global") console.error("MichelIA+ : ALERTE plafond global atteint, robots possibles");
  return String(data);
}

const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
async function captchaOk(token: unknown, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    if (stancerTest()) return true;
    console.error("MichelIA+ : TURNSTILE_SECRET_KEY manquant, cartes refusées en réel");
    return false;
  }
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
  if (ip) form.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  return data?.success === true;
}
