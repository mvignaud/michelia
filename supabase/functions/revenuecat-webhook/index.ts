// Fonction « revenuecat-webhook » : enregistre les pourboires payés dans les applis (achat intégré
// Apple ou Google, géré par RevenueCat), dans la même table que le web (voir docs/COMPTOIR.md).
// RevenueCat envoie tel quel l'en-tête Authorization réglé dans son tableau de bord : il vaut
// <REVENUECAT_WEBHOOK_AUTH> (secret Supabase), précédé ou non de « Bearer ». Pourboires : achats ponctuels
// (NON_RENEWING_PURCHASE), une ligne par transaction de boutique. MichelIA+ : abonnements
// auto-renouvelables michelia_plus_mois / michelia_plus_an, suivis dans la table abonnements (voir
// abonnementBoutique plus bas). Idempotent : RevenueCat peut renvoyer un événement sans doublon.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_AUTH = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Les produits des boutiques s'appellent pourboire_<id du palier> (pourboire_cafe, pourboire_fete…),
// avec un chiffre au bout quand une boutique a dû le recréer (pourboire_cafe2 sur l'App Store).
const PRODUIT = /^pourboire_([a-z_]+?)\d*$/;

// MichelIA+ dans les boutiques : michelia_plus_mois ou michelia_plus_an (chiffre au bout toléré, comme les pourboires).
// Chez Google, RevenueCat ajoute le forfait de base : michelia_plus_mois:mois.
const ABONNEMENT = /^michelia_plus_(mois|an)\d*(?::[a-z0-9-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!WEBHOOK_AUTH || !same(auth, WEBHOOK_AUTH.replace(/^Bearer\s+/i, "").trim())) {
    return reply(401, "Non autorisé");
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = (await req.json())?.event;
  } catch {
    return reply(400, "Corps illisible");
  }
  if (event?.environment !== "PRODUCTION" && (await config("comptoir_sandbox")) !== "true") return reply(200, "ok");
  if (ABONNEMENT.test(String(event?.product_id ?? ""))) return abonnementBoutique(event);
  // Les autres événements (TEST, remboursements…) sont accusés réception sans rien faire.
  if (event?.type !== "NON_RENEWING_PURCHASE") return reply(200, "ok");

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
      // Achat TestFlight ou test Google : compté à part (ni note du mois, ni carnet, ni facture).
      essai: event.environment !== "PRODUCTION",
    },
    { onConflict: "store_transaction_id", ignoreDuplicates: true },
  );
  // Une erreur de base fait rappeler RevenueCat plus tard, sans perdre le pourboire.
  if (error) return reply(500, "Enregistrement impossible");
  return reply(200, "ok");
});

// Ce que chaque événement d'abonnement RevenueCat fait du droit MichelIA+.
const STATUT: Record<string, string> = {
  INITIAL_PURCHASE: "actif",
  RENEWAL: "actif",
  PRODUCT_CHANGE: "actif",
  UNCANCELLATION: "actif",
  // Renouvellement coupé : le droit court jusqu'à la fin de la période payée.
  CANCELLATION: "resilie",
  // La boutique n'arrive pas à faire payer : on garde le droit pendant qu'elle réessaie.
  BILLING_ISSUE: "impaye",
  EXPIRATION: "expire",
};

// Abonnement MichelIA+ pris dans l'appli. L'appli ouvre RevenueCat avec l'identifiant du compte Michel
// (app_user_id), seul moyen de rattacher l'abonnement au bon compte. Une ligne par abonnement de
// boutique (transaction d'origine), mise à jour à chaque événement ; une échéance par paiement.
// deno-lint-ignore no-explicit-any
async function abonnementBoutique(event: any): Promise<Response> {
  const statut = STATUT[String(event.type)];
  if (!statut) return reply(200, "ok");
  const ids = [event.app_user_id, event.original_app_user_id, ...(Array.isArray(event.aliases) ? event.aliases : [])];
  const userId = ids.find((id) => typeof id === "string" && UUID.test(id));
  const origine = String(event.original_transaction_id ?? event.transaction_id ?? "");
  const formule = ABONNEMENT.exec(String(event.product_id))?.[1];
  if (!userId || !origine || !formule) {
    console.error("MichelIA+ boutique : compte ou transaction introuvable", event.type, event.store);
    return reply(200, "ok");
  }
  const store = event.store === "PLAY_STORE" ? "google" : "apple";
  const cle = `${event.store}:${origine}`;
  const ms = (v: unknown) => (Number(v) > 0 ? new Date(Number(v)).toISOString() : null);
  // Paiement raté chez la boutique : elle garde le droit pendant le délai de grâce, Michel aussi.
  const grace = event.type === "BILLING_ISSUE" ? ms(event.grace_period_expiration_at_ms) : null;
  const fin = [ms(event.expiration_at_ms), grace].filter(Boolean).sort().pop() ?? null;
  const quand = ms(event.event_timestamp_ms);
  const montant = await montantEuros(event);

  const { data: existant } = await admin.from("abonnements")
    .select("id, fin_periode, prix_cents, store_evenement_le").eq("store_transaction", cle).maybeSingle();
  // Les événements peuvent arriver dans le désordre : un événement plus ancien que le dernier appliqué
  // (EXPIRATION d'une vieille période arrivée après le RENEWAL) ne touche plus à l'abonnement ; son
  // paiement, s'il en porte un, est quand même noté plus bas.
  const perime = Boolean(existant?.store_evenement_le && quand && Date.parse(quand) < Date.parse(existant.store_evenement_le));
  const ligne = {
    user_id: userId,
    source: store,
    formule,
    statut,
    prix_cents: montant ?? existant?.prix_cents ?? 1,
    // Le dernier événement fait foi pour la fin de période (un remboursement peut l'avancer).
    fin_periode: fin ?? existant?.fin_periode ?? null,
    store_produit: String(event.product_id).slice(0, 100),
    store_transaction: cle,
    store_evenement_le: quand ?? existant?.store_evenement_le ?? null,
    essai: event.environment !== "PRODUCTION",
    // Date de la résiliation gardée jusqu'à l'expiration ; effacée si la personne se réabonne.
    resilie_le: statut === "resilie" ? new Date().toISOString() : statut === "actif" ? null : undefined,
    updated_at: new Date().toISOString(),
  };
  if (perime) console.log("MichelIA+ boutique : événement en retard, statut gardé", event.type, event.store);
  const enregistre = perime
    ? { data: { id: existant!.id }, error: null }
    : existant
    ? await admin.from("abonnements").update(ligne).eq("id", existant.id).select("id").single()
    : await admin.from("abonnements").insert(ligne).select("id").single();
  if (enregistre.error) {
    // Déjà abonné autrement (par le site), ou compte supprimé : rien à rejouer, mais on le signale.
    console.error("MichelIA+ boutique : abonnement non enregistré", event.type, enregistre.error.code, enregistre.error.message);
    return reply(["23505", "23503"].includes(enregistre.error.code) ? 200 : 500, "ok");
  }

  // Un paiement de la boutique : une échéance (rejouable, une par transaction).
  const transaction = typeof event.transaction_id === "string" ? event.transaction_id : "";
  const finPayee = ms(event.expiration_at_ms);
  if ((event.type === "INITIAL_PURCHASE" || event.type === "RENEWAL") && transaction && montant && finPayee) {
    const debut = ms(event.purchased_at_ms) ?? new Date().toISOString();
    const { error } = await admin.from("abonnement_echeances").upsert(
      {
        abonnement_id: enregistre.data.id,
        paiement_id: `${event.store}:${transaction}`,
        montant_cents: montant,
        periode_debut: debut,
        periode_fin: finPayee,
        statut: "paye",
        essai: event.environment !== "PRODUCTION",
      },
      { onConflict: "paiement_id", ignoreDuplicates: true },
    );
    if (error) return reply(500, "Enregistrement impossible");
  }
  return reply(200, "ok");
}

// Montant payé en centimes d'euro : tel quel en euros, sinon converti depuis le prix en dollars.
// deno-lint-ignore no-explicit-any
async function montantEuros(event: any): Promise<number | null> {
  const rate = Number((await config("usd_eur")) ?? "0.92") || 0.92;
  const euros =
    event.currency === "EUR" && Number.isFinite(event.price_in_purchased_currency)
      ? Number(event.price_in_purchased_currency)
      : Number(event.price) * rate;
  const cents = Math.round(euros * 100);
  return Number.isInteger(cents) && cents > 0 ? cents : null;
}
