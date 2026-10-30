// Fonction « stancer-remboursements » : Stancer ne prévient pas quand un pourboire est remboursé depuis
// son espace. Toutes les 15 minutes (pg_cron, migration 20261030050000_remboursements.sql), elle relit
// chez Stancer les paiements des pourboires Stancer des 120 derniers jours, les moins récemment vérifiés
// d'abord, et inscrit le total remboursé (rembourse_cents, rembourse_le). L'e-mail de remboursement et
// l'avoir E-KO partent ensuite de « facturer ». Sans danger si quelqu'un d'autre l'appelle : elle ne fait
// que relire Stancer et recopier ce qu'il dit.
import { admin, isCardPaymentId, stancer, stancerConfigured } from "../_shared/stancer.ts";

const PAR_PASSAGE = 40;
const JOURS = 120;
// Un remboursement demandé, envoyé ou fait ; payment_canceled : paiement annulé avant d'être encaissé.
const REMBOURSE = ["to_refund", "refund_sent", "refunded", "payment_canceled"];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Le paiement Stancer (paym_…) d'un pourboire : rangé à la confirmation, sinon lu sur son payment intent.
async function paiementDe(row: { paiement_id: string; paiement_carte: string | null }): Promise<string | null> {
  if (isCardPaymentId(row.paiement_carte)) return row.paiement_carte;
  const intent = await stancer("GET", `/payment_intents/${row.paiement_id}`);
  const id = intent.data?.payment;
  return isCardPaymentId(id) ? id : null;
}

// Total remboursé d'un paiement, d'après la liste de ses remboursements (objets ou identifiants).
async function rembourse(paymentId: string): Promise<number | null> {
  let payment = await stancer("GET", `/v1/checkout/${paymentId}`);
  // Paiement né d'un payment intent (page Stancer) : peut-être seulement lisible en v2.
  if (!payment.ok || !payment.data) payment = await stancer("GET", `/payments/${paymentId}`);
  if (!payment.ok || !payment.data) {
    console.error("Remboursements : paiement illisible", paymentId, payment.status);
    return null;
  }
  // Paiement annulé avant capture : rien n'a été encaissé.
  if (["canceled", "cancelled"].includes(String(payment.data.status ?? ""))) return Number(payment.data.amount) || 0;
  let total = 0;
  for (const item of Array.isArray(payment.data.refunds) ? payment.data.refunds : []) {
    const refund = typeof item === "string" ? (await stancer("GET", `/v1/refunds/${encodeURIComponent(item)}`)).data : item;
    if (REMBOURSE.includes(String(refund?.status ?? ""))) total += Number(refund?.amount) || 0;
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Méthode non permise" });
  if (!stancerConfigured()) return json(200, { verifies: 0 });

  const depuis = new Date(Date.now() - JOURS * 86_400_000).toISOString();
  const { data: rows, error } = await admin
    .from("pourboires")
    .select("paiement_id, paiement_carte, montant_cents, rembourse_cents, rembourse_le")
    .eq("prestataire", "stancer")
    .eq("essai", false)
    .gte("created_at", depuis)
    .order("rembourse_verifie_le", { ascending: true, nullsFirst: true })
    .limit(PAR_PASSAGE);
  if (error) {
    console.error("Remboursements : pourboires illisibles", error.message);
    return json(500, { error: "Base illisible" });
  }

  let nouveaux = 0;
  for (const row of rows ?? []) {
    const paymentId = await paiementDe(row);
    const total = paymentId ? await rembourse(paymentId) : null;
    const maj: Record<string, unknown> = { rembourse_verifie_le: new Date().toISOString() };
    if (paymentId && !row.paiement_carte) maj.paiement_carte = paymentId;
    // Jamais plus que le pourboire, et jamais à la baisse (un remboursement ne s'annule pas).
    if (total !== null && total > row.rembourse_cents) {
      maj.rembourse_cents = Math.min(total, row.montant_cents);
      if (!row.rembourse_le) maj.rembourse_le = new Date().toISOString();
      nouveaux++;
      console.log("Remboursement constaté", row.paiement_id, maj.rembourse_cents);
    }
    const { error: saved } = await admin.from("pourboires").update(maj).eq("paiement_id", row.paiement_id);
    if (saved) console.error("Remboursement non inscrit", row.paiement_id, saved.message);
  }
  return json(200, { verifies: rows?.length ?? 0, nouveaux });
});
