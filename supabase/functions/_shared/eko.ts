// Client minimal de l'API de l'ERP E-KO (GOLDEN PRINT), doc : /mnt/project-files/factures/documentation-api-eko.md.
// Jeton Bearer EKO_API_TOKEN (secret des Edge Functions), le locataire vient du jeton.
// Habilitations du jeton : tiers.view, tiers.create, invoices.create, invoices.issue, payments.create,
// invoices.credit pour les avoirs, et pour MichelIA+ (plus bas) les habilitations des abonnements.
//
// Facture créée avec sa ligne (POST /invoices), émise sans aucun envoi au client (POST /invoices/{code}/issue),
// puis réglée par le paiement en ligne déjà encaissé (POST /payments, card_online + psp). Création et
// règlement portent une Idempotency-Key tirée de l'identifiant du paiement ; l'émission est rejouable, et
// E-KO n'enregistre jamais deux fois un même paiement du prestataire.

const EKO_API_URL = (Deno.env.get("EKO_API_URL") ?? "https://api.e-ko.fr/api/v1").replace(/\/+$/, "");
const EKO_API_TOKEN = Deno.env.get("EKO_API_TOKEN") ?? "";

export const ekoConfigure = () => !!EKO_API_TOKEN;

export class EkoError extends Error {
  constructor(public status: number, public body: unknown, chemin: string) {
    super(`E-KO ${chemin} : ${status} ${JSON.stringify(body).slice(0, 300)}`);
  }
}

// deno-lint-ignore no-explicit-any
async function eko(method: string, chemin: string, corps?: unknown, cle?: string, statut?: (s: number) => void): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${EKO_API_TOKEN}`, Accept: "application/json" };
  if (corps !== undefined) headers["Content-Type"] = "application/json";
  if (cle) headers["Idempotency-Key"] = cle;
  const response = await fetch(`${EKO_API_URL}${chemin}`, {
    method,
    headers,
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new EkoError(response.status, data, `${method} ${chemin}`);
  statut?.(response.status);
  return data;
}

// Le client générique des pourboires : un particulier sans e-mail, pour que rien ne lui soit jamais envoyé.
export async function tiersGenerique(nom: string): Promise<number> {
  const liste = await eko("GET", `/tiers?is_customer=1&per_page=100&search=${encodeURIComponent(nom)}`);
  const trouve = (liste?.data ?? []).find((t: { name?: string }) => t.name === nom);
  if (trouve) return Number(trouve.id);
  const cree = await eko("POST", "/tiers", { name: nom, is_customer: true, type_tiers: "PARTICULIER", default_currency: "EUR", default_country: "FR" }, `tiers-${nom}`);
  return Number(cree.data.id);
}

// Comptes de produit des lignes de facture, repris tels quels dans Pennylane (consigne E-KO, 1/11/2026) :
// un pourboire est une libéralité reçue (sans TVA), un abonnement MichelIA+ une prestation de services.
export const COMPTE_POURBOIRE = "758200";
export const COMPTE_ABONNEMENT = "706000";

export type Vente = {
  tierId: number;
  paiementId: string; // identifiant du paiement chez le prestataire (clés d'idempotence)
  transaction: string; // règlement chez le prestataire (paym_… chez Stancer) : E-KO y rattache les remboursements
  reference: string; // numéro de reçu MichelIA, aussi numéro de commande chez le prestataire
  libelle: string;
  montantTtcCents: number;
  date: string; // AAAA-MM-JJ, heure de Paris
  prestataire: string; // fournisseur de paiement au sens d'E-KO : « stancer », « stripe »
  tvaPourcent: number; // taux de TVA de la ligne : 20, ou 0 pour un pourboire
  compte: string; // compte de produit de la ligne : COMPTE_POURBOIRE ou COMPTE_ABONNEMENT
};

// Facture émise et réglée. `code` : numéro déjà obtenu lors d'un passage précédent ; `noter` le garde dès
// la création, pour qu'une reprise ne crée jamais une seconde facture. Rend le numéro (FA…).
export async function facturerVente(v: Vente, code: string | null, noter: (code: string) => Promise<void>): Promise<string> {
  const ttc = v.montantTtcCents / 100;
  if (!code) {
    const creee = await eko("POST", "/invoices", {
      tier_id: v.tierId,
      kind: "standard",
      reference: v.reference,
      title: v.libelle,
      currency: "EUR",
      issue_date: v.date,
      due_date: v.date,
      lines: [{
        description: v.libelle,
        quantity: 1,
        unit_price_ttc: ttc,
        vat_rate: v.tvaPourcent,
        account: v.compte,
        line_type: "service",
        external_ref: v.paiementId.slice(0, 64),
      }],
    }, `facture-${v.paiementId}`);
    code = String(creee.data.code);
    await noter(code);
  }

  let attente = false;
  const facture = await eko("POST", `/invoices/${encodeURIComponent(code)}/issue`, undefined, undefined, (s) => attente = s === 202);
  if (attente) throw new Error(`facture ${code} en attente de validation dans E-KO`);
  if (facture.data.status !== "paid") {
    await eko("POST", "/payments", {
      invoice_id: facture.data.id,
      paid_at: v.date,
      amount: ttc,
      currency: "EUR",
      method: "card_online",
      reference: v.transaction,
      psp: { provider: v.prestataire, payment_id: v.transaction },
    }, `reglement-${v.paiementId}`);
  }
  return code;
}

// Avoir E-KO sur une facture émise, pour un remboursement fait chez le prestataire : jamais envoyé au
// client (le client reçoit l'avoir de Michel). E-KO crée du même coup le décaissement, lié au règlement
// d'origine (psp.payment_id = paiementId). Tant que l'adresse n'est pas en service (404/405), rend null et
// l'appelant réessaiera au passage suivant. Rejouable : E-KO rend le même avoir pour un même remboursement.
// Un 422 (remboursement inconnu chez le prestataire, facture pas émise, règlement introuvable) ne se
// corrige pas en réessayant à l'identique : l'appelant le note et s'arrête. Rend le numéro de l'avoir (AV…).
// `remboursement` : identifiant du remboursement chez le prestataire (refd_… chez Stancer), quand Michel
// sait lequel c'est ; E-KO lit alors ce remboursement précis. Sinon E-KO lit ceux du paiement.
export async function avoirVente(a: {
  facture: string; numero: string; montantTtcCents: number; date: string; prestataire: string; paiementId: string;
  remboursement?: string | null;
}): Promise<string | null> {
  const refundId = a.remboursement ?? a.numero;
  try {
    const avoir = await eko("POST", `/invoices/${encodeURIComponent(a.facture)}/credit-note`, {
      amount_ttc: a.montantTtcCents / 100,
      reason: "Remboursement",
      reference: a.numero,
      issue: true,
      refund: { provider: a.prestataire, refund_id: refundId, payment_id: a.paiementId, date: a.date },
      // E-KO garde 24 h la réponse d'une clé, refus compris : la clé suit le remboursement envoyé. Un même
      // refund_id ne fait jamais deux avoirs chez E-KO.
    }, `avoir-${a.numero}-${refundId}`);
    return String(avoir.data.code);
  } catch (e) {
    if (e instanceof EkoError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

// ── Abonnements MichelIA+ (module Abonnements d'E-KO, réponse du 1/11/2026 :
// /mnt/project-files/factures/reponse-eko-abonnements.md). E-KO tient le contrat, facture chaque période
// et la prélève chez Stancer sur la carte (card_…) ou le mandat (sepa_…) obtenus par Michel au premier
// paiement. Plans réglés dans l'écran d'E-KO : prix TTC, compte 706000, aucun e-mail au client, pas de
// résiliation automatique en fin de relances. Habilitations en plus : tiers.create, subscriptions.view,
// subscriptions.create, subscriptions.update, subscriptions.cancel, subscription-plans.view.

// Un abonné : client particulier nominatif, sans e-mail (rien ne doit jamais partir d'E-KO vers lui).
// Rend le code du tiers (CU…). Rejouable : la clé suit le compte Michel.
export async function tiersAbonne(userId: string, nom: string): Promise<string> {
  const cree = await eko("POST", "/tiers", {
    name: nom.slice(0, 120),
    is_customer: true,
    type_tiers: "PARTICULIER",
    default_currency: "EUR",
    default_country: "FR",
  }, `tiers-abonne-${userId}`);
  return String(cree.data.code);
}

export type MoyenAbonnement =
  | { provider: "stancer_card"; card_id: string; customer_id?: string }
  | { provider: "stancer_sepa"; sepa_id: string };

// Souscription : la première période est facturée tout de suite (bill_now), sans envoi ni prélèvement ;
// Michel y enregistre le premier paiement, déjà encaissé. Les suivantes, E-KO les facture et les prélève.
// Rejouable : la clé suit l'abonnement Michel. Rend le code SUB-… et la première facture.
export async function souscrireEko(s: {
  abonnementId: number; tierCode: string; planCode: string; moyen: MoyenAbonnement;
}): Promise<{ code: string; factureId: number | null; factureCode: string | null; cycleId: string | null }> {
  const r = await eko("POST", "/subscriptions", {
    tier_code: s.tierCode,
    plan_code: s.planCode,
    bill_now: true,
    payment_method: s.moyen,
    customer_notifications: false,
    dunning_auto_cancel: false,
    internal_notes: `MichelIA+ abonnement ${s.abonnementId}`,
  }, `abonnement-${s.abonnementId}`);
  const premier = r.data?.first_cycle ?? null;
  return {
    code: String(r.data.code),
    factureId: premier?.invoice_id != null ? Number(premier.invoice_id) : null,
    factureCode: premier?.invoice_code != null ? String(premier.invoice_code) : null,
    cycleId: premier?.id != null ? String(premier.id) : null,
  };
}

// Règlement d'une facture déjà émise par un paiement encaissé chez Stancer (paym_…). E-KO n'enregistre
// jamais deux fois un même paiement du prestataire.
export async function reglerFacture(r: {
  factureId: number; transaction: string; reference: string; montantTtcCents: number; date: string;
}): Promise<void> {
  await eko("POST", "/payments", {
    invoice_id: r.factureId,
    paid_at: r.date,
    amount: r.montantTtcCents / 100,
    currency: "EUR",
    method: "card_online",
    reference: r.reference,
    psp: { provider: "stancer", payment_id: r.transaction },
  }, `reglement-${r.transaction}`);
}

// Résiliation : à la fin de la période payée (choix de l'abonné) ou tout de suite (relances épuisées).
export async function resilierEko(code: string, finDePeriode: boolean, motif: string): Promise<void> {
  await eko("POST", `/subscriptions/${encodeURIComponent(code)}/cancel`, { at_period_end: finDePeriode, reason: motif });
}

// L'abonné reprend avant la fin de sa période : le renouvellement repart. Rend vrai si E-KO ne prévoit
// plus de coupure.
export async function reprendreEko(code: string): Promise<boolean> {
  await eko("PATCH", `/subscriptions/${encodeURIComponent(code)}`, { auto_renew: true });
  const lu = await eko("GET", `/subscriptions/${encodeURIComponent(code)}`);
  return lu?.data?.cancel_at_period_end === false;
}
