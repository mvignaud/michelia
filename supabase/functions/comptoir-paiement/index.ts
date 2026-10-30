// Fonction « comptoir-paiement » : ouvre une session Stripe Checkout (ui_mode elements) pour le
// formulaire de paiement de la page /comptoir (voir docs/COMPTOIR.md). Le navigateur envoie {palier} ;
// le prix et le nom viennent toujours de app_config (comptoir_paliers), jamais du client. La fonction
// renvoie {clientSecret}, que Stripe.js utilise pour afficher les champs de paiement dans la page.
// Juste avant de payer, le navigateur renvoie {session, prenom} : le prénom du carnet des copains
// est alors rangé dans les metadata de la session, que le webhook relit.
// Sans SDK Stripe : un simple fetch vers l'API, avec STRIPE_SECRET_KEY (secret Supabase).
// Avec Stancer (app_config comptoir_prestataire = 'stancer') : {palier, email, prenom} crée un payment
// intent et renvoie {url} (les champs de carte Stancer, affichés en iframe) ; {confirmer: pi_…} relit le
// paiement chez Stancer et écrit le pourboire s'il est payé (voir _shared/stancer.ts).
// {payer: pi_…, carte, captcha} : la carte saisie dans notre formulaire part chez Stancer (jamais gardée).
// Ouvrir un paiement comme envoyer une carte demande une session Supabase (compte anonyme créé avec le
// captcha Turnstile) et passe par des plafonds comptés en base (comptoir_reserver), contre les robots
// qui testent des cartes volées. Seul le visiteur qui a ouvert un paiement peut y mettre une carte.
import {
  admin,
  cleanCard,
  cleanEmail,
  cleanFirstName,
  confirmPayment,
  ensureWebhook,
  isPaymentIntentId,
  payWithCard,
  stancer,
  stancerConfigured,
  stancerTest,
} from "../_shared/stancer.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
// Même version que Stripe.js chargé par la page (@stripe/stripe-js 10.x = « endive ») :
// la session et le formulaire intégré doivent parler la même version de l'API.
const STRIPE_VERSION = "2026-09-30.endive";

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/$/, "");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim());

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

function reply(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

type Palier = { id: string; nom: string; prix_cents: number };

async function config(key: string): Promise<string | undefined> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? undefined;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "Méthode non permise" }, origin);
  // Un navigateur d'un autre site n'a rien à faire ici (appels sans Origin, hors navigateur, tolérés).
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

  const avecStancer = (await config("comptoir_prestataire")) === "stancer";
  // Comptoir fermé : seuls passent les essais avec une clé de test Stancer (aucun argent réel).
  const ouvert = (await config("comptoir_actif")) === "true";
  const essai = avecStancer && stancerTest() && (await config("comptoir_essai")) === "true";
  if (!ouvert && !essai) return reply(403, { error: "Le comptoir est fermé" }, origin);
  if (avecStancer ? !stancerConfigured() : !STRIPE_SECRET_KEY) return reply(500, { error: "Paiement non configuré" }, origin);

  if (avecStancer && body?.confirmer !== undefined) {
    if (!isPaymentIntentId(body.confirmer)) return reply(400, { error: "Paiement inconnu" }, origin);
    return reply(200, await confirmPayment(body.confirmer), origin);
  }
  if (avecStancer && body?.payer !== undefined) return payer(req, body, origin);
  if (!avecStancer && typeof body?.session === "string") return savePrenom(body.session, body.prenom, origin);
  const palierId = typeof body?.palier === "string" ? body.palier : "";

  let paliers: Palier[] = [];
  try {
    paliers = JSON.parse((await config("comptoir_paliers")) ?? "[]");
  } catch {
    return reply(500, { error: "Paliers illisibles" }, origin);
  }
  const palier = paliers.find((p) => p.id === palierId);
  if (!palier || !Number.isInteger(palier.prix_cents) || palier.prix_cents <= 0 || !palier.nom) {
    return reply(400, { error: "Palier inconnu" }, origin);
  }

  if (avecStancer) {
    const qui = await visiteur(req);
    if (!qui) return reply(401, { error: "Session requise" }, origin);
    const place = await reserver("paiement", qui, null);
    if (place !== "ok") return reply(place === "erreur" ? 500 : 429, { error: "Trop d'essais" }, origin);
    return createStancerPayment(palier, body, stancerTest(), qui.id, origin);
  }

  // Stripe Tax en option (app_config stripe_tax = 'true') : les prix affichés sont TTC.
  const taxe = (await config("stripe_tax")) === "true";

  const form = new URLSearchParams({
    mode: "payment",
    // Champs de paiement (Payment Element) dans notre propre formulaire, aux couleurs de Michel.
    ui_mode: "elements",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(palier.prix_cents),
    "line_items[0][price_data][product_data][name]": palier.nom,
    "metadata[palier]": palier.id,
    locale: "fr",
  });

  if (taxe) {
    form.set("automatic_tax[enabled]", "true");
    form.set("line_items[0][price_data][tax_behavior]", "inclusive");
  }

  const res = await stripe("checkout/sessions", form);
  const session = await res.json().catch(() => null);
  if (!res.ok || !session?.client_secret) {
    // Le détail reste dans les journaux de la fonction, jamais renvoyé au navigateur.
    console.error("Stripe a refusé la session", res.status, session?.error?.type, session?.error?.message);
    return reply(502, { error: "Paiement indisponible" }, origin);
  }
  return reply(200, { clientSecret: session.client_secret }, origin);
});

function stripe(path: string, form: URLSearchParams): Promise<Response> {
  return fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_VERSION,
    },
    body: form,
  });
}

// Range le prénom (facultatif, nettoyé à nouveau par le webhook) dans la session encore ouverte.
async function savePrenom(sessionId: string, prenom: unknown, origin: string | null): Promise<Response> {
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return reply(400, { error: "Session inconnue" }, origin);
  const texte = typeof prenom === "string" ? prenom.trim().slice(0, 30) : "";
  if (!texte) return reply(200, { ok: true }, origin);
  const res = await stripe(`checkout/sessions/${sessionId}`, new URLSearchParams({ "metadata[prenom]": texte }));
  if (!res.ok) {
    const erreur = await res.json().catch(() => null);
    console.error("Stripe a refusé le prénom", res.status, erreur?.error?.type, erreur?.error?.message);
    // Le paiement passe quand même : le pourboire sera simplement anonyme.
  }
  return reply(200, { ok: true }, origin);
}

// Stancer : payment intent au prix du palier, carte seule (le prélèvement SEPA sera pour MichelIA+).
// Ce que le visiteur a saisi attend dans comptoir_attente jusqu'à la confirmation du paiement.
// deno-lint-ignore no-explicit-any
async function createStancerPayment(palier: Palier, body: any, essai: boolean, userId: string, origin: string | null): Promise<Response> {
  const email = cleanEmail(body?.email);
  if (!email) return reply(400, { error: "E-mail invalide" }, origin);
  const res = await stancer("POST", "/payment_intents/", {
    amount: palier.prix_cents,
    currency: "eur",
    description: `Pourboire Michel : ${palier.nom}`.slice(0, 64),
    methods_allowed: ["card"],
    return_url: `${SITE_URL}/comptoir?merci=${encodeURIComponent(palier.id)}`,
  });
  const id = res.data?.id;
  const url = res.data?.url;
  if (!res.ok || !isPaymentIntentId(id) || typeof url !== "string" || !url.startsWith("https://")) {
    console.error("Stancer a refusé le paiement", res.status, JSON.stringify(res.data?.error ?? res.data ?? null).slice(0, 500));
    return reply(502, { error: "Paiement indisponible" }, origin);
  }
  const { error } = await admin.from("comptoir_attente").insert({
    paiement_id: id,
    palier: palier.id,
    montant_cents: palier.prix_cents,
    prenom: cleanFirstName(body?.prenom),
    email,
    essai,
    user_id: userId,
  });
  if (error) {
    console.error("Paiement en attente non enregistré", error.message);
    return reply(500, { error: "Paiement indisponible" }, origin);
  }
  // Premier paiement du mode (test ou réel) : on enregistre le webhook chez Stancer, sans faire attendre.
  EdgeRuntime.waitUntil(ensureWebhook().catch((e) => console.error("Stancer : webhook", e)));
  return reply(200, { id, url }, origin);
}

// Le visiteur derrière la requête : session Supabase obligatoire (compte anonyme créé avec le captcha
// Turnstile, ou membre), et son adresse IP pour les plafonds.
async function visiteur(req: Request): Promise<{ id: string; ip: string } | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  if (!data?.user) return null;
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);
  return { id: data.user.id, ip };
}

// Compte et inscrit l'essai d'un seul coup en base (sous verrou). Toute erreur refuse : on ne laisse
// jamais passer une carte sans l'avoir comptée.
async function reserver(genre: "carte" | "paiement", qui: { id: string; ip: string }, paiement: string | null): Promise<string> {
  const { data, error } = await admin.rpc("comptoir_reserver", {
    p_genre: genre,
    p_user: qui.id,
    p_ip: qui.ip,
    p_paiement: paiement,
  });
  if (error) {
    console.error("Comptoir : plafond illisible", error.message);
    return "erreur";
  }
  if (data === "global") console.error(`Comptoir : ALERTE plafond global atteint (${genre}), robots possibles`);
  return String(data);
}

// Turnstile à chaque carte envoyée, si la clé secrète est posée (TURNSTILE_SECRET_KEY).
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
async function captchaOk(token: unknown, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
  if (ip) form.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  return data?.success === true;
}

// deno-lint-ignore no-explicit-any
async function payer(req: Request, body: any, origin: string | null): Promise<Response> {
  if (!isPaymentIntentId(body.payer)) return reply(400, { error: "Paiement inconnu" }, origin);
  const qui = await visiteur(req);
  if (!qui) return reply(401, { error: "Session requise" }, origin);
  const carte = cleanCard(body.carte);
  if (!carte) return reply(400, { error: "Carte invalide" }, origin);
  // Seul le visiteur qui a ouvert le paiement peut y mettre une carte.
  const { data: attente } = await admin.from("comptoir_attente").select("user_id").eq("paiement_id", body.payer).maybeSingle();
  if (!attente || attente.user_id !== qui.id) return reply(400, { error: "Paiement inconnu" }, origin);
  if (!(await captchaOk(body.captcha, qui.ip))) return reply(403, { error: "Vérification anti-robot échouée" }, origin);

  const place = await reserver("carte", qui, body.payer);
  if (place !== "ok") return reply(place === "erreur" ? 500 : 429, { error: "Trop d'essais" }, origin);
  return reply(200, await payWithCard(body.payer, carte), origin);
}
