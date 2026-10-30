// Fonction « stancer-remboursements » : Stancer ne prévient pas quand un pourboire est remboursé depuis
// son espace. Toutes les 15 minutes (pg_cron, migration 20261030050000_remboursements.sql), elle relit
// chez Stancer les paiements des pourboires Stancer des 120 derniers jours, les moins récemment vérifiés
// d'abord, et inscrit le total remboursé (rembourse_cents, rembourse_le). L'e-mail de remboursement et
// l'avoir E-KO partent ensuite de « facturer ». Sans danger si quelqu'un d'autre l'appelle : elle ne fait
// que relire Stancer et recopier ce qu'il dit.
import { admin, isCardPaymentId, remboursementsDe, stancer, stancerConfigured } from "../_shared/stancer.ts";

const PAR_PASSAGE = 40;
const JOURS = 120;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Le paiement Stancer (paym_…) d'un pourboire : rangé à la confirmation, sinon lu sur son payment intent.
async function paiementDe(row: { paiement_id: string; paiement_carte: string | null }): Promise<string | null> {
  if (isCardPaymentId(row.paiement_carte)) return row.paiement_carte;
  const intent = await stancer("GET", `/payment_intents/${row.paiement_id}`);
  const id = intent.data?.payment;
  return isCardPaymentId(id) ? id : null;
}

// Total remboursé d'un paiement ; un paiement annulé avant capture compte pour remboursé en entier.
async function rembourse(paymentId: string): Promise<number | null> {
  const r = await remboursementsDe(paymentId);
  if (!r) return null;
  return r.annule ?? r.liste.reduce((total, x) => total + x.montant, 0);
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
