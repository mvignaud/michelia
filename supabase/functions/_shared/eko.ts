// Client minimal de l'API de l'ERP E-KO (GOLDEN PRINT), doc : /mnt/project-files/factures/documentation-api-eko.md.
// Jeton Bearer EKO_API_TOKEN (secret des Edge Functions), le locataire vient du jeton.
// Habilitations du jeton : tiers.view, tiers.create, invoices.create, invoices.issue, payments.create,
// et invoices.credit pour les avoirs.
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
