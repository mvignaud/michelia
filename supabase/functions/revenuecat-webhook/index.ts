// Fonction « revenuecat-webhook » : enregistre les pourboires payés dans les applis (achat intégré
// Apple ou Google, géré par RevenueCat), dans la même table que le web (voir docs/COMPTOIR.md).
// RevenueCat envoie l'en-tête Authorization réglé dans son tableau de bord ; il doit valoir
// « Bearer <REVENUECAT_WEBHOOK_AUTH> » (secret Supabase). Seuls les achats ponctuels
// (NON_RENEWING_PURCHASE) comptent. Idempotent : une ligne par transaction de boutique.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_AUTH = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Les produits des boutiques s'appellent pourboire_<id du palier> (pourboire_cafe, pourboire_fete…),
// avec un chiffre au bout quand une boutique a dû le recréer (pourboire_cafe2 sur l'App Store).
const PRODUIT = /^pourboire_([a-z_]+?)\d*$/;

const reply = (status: number, body: string) => new Response(body, { status });

// Comparaison en temps constant.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Prénom facultatif du carnet : lettres, espaces, tiret et apostrophe seulement, 30 caractères au plus.
function cleanFirstName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[^\p{L}\p{M} '’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .trim();
  return name || null;
}

async function config(key: string): Promise<string | undefined> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? undefined;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, "Méthode non permise");
  if (!WEBHOOK_AUTH || !same(req.headers.get("authorization") ?? "", `Bearer ${WEBHOOK_AUTH}`)) {
    return reply(401, "Non autorisé");
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = (await req.json())?.event;
  } catch {
    return reply(400, "Corps illisible");
  }
  // Les autres événements (TEST, abonnements, remboursements…) sont accusés réception sans rien faire.
  if (event?.type !== "NON_RENEWING_PURCHASE") return reply(200, "ok");
  if (event.environment !== "PRODUCTION" && (await config("comptoir_sandbox")) !== "true") return reply(200, "ok");

  const transaction = typeof event.transaction_id === "string" ? event.transaction_id : "";
  const palierId = PRODUIT.exec(String(event.product_id ?? ""))?.[1];
  if (!transaction || !palierId) return reply(200, "ok");

  // Montant payé, en euros : tel quel s'il est en euros, sinon converti depuis le prix en dollars.
  const rate = Number((await config("usd_eur")) ?? "0.92") || 0.92;
  const euros =
    event.currency === "EUR" && Number.isFinite(event.price_in_purchased_currency)
      ? Number(event.price_in_purchased_currency)
      : Number(event.price) * rate;
  const amount = Math.round(euros * 100);
  if (!Number.isInteger(amount) || amount <= 0) return reply(200, "ok");

  let paliers: { id: string }[] = [];
  try {
    paliers = JSON.parse((await config("comptoir_paliers")) ?? "[]");
  } catch {
    // JSON mal rempli : on retombe sur « autre ».
  }

  const { error } = await admin.from("pourboires").upsert(
    {
      store_transaction_id: `${event.store}:${transaction}`,
      canal: event.store === "PLAY_STORE" ? "android" : "ios",
      montant_cents: amount,
      devise: "eur",
      palier: paliers.some((p) => p.id === palierId) ? palierId : "autre",
      // Posé par l'appli juste avant l'achat (attribut RevenueCat « prenom »), seulement si la personne l'a écrit.
      prenom: cleanFirstName(event.subscriber_attributes?.prenom?.value),
    },
    { onConflict: "store_transaction_id", ignoreDuplicates: true },
  );
  // Une erreur de base fait rappeler RevenueCat plus tard, sans perdre le pourboire.
  if (error) return reply(500, "Enregistrement impossible");
  return reply(200, "ok");
});
