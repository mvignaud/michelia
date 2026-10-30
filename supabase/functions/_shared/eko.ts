// Client minimal de l'API de l'ERP E-KO (GOLDEN PRINT), doc : /mnt/project-files/factures/documentation-api-eko.md.
// Jeton Bearer EKO_API_TOKEN (secret des Edge Functions), le locataire vient du jeton.
// Habilitations du jeton : tiers.view, tiers.create, invoices.create, invoices.issue, invoices.view,
// payments.create.
//
// Création d'une facture complète : en-tête et lignes (POST /invoices), émission sans envoi au client
// (POST /invoices/{code}/issue), puis règlement (POST /payments). Les deux premiers appels sont une
// évolution demandée à E-KO (/mnt/project-files/factures/demande-api-eko-factures.md) : la facturation
// reste coupée (app_config facturation_eko_active) tant qu'ils ne sont pas en ligne.
// Chaque création porte une Idempotency-Key tirée de l'identifiant du paiement : un rejeu rend les
// mêmes pièces au lieu d'en créer d'autres.

const EKO_API_URL = (Deno.env.get("EKO_API_URL") ?? "https://api.e-ko.fr/api/v1").replace(/\/+$/, "");
const EKO_API_TOKEN = Deno.env.get("EKO_API_TOKEN") ?? "";

export const ekoConfigure = () => !!EKO_API_TOKEN;

export class EkoError extends Error {
  constructor(public status: number, public body: unknown, chemin: string) {
    super(`E-KO ${chemin} : ${status} ${JSON.stringify(body).slice(0, 300)}`);
  }
}

// deno-lint-ignore no-explicit-any
async function eko(method: string, chemin: string, corps?: unknown, cle?: string): Promise<any> {
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
  paiementId: string; // identifiant du paiement chez le prestataire, référence de toutes les pièces
  libelle: string;
  montantTtcCents: number;
  date: string; // AAAA-MM-JJ, heure de Paris
  prestataire: string; // « Stancer », « Stripe »
};

// Facture émise et réglée. Rend son numéro (FA…).
export async function facturerVente(v: Vente): Promise<string> {
  const ttc = v.montantTtcCents / 100;
  const creee = await eko("POST", "/invoices", {
    tier_id: v.tierId,
    kind: "standard",
    reference: v.paiementId,
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
      external_ref: v.paiementId,
    }],
  }, `facture-${v.paiementId}`);
  const code = String(creee.data.code);

  const facture = await eko("POST", `/invoices/${encodeURIComponent(code)}/issue`, {}, `emission-${v.paiementId}`);
  if (facture.data.status !== "paid") {
    await eko("POST", "/payments", {
      invoice_id: facture.data.id,
      paid_at: v.date,
      amount: ttc,
      currency: "EUR",
      method: "card_offline",
      reference: v.paiementId,
      note: `Paiement en ligne ${v.prestataire}`,
    }, `reglement-${v.paiementId}`);
  }
  return code;
}
