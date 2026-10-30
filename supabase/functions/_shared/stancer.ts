// Stancer (prestataire de paiement français) pour le comptoir de Michel : appels à l'API v2 et
// enregistrement d'un pourboire payé. Partagé par « comptoir-paiement » (création et confirmation
// depuis la page) et « stancer-webhook » (confirmation quand Stancer prévient). Voir docs/COMPTOIR.md.
// Sans SDK : un simple fetch, clé secrète STANCER_API_KEY (stest_… ou sprod_…) en Basic Auth.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const STANCER_API_KEY = Deno.env.get("STANCER_API_KEY") ?? "";
const API = "https://api.stancer.com/v2";
// Les clients (customers) sont encore sur l'API v1 de Stancer.
const API_V1 = "https://api.stancer.com";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export const stancerConfigured = () => /^s(test|prod)_\S+$/.test(STANCER_API_KEY);
// Clé de test : aucun argent réel ne bouge, les pourboires sont marqués « essai ».
export const stancerTest = () => STANCER_API_KEY.startsWith("stest_");

const MODE = STANCER_API_KEY.startsWith("sprod_") ? "prod" : "test";

// Enregistre une fois (par mode, test ou réel) l'adresse de stancer-webhook chez Stancer, qui n'a pas
// de rubrique Webhooks dans son espace client, et range le secret de signature en base. La ligne est
// posée avant l'appel : deux paiements simultanés n'enregistrent pas deux fois. En cas d'échec, la
// ligne vide est retirée pour réessayer au paiement suivant ; le paiement, lui, n'attend pas.
export async function ensureWebhook(): Promise<void> {
  if (!stancerConfigured()) return;
  // Une ligne restée sans secret plus de 2 minutes (enregistrement interrompu) est retentée.
  await admin
    .from("stancer_webhook")
    .delete()
    .eq("mode", MODE)
    .is("secret", null)
    .lt("created_at", new Date(Date.now() - 120_000).toISOString());
  const { data: posee, error } = await admin
    .from("stancer_webhook")
    .upsert({ mode: MODE }, { onConflict: "mode", ignoreDuplicates: true })
    .select("mode");
  if (error || !posee?.length) return; // Déjà fait (ou en cours), ou table absente.
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/stancer-webhook`;
  const res = await stancer("POST", "/webhooks/", { url });
  const secret = res.data?.secret;
  if (!res.ok || typeof secret !== "string" || !secret) {
    console.error("Stancer : webhook non enregistré", res.status, JSON.stringify(res.data ?? null).slice(0, 300));
    await admin.from("stancer_webhook").delete().eq("mode", MODE).is("secret", null);
    return;
  }
  const saved = await admin.from("stancer_webhook").update({ webhook_id: String(res.data?.id ?? ""), secret }).eq("mode", MODE);
  if (saved.error) {
    console.error("Stancer : secret du webhook non rangé", saved.error.message);
    return;
  }
  console.log("Stancer : webhook enregistré", MODE, res.data?.id);
}

// Secrets de signature connus : celui des secrets Supabase s'il existe, puis ceux rangés en base.
export async function webhookSecrets(): Promise<string[]> {
  const secrets = [Deno.env.get("STANCER_WEBHOOK_SECRET") ?? ""];
  const { data } = await admin.from("stancer_webhook").select("secret");
  for (const row of data ?? []) secrets.push(row.secret ?? "");
  return secrets.filter(Boolean);
}

// Un payment intent Stancer : pi_ suivi de lettres et chiffres.
export const isPaymentIntentId = (id: unknown): id is string =>
  typeof id === "string" && /^pi_[A-Za-z0-9]{6,64}$/.test(id);

// deno-lint-ignore no-explicit-any
export async function stancer(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(path.startsWith("/v1/") ? `${API_V1}${path}` : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${STANCER_API_KEY}:`)}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Statuts d'un remboursement demandé, envoyé ou fait ; payment_canceled : paiement annulé avant d'être encaissé.
const REFUND_OK = ["to_refund", "refund_sent", "refunded", "payment_canceled"];

export type Remboursement = { id: string; montant: number; cree: number };

// Les remboursements d'un paiement (paym_…), du plus ancien au plus récent, et son montant s'il a été
// annulé avant capture (rien encaissé). null si le paiement est illisible.
export async function remboursementsDe(paymentId: string): Promise<{ annule: number | null; liste: Remboursement[] } | null> {
  let payment = await stancer("GET", `/v1/checkout/${paymentId}`);
  // Paiement né d'un payment intent (page Stancer) : peut-être seulement lisible en v2.
  if (!payment.ok || !payment.data) payment = await stancer("GET", `/payments/${paymentId}`);
  if (!payment.ok || !payment.data) {
    console.error("Remboursements : paiement illisible", paymentId, payment.status);
    return null;
  }
  // Paiement annulé avant capture : rien n'a été encaissé.
  if (["canceled", "cancelled"].includes(String(payment.data.status ?? ""))) {
    return { annule: Number(payment.data.amount) || 0, liste: [] };
  }
  const liste: Remboursement[] = [];
  for (const item of Array.isArray(payment.data.refunds) ? payment.data.refunds : []) {
    const refund = typeof item === "string" ? (await stancer("GET", `/v1/refunds/${encodeURIComponent(item)}`)).data : item;
    if (!REFUND_OK.includes(String(refund?.status ?? ""))) continue;
    liste.push({ id: String(refund.id ?? item), montant: Number(refund.amount) || 0, cree: Number(refund.created) || 0 });
  }
  liste.sort((a, b) => a.cree - b.cree);
  return { annule: null, liste };
}

// Statuts d'un paiement Stancer qui veulent dire « l'argent arrive ».
const PAID = ["to_capture", "capture_sent", "captured"];
// Statuts définitifs d'échec : inutile d'attendre.
const FAILED = ["refused", "failed", "expired", "canceled", "cancelled", "unpaid"];

export type Confirmation =
  | { etat: "paye"; palier: string }
  | { etat: "attente" }
  | { etat: "refuse" }
  | { etat: "inconnu" };

// Un paiement par carte de l'API v1 (formulaire maison) : paym_ suivi de lettres et chiffres.
export const isCardPaymentId = (id: unknown): id is string =>
  typeof id === "string" && /^paym_[A-Za-z0-9]{6,64}$/.test(id);

// Le payment intent auquel se rattache un paiement v1 : son unique_id vaut « pi_….xxxx » (voir payWithCard).
export const intentOfCardPayment = (uniqueId: unknown): string | null => {
  const intent = typeof uniqueId === "string" ? uniqueId.split(".")[0] : "";
  return isPaymentIntentId(intent) ? intent : null;
};

// Statuts d'authentification (3D Secure) v1 qui disent « c'est raté ».
const AUTH_FAILED = ["declined", "failed", "expired"];

// Relit le paiement chez Stancer (jamais sur la foi du navigateur ou du corps du webhook), capture
// s'il est seulement autorisé, puis écrit le pourboire. Rejouable : une ligne par payment intent.
// Avec cardPaymentId (paym_…, formulaire maison), c'est ce paiement v1 qui fait foi, à condition
// qu'il ait été créé pour ce payment intent (unique_id posé par notre serveur).
export async function confirmPayment(intentId: string, cardPaymentId?: string): Promise<Confirmation> {
  const { data: attente } = await admin.from("comptoir_attente").select("*").eq("paiement_id", intentId).maybeSingle();
  // Un paiement que notre comptoir n'a pas créé ne nous regarde pas.
  if (!attente) return { etat: "inconnu" };

  let statut: string;
  let montant: number;
  let devise: string;
  let capturer: () => ReturnType<typeof stancer>;
  // Le paiement Stancer (paym_…) derrière l'intent, gardé pour relire plus tard les remboursements.
  let paiementCarte: string | null = cardPaymentId ?? null;
  if (cardPaymentId) {
    const payment = await stancer("GET", `/v1/checkout/${cardPaymentId}`);
    if (!payment.ok || !payment.data) {
      console.error("Stancer : paiement carte illisible", payment.status, safeError(payment.data));
      return { etat: "attente" };
    }
    if (intentOfCardPayment(payment.data.unique_id) !== intentId) return { etat: "inconnu" };
    statut = String(payment.data.status ?? "");
    montant = Number(payment.data.amount);
    devise = String(payment.data.currency ?? "eur").toLowerCase();
    const auth = String(payment.data.auth?.status ?? "");
    if (!statut && AUTH_FAILED.includes(auth)) statut = "refused";
    capturer = () => stancer("PATCH", `/v1/checkout/${cardPaymentId}`, { status: "capture" });
    // 3D Secure réussi mais paiement pas encore lancé : c'est à nous de demander la capture.
    if (!statut && auth === "success") {
      const capture = await capturer();
      if (!capture.ok) {
        console.error("Stancer : capture après 3D Secure refusée", capture.status, safeError(capture.data));
        return { etat: "attente" };
      }
      statut = String(capture.data?.status ?? "") || "to_capture";
    }
    if (!PAID.includes(statut)) console.log("Stancer : paiement carte en attente", cardPaymentId, statut || "-", auth || "-");
  } else {
    const intent = await stancer("GET", `/payment_intents/${intentId}`);
    if (!intent.ok || !intent.data) {
      console.error("Stancer : payment intent illisible", intent.status, intent.data?.error?.message ?? intent.data?.message);
      return { etat: "attente" };
    }
    statut = String(intent.data.status ?? "");
    montant = Number(intent.data.amount);
    devise = String(intent.data.currency ?? "eur").toLowerCase();
    const paymentId = typeof intent.data.payment === "string" ? intent.data.payment : "";
    if (isCardPaymentId(paymentId)) paiementCarte = paymentId;
    if (paymentId) {
      const payment = await stancer("GET", `/payments/${encodeURIComponent(paymentId)}`);
      if (payment.ok && payment.data) {
        statut = String(payment.data.status ?? statut);
        montant = Number(payment.data.amount ?? montant);
      }
    }
    capturer = async () => {
      const capture = await stancer("POST", `/payment_intents/${intentId}/capture`);
      if (capture.ok || (capture.status !== 404 && capture.status !== 405)) return capture;
      return stancer("PATCH", `/payment_intents/${intentId}`, { capture: true });
    };
  }

  // Le montant doit être celui du palier choisi (fixé côté serveur à la création), avant toute capture.
  if (montant !== attente.montant_cents || devise !== "eur") {
    console.error("Stancer : montant inattendu", intentId, montant, attente.montant_cents);
    return { etat: "inconnu" };
  }

  // Autorisé mais pas encore capturé : on capture (le pourboire est « vendu » tout de suite).
  if (statut === "authorized") {
    const capture = await capturer();
    if (!capture.ok) {
      console.error("Stancer : capture refusée", capture.status, safeError(capture.data));
      return { etat: "attente" };
    }
    statut = "to_capture";
  }

  if (FAILED.includes(statut)) return { etat: "refuse" };
  if (!PAID.includes(statut)) return { etat: "attente" };

  const { error } = await admin.from("pourboires").upsert(
    {
      paiement_id: intentId,
      prestataire: "stancer",
      montant_cents: montant,
      devise,
      palier: attente.palier,
      prenom: attente.prenom,
      email: attente.email,
      essai: attente.essai,
      canal: "web",
      paiement_carte: paiementCarte,
      // Numéro de reçu tiré à la création du paiement (colonne posée avec la facturation E-KO).
      ...(attente.numero_recu ? { numero_recu: attente.numero_recu } : {}),
    },
    { onConflict: "paiement_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("Pourboire non enregistré", error.message);
    return { etat: "attente" };
  }
  return { etat: "paye", palier: attente.palier };
}

// Prénom facultatif du carnet : lettres, espaces, tiret et apostrophe seulement, 30 caractères au plus.
export function cleanFirstName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[^\p{L}\p{M} '’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .trim();
  return name || null;
}

export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Le client chez Stancer (nom et e-mail), pour qu'il apparaisse dans l'espace Stancer. Facultatif :
// si Stancer refuse, le paiement part sans client. Un e-mail déjà connu de Stancer (409) renvoie le
// client existant.
export async function stancerCustomer(email: string, nom: string | null, externalId: string): Promise<string | null> {
  const res = await stancer("POST", "/v1/customers/", {
    email,
    ...(nom && nom.length >= 4 ? { name: nom.slice(0, 64) } : {}),
    external_id: externalId.slice(0, 36),
  });
  const id = res.data?.id ?? res.data?.error?.message?.id;
  if (typeof id === "string" && id.startsWith("cust_")) return id;
  console.error("Stancer : client non créé", res.status, safeError(res.data));
  return null;
}

// --- Formulaire de carte maison (« full API » Stancer) ---
// Les numéros de carte traversent la fonction le temps d'un appel à Stancer : ils ne sont jamais
// enregistrés, ni en base ni dans les journaux (voir docs/COMPTOIR.md, « Formulaire de carte »).

export type Carte = { numero: string; mois: number; annee: number; cvc: string };

// Contrôle de forme (longueur, clé de Luhn, date pas passée) avant d'envoyer quoi que ce soit.
// deno-lint-ignore no-explicit-any
export function cleanCard(raw: any): Carte | null {
  const numero = String(raw?.numero ?? "").replace(/[\s-]/g, "");
  const cvc = String(raw?.cvc ?? "").trim();
  const mois = Number(raw?.mois);
  let annee = Number(raw?.annee);
  if (annee < 100) annee += 2000;
  if (!/^\d{12,19}$/.test(numero) || !/^\d{3,4}$/.test(cvc)) return null;
  if (!Number.isInteger(mois) || mois < 1 || mois > 12 || !Number.isInteger(annee)) return null;
  const now = new Date();
  if (annee < now.getFullYear() || (annee === now.getFullYear() && mois < now.getMonth() + 1) || annee > now.getFullYear() + 25) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < numero.length; i++) {
    let d = Number(numero[numero.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? { numero, mois, annee, cvc } : null;
}

// Un message d'erreur de Stancer pour les journaux, sans aucune suite de chiffres (au cas où).
// deno-lint-ignore no-explicit-any
const safeError = (data: any) =>
  String(data?.error?.message ?? data?.message ?? "").replace(/\d{3,}/g, "…").slice(0, 200);

export type Paiement =
  | { etat: "paye"; palier: string }
  | { etat: "authentification"; url: string; paiement: string }
  | { etat: "refuse" }
  | { etat: "attente" }
  | { etat: "inconnu" };

// Le navigateur du visiteur, que Stancer exige pour le 3D Secure (et dont il tire la localisation).
export type Appareil = { ip: string; userAgent: string; accept: string; langues: string };

// Paie avec la carte par l'API v1 de Stancer (POST /v1/checkout/) : la v2 ne renvoie pas la page 3D Secure
// de la banque, seulement sa page de paiement complète. Le paiement v1 reprend le montant, la
// description, le client et le numéro de reçu du payment intent, et porte en unique_id « pi_….xxxx »
// (un suffixe par essai, Stancer refusant deux fois le même unique_id). Réponse : payé, refusé, ou
// l'adresse 3D Secure de la banque (auth.redirect_url), qui revient ensuite sur returnUrl.
export async function payWithCard(intentId: string, carte: Carte, appareil: Appareil, returnUrl: string): Promise<Paiement> {
  const { data: attente } = await admin.from("comptoir_attente").select("*").eq("paiement_id", intentId).maybeSingle();
  if (!attente) return { etat: "inconnu" };
  const intent = await stancer("GET", `/payment_intents/${intentId}`);
  if (!intent.ok || !intent.data) {
    console.error("Stancer : payment intent illisible", intent.status, safeError(intent.data));
    return { etat: "attente" };
  }
  const essai = crypto.getRandomValues(new Uint8Array(3)).reduce((t, b) => t + b.toString(16).padStart(2, "0"), "");
  const uniqueId = `${intentId}.${essai}`;
  // Stancer limite unique_id à 36 caractères : au-delà, on ne saurait pas relier le paiement à l'intent.
  if (uniqueId.length > 36) {
    console.error("Stancer : identifiant de payment intent trop long", intentId);
    return { etat: "attente" };
  }
  const customer = typeof intent.data.customer === "string" ? intent.data.customer : intent.data.customer?.id;
  const res = await stancer("POST", "/v1/checkout/", {
    amount: attente.montant_cents,
    currency: "eur",
    description: String(intent.data.description ?? "Pourboire Michel").slice(0, 64),
    unique_id: uniqueId,
    ...(typeof intent.data.order_id === "string" && intent.data.order_id ? { order_id: intent.data.order_id } : {}),
    ...(typeof customer === "string" && customer.startsWith("cust_") ? { customer } : {}),
    card: { number: carte.numero, exp_month: carte.mois, exp_year: carte.annee, cvc: carte.cvc },
    auth: { status: "request", return_url: returnUrl },
    device: {
      ip: appareil.ip,
      // Le port source du visiteur n'arrive pas jusqu'à la fonction : celui du site (HTTPS).
      port: 443,
      ...(appareil.userAgent ? { user_agent: appareil.userAgent.slice(0, 256) } : {}),
      ...(appareil.accept ? { http_accept: appareil.accept.slice(0, 2048) } : {}),
      ...(appareil.langues ? { languages: appareil.langues.slice(0, 32) } : {}),
    },
  });
  const paymentId = res.data?.id;
  if (!res.ok || !isCardPaymentId(paymentId)) {
    console.error("Stancer : paiement carte refusé", res.status, safeError(res.data));
    return res.status >= 500 ? { etat: "attente" } : { etat: "refuse" };
  }
  // Tant que le paiement n'est ni passé ni refusé, une adresse de redirection veut dire 3D Secure à faire.
  const redirect = res.data.auth?.redirect_url;
  const statut = String(res.data.status ?? "");
  if (typeof redirect === "string" && redirect.startsWith("https://") && !PAID.includes(statut) && !FAILED.includes(statut) && statut !== "authorized") {
    return { etat: "authentification", url: redirect, paiement: paymentId };
  }
  return confirmPayment(intentId, paymentId);
}
