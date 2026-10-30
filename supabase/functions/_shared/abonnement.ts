// MichelIA+ sur le site : échéances payées par carte chez Stancer (API v1, comme le formulaire du
// comptoir). Le premier paiement passe par le 3D Secure de la banque et enregistre la carte chez
// Stancer (jeton card_…) ; les suivantes sont prélevées par Michel avec ce jeton, sans la personne
// (fonction « michelia-plus-echeances »). Partagé par « michelia-plus » et « michelia-plus-echeances ».
// Voir docs/MICHELIA-PLUS.md. Jamais de numéro de carte en base ni dans les journaux.
import { admin, isCardPaymentId, stancer } from "./stancer.ts";

export type Formule = "mois" | "an";

// Statuts Stancer : l'argent arrive ; échec définitif ; 3D Secure raté.
const PAID = ["to_capture", "capture_sent", "captured"];
const FAILED = ["refused", "failed", "expired", "canceled", "cancelled", "unpaid"];
const AUTH_FAILED = ["declined", "failed", "expired"];

// Échéances ratées d'affilée avant d'arrêter l'abonnement, et délai entre deux essais.
export const ECHECS_MAX = 3;
export const RELANCE_JOURS = 3;

// Prix TTC en centimes, lu dans app_config (jamais envoyé par le navigateur).
export async function prixDe(formule: Formule): Promise<number | null> {
  const { data } = await admin.from("app_config").select("value").eq("key", "michelia_plus_prix").maybeSingle();
  try {
    const prix = Number(JSON.parse(data?.value ?? "{}")?.[formule]);
    return Number.isInteger(prix) && prix > 0 ? prix : null;
  } catch {
    return null;
  }
}

// Fin d'une période : un mois ou un an plus tard, en restant sur le dernier jour du mois s'il le faut
// (un abonnement pris le 31 janvier repasse le 28 février, puis le 31 mars).
export function finDePeriode(debut: Date, formule: Formule, jourAncre = debut.getUTCDate()): Date {
  const mois = debut.getUTCMonth() + (formule === "mois" ? 1 : 12);
  const fin = new Date(Date.UTC(debut.getUTCFullYear(), mois, 1, debut.getUTCHours(), debut.getUTCMinutes(), debut.getUTCSeconds()));
  const dernierJour = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 0)).getUTCDate();
  fin.setUTCDate(Math.min(jourAncre, dernierJour));
  return fin;
}

export const libelle = (formule: Formule) => (formule === "mois" ? "MichelIA+ au mois" : "MichelIA+ à l'année");

// Un message d'erreur de Stancer pour les journaux, sans aucune suite de chiffres (au cas où).
// deno-lint-ignore no-explicit-any
export const safeError = (data: any) =>
  String(data?.error?.message ?? data?.message ?? "").replace(/\d{3,}/g, "…").slice(0, 200);

export type Etat =
  | { etat: "paye"; fin_periode: string }
  | { etat: "authentification"; url: string; paiement: string }
  | { etat: "attente" }
  | { etat: "refuse" }
  | { etat: "inconnu" };

// Relit une échéance chez Stancer (jamais sur la foi du navigateur), capture si la banque a validé,
// puis met l'échéance et l'abonnement à jour. Rejouable.
export async function confirmerEcheance(paiementId: string): Promise<Etat> {
  if (!isCardPaymentId(paiementId)) return { etat: "inconnu" };
  const { data: echeance } = await admin
    .from("abonnement_echeances")
    .select("id, abonnement_id, montant_cents, periode_fin, statut")
    .eq("paiement_id", paiementId)
    .maybeSingle();
  if (!echeance) return { etat: "inconnu" };
  if (echeance.statut === "paye") return { etat: "paye", fin_periode: echeance.periode_fin };
  if (echeance.statut === "refuse") return { etat: "refuse" };

  const payment = await stancer("GET", `/v1/checkout/${paiementId}`);
  if (!payment.ok || !payment.data) {
    console.error("MichelIA+ : paiement illisible", payment.status, safeError(payment.data));
    return { etat: "attente" };
  }
  let statut = String(payment.data.status ?? "");
  const auth = String(payment.data.auth?.status ?? "");
  if (Number(payment.data.amount) !== echeance.montant_cents || String(payment.data.currency ?? "").toLowerCase() !== "eur") {
    console.error("MichelIA+ : montant inattendu", paiementId, payment.data.amount, echeance.montant_cents);
    return { etat: "inconnu" };
  }
  if (!statut && AUTH_FAILED.includes(auth)) statut = "refused";
  // 3D Secure réussi, ou paiement seulement autorisé : c'est à nous de demander l'encaissement.
  if ((!statut && auth === "success") || statut === "authorized") {
    const capture = await stancer("PATCH", `/v1/checkout/${paiementId}`, { status: "capture" });
    if (!capture.ok) {
      console.error("MichelIA+ : capture refusée", capture.status, safeError(capture.data));
      return { etat: "attente" };
    }
    statut = String(capture.data?.status ?? "") || "to_capture";
  }

  if (FAILED.includes(statut)) {
    await admin.from("abonnement_echeances").update({ statut: "refuse" }).eq("id", echeance.id).eq("statut", "en_cours");
    await echecSur(echeance.abonnement_id);
    return { etat: "refuse" };
  }
  if (!PAID.includes(statut)) return { etat: "attente" };

  const { data: marquee } = await admin
    .from("abonnement_echeances")
    .update({ statut: "paye" })
    .eq("id", echeance.id)
    .eq("statut", "en_cours")
    .select("id");
  // Une autre confirmation est passée juste avant : l'abonnement est déjà à jour.
  if (!marquee?.length) return { etat: "paye", fin_periode: echeance.periode_fin };

  // La carte enregistrée par Stancer (jeton et 4 derniers chiffres) sert aux échéances suivantes.
  const carte = payment.data.card;
  const jeton = typeof carte === "object" && typeof carte?.id === "string" && /^card_[A-Za-z0-9]{6,64}$/.test(carte.id) ? carte.id : null;
  const chiffres = typeof carte?.last4 === "string" && /^\d{4}$/.test(carte.last4) ? carte.last4 : null;
  const { data: abonnement } = await admin.from("abonnements").select("statut, fin_periode").eq("id", echeance.abonnement_id).single();
  const { error } = await admin
    .from("abonnements")
    .update({
      // Une résiliation demandée pendant le paiement reste une résiliation.
      statut: abonnement?.statut === "resilie" ? "resilie" : "actif",
      fin_periode: [echeance.periode_fin, abonnement?.fin_periode].filter(Boolean).sort().pop(),
      echecs: 0,
      prochain_essai: null,
      ...(jeton ? { stancer_carte: jeton } : {}),
      ...(chiffres ? { derniers_chiffres: chiffres } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", echeance.abonnement_id);
  if (error) {
    // Rare (un autre abonnement vivant entre-temps) : l'échéance est payée, on le voit dans les journaux.
    console.error("MichelIA+ : abonnement non mis à jour après paiement", echeance.abonnement_id, error.code, error.message);
  }
  return { etat: "paye", fin_periode: echeance.periode_fin };
}

// Une échéance refusée : au premier paiement, la souscription s'arrête là (la personne peut
// réessayer tout de suite) ; ensuite, l'abonnement passe impayé et Michel réessaie dans quelques
// jours, jusqu'à ECHECS_MAX fois.
export async function echecSur(abonnementId: number): Promise<void> {
  const { data } = await admin.from("abonnements").select("statut, echecs").eq("id", abonnementId).single();
  if (!data || data.statut === "expire") return;
  if (data.statut === "en_attente") {
    await admin.from("abonnements").update({ statut: "expire", updated_at: new Date().toISOString() })
      .eq("id", abonnementId).eq("statut", "en_attente");
    return;
  }
  const echecs = (data.echecs ?? 0) + 1;
  await admin
    .from("abonnements")
    .update({
      statut: echecs >= ECHECS_MAX ? "expire" : data.statut === "resilie" ? "resilie" : "impaye",
      echecs,
      prochain_essai: new Date(Date.now() + RELANCE_JOURS * 86_400_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", abonnementId);
}

// Souscriptions sur le site jamais payées, plus vieilles que ageMs : supprimées, sauf celles dont le
// premier paiement est encore en cours ou payé (la suppression emporterait son échéance).
export async function menageEnAttente(ageMs: number, userId?: string): Promise<void> {
  let q = admin.from("abonnements").select("id").eq("source", "web").eq("statut", "en_attente")
    .lt("created_at", new Date(Date.now() - ageMs).toISOString()).limit(100);
  if (userId) q = q.eq("user_id", userId);
  const { data: vieux } = await q;
  const ids = (vieux ?? []).map((a) => a.id);
  if (!ids.length) return;
  const { data: vivants } = await admin.from("abonnement_echeances").select("abonnement_id")
    .in("abonnement_id", ids).in("statut", ["en_cours", "paye"]);
  const garder = new Set((vivants ?? []).map((e) => e.abonnement_id));
  const jeter = ids.filter((id) => !garder.has(id));
  if (jeter.length) await admin.from("abonnements").delete().in("id", jeter).eq("statut", "en_attente");
}
