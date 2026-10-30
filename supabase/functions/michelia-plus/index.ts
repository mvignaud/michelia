// Fonction « michelia-plus » : l'abonnement MichelIA+ sur le site, par carte (voir docs/MICHELIA-PLUS.md).
// Il faut un compte Michel avec une adresse e-mail (pas un visiteur anonyme), et le navigateur passe la
// session Supabase. Le prix vient toujours de app_config (michelia_plus_prix), jamais du navigateur.
// {souscrire: "mois" | "an", carte, captcha} : premier paiement par l'API v1 de Stancer, carte enregistrée
// chez Stancer pour les échéances suivantes ; renvoie payé, refusé, ou l'adresse du 3D Secure de la banque.
// {confirmer: paym_…} : relit le paiement chez Stancer après le 3D Secure.
// {resilier: true} : arrête le renouvellement ; MichelIA+ reste jusqu'à la fin de la période payée.
// La carte traverse la fonction le temps d'un appel à Stancer : jamais gardée, jamais dans les journaux.
// Mêmes garde-fous que le comptoir : Turnstile à chaque carte et plafonds d'essais (comptoir_reserver).
import { admin, cleanCard, isCardPaymentId, stancer, stancerConfigured, stancerCustomer, stancerTest } from "../_shared/stancer.ts";
import { confirmerEcheance, finDePeriode, type Formule, libelle, prixDe, safeError } from "../_shared/abonnement.ts";

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/$/, "");
// Retour du 3D Secure : cette fonction, qui accepte le POST de la banque et renvoie sur la page.
const RETOUR_3DS = `${Deno.env.get("SUPABASE_URL")}/functions/v1/michelia-plus?retour=3ds`;
const PAGE = "/la-cotisation";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((o) => o.trim());

function corsHeaders(origin: string | null): HeadersInit {
  const allow = allowedOrigins.includes("*") ? "*" : origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

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
  if (origin && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) {
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

  // Fermé : seuls passent les essais avec une clé de test Stancer (aucun argent réel), et les
  // administrateurs de Michel, pour un vrai essai avant l'ouverture (page /la-cotisation?essai=1).
  const ouvert = (await config("michelia_plus_actif")) === "true";
  if (!ouvert && !stancerTest() && !(await estAdmin(qui.id))) return reply(403, { error: "MichelIA+ n'est pas encore ouvert" }, origin);
  if (!stancerConfigured()) return reply(500, { error: "Paiement non configuré" }, origin);

  if (body?.confirmer !== undefined) {
    if (!isCardPaymentId(body.confirmer) || !(await echeanceDe(body.confirmer, qui.id))) {
      return reply(400, { error: "Paiement inconnu" }, origin);
    }
    return reply(200, await confirmerEcheance(body.confirmer), origin);
  }
  if (body?.souscrire === "mois" || body?.souscrire === "an") return souscrire(req, qui, body.souscrire, body, origin);
  return reply(400, { error: "Demande inconnue" }, origin);
});

// L'échéance appartient-elle bien à ce compte ?
async function echeanceDe(paiementId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("abonnement_echeances")
    .select("abonnements!inner(user_id)")
    .eq("paiement_id", paiementId)
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

  // Un abonnement en attente par essai de souscription ; deux cartes au plus par essai.
  const essai = stancerTest();
  const { data: abonnement, error } = await admin
    .from("abonnements")
    .insert({ user_id: qui.id, source: "web", formule, moyen: "carte", statut: "en_attente", prix_cents: prix, email: qui.email, essai })
    .select("id")
    .single();
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
    console.error("MichelIA+ : premier paiement refusé", res.status, safeError(res.data));
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

async function reserver(qui: Membre, essai: string): Promise<string> {
  const { data, error } = await admin.rpc("comptoir_reserver", { p_genre: "carte", p_user: qui.id, p_ip: qui.ip, p_paiement: essai });
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
