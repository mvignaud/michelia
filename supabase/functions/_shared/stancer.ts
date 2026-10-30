// Stancer (prestataire de paiement français) pour le comptoir de Michel : appels à l'API v2 et
// enregistrement d'un pourboire payé. Partagé par « comptoir-paiement » (création et confirmation
// depuis la page) et « stancer-webhook » (confirmation quand Stancer prévient). Voir docs/COMPTOIR.md.
// Sans SDK : un simple fetch, clé secrète STANCER_API_KEY (stest_… ou sprod_…) en Basic Auth.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const STANCER_API_KEY = Deno.env.get("STANCER_API_KEY") ?? "";
const API = "https://api.stancer.com/v2";

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
  await admin.from("stancer_webhook").update({ webhook_id: String(res.data?.id ?? ""), secret }).eq("mode", MODE);
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
  const res = await fetch(`${API}${path}`, {
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

// Statuts d'un paiement Stancer qui veulent dire « l'argent arrive ».
const PAID = ["to_capture", "capture_sent", "captured"];
// Statuts définitifs d'échec : inutile d'attendre.
const FAILED = ["refused", "failed", "expired", "canceled", "cancelled"];

export type Confirmation =
  | { etat: "paye"; palier: string }
  | { etat: "attente" }
  | { etat: "refuse" }
  | { etat: "inconnu" };

// Relit le paiement chez Stancer (jamais sur la foi du navigateur ou du corps du webhook), capture
// s'il est seulement autorisé, puis écrit le pourboire. Rejouable : une ligne par payment intent.
export async function confirmPayment(intentId: string): Promise<Confirmation> {
  const { data: attente } = await admin.from("comptoir_attente").select("*").eq("paiement_id", intentId).maybeSingle();
  // Un paiement que notre comptoir n'a pas créé ne nous regarde pas.
  if (!attente) return { etat: "inconnu" };

  const intent = await stancer("GET", `/payment_intents/${intentId}`);
  if (!intent.ok || !intent.data) {
    console.error("Stancer : payment intent illisible", intent.status, intent.data?.error?.message ?? intent.data?.message);
    return { etat: "attente" };
  }
  let statut = String(intent.data.status ?? "");
  let montant = Number(intent.data.amount);
  const paymentId = typeof intent.data.payment === "string" ? intent.data.payment : "";
  if (paymentId) {
    const payment = await stancer("GET", `/payments/${encodeURIComponent(paymentId)}`);
    if (payment.ok && payment.data) {
      statut = String(payment.data.status ?? statut);
      montant = Number(payment.data.amount ?? montant);
    }
  }

  // Autorisé mais pas encore capturé : on capture (le pourboire est « vendu » tout de suite).
  if (statut === "authorized") {
    let capture = await stancer("POST", `/payment_intents/${intentId}/capture`);
    if (!capture.ok && (capture.status === 404 || capture.status === 405)) {
      capture = await stancer("PATCH", `/payment_intents/${intentId}`, { capture: true });
    }
    if (!capture.ok) {
      console.error("Stancer : capture refusée", capture.status, capture.data?.error?.message ?? capture.data?.message);
      return { etat: "attente" };
    }
    statut = "to_capture";
  }

  if (FAILED.includes(statut)) return { etat: "refuse" };
  if (!PAID.includes(statut)) return { etat: "attente" };
  // Le montant payé doit être celui du palier choisi (fixé côté serveur à la création).
  if (montant !== attente.montant_cents) {
    console.error("Stancer : montant inattendu", intentId, montant, attente.montant_cents);
    return { etat: "inconnu" };
  }

  const { error } = await admin.from("pourboires").upsert(
    {
      paiement_id: intentId,
      prestataire: "stancer",
      montant_cents: montant,
      devise: String(intent.data.currency ?? "eur").toLowerCase().slice(0, 3),
      palier: attente.palier,
      prenom: attente.prenom,
      email: attente.email,
      essai: attente.essai,
      canal: "web",
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
