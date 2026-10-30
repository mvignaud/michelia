// Client minimal de l'API de l'ERP E-KO (GOLDEN PRINT), doc : /mnt/project-files/factures/documentation-api-eko.md.
// Jeton Bearer EKO_API_TOKEN (secret des Edge Functions), le locataire vient du jeton.
// Habilitations du jeton : tiers.view, tiers.create, invoices.create, invoices.issue, payments.create.
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
  paiementId: string; // identifiant du paiement chez le prestataire (clés d'idempotence, règlement)
  reference: string; // numéro de reçu MichelIA, aussi numéro de commande chez le prestataire
  libelle: string;
  montantTtcCents: number;
  date: string; // AAAA-MM-JJ, heure de Paris
  prestataire: string; // fournisseur de paiement au sens d'E-KO : « stancer », « stripe »
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
        vat_rate: 20,
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
      reference: v.paiementId,
      psp: { provider: v.prestataire, payment_id: v.paiementId },
    }, `reglement-${v.paiementId}`);
  }
  return code;
}
