// MichelIA+ sur le site : échéances payées chez Stancer, par carte ou par prélèvement SEPA.
// Carte (API v1, comme le formulaire du comptoir) : le premier paiement passe par le 3D Secure de la
// banque et enregistre la carte chez Stancer (jeton card_…). SEPA : le premier paiement passe par la
// page Stancer (payment intent), où la personne signe le mandat par code SMS (jeton sepa_…). Les
// échéances suivantes sont prélevées par Michel avec ce jeton, sans la personne (fonction
// « michelia-plus-echeances »). Partagé par « michelia-plus » et « michelia-plus-echeances ».
// Voir docs/MICHELIA-PLUS.md. Jamais de numéro de carte ni d'IBAN en base ou dans les journaux.
import { admin, isCardPaymentId, isPaymentIntentId, stancer } from "./stancer.ts";

export type Formule = "mois" | "an";

// Statuts Stancer : l'argent arrive ; échec définitif ; 3D Secure raté.
const PAID = ["to_capture", "capture_sent", "captured"];
const FAILED = ["refused", "failed", "expired", "canceled", "cancelled", "unpaid"];
const AUTH_FAILED = ["declined", "failed", "expired"];
// Payment intent (premier prélèvement SEPA) : abandonné ou refusé ; mandat signé, prélèvement parti.
const INTENT_FAILED = ["canceled", "cancelled", "unpaid"];
const INTENT_PARTI = ["processing", "captured"];
// Rejets SEPA (codes ISO 20022) qui valent la peine d'un nouvel essai : provision insuffisante, sans
// motif. Les autres (compte fermé, pas de mandat, refus du titulaire…) arrêtent l'abonnement.
const REJETS_A_RETENTER = ["AM04", "MS03"];
// Un prélèvement SEPA peut être rejeté plusieurs jours après son départ : on le relit pendant ce délai.
export const RELECTURE_SEPA_JOURS = 15;

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
export const safeError = (data: any) => {
  const message = data?.error?.message ?? data?.message ?? "";
  return (typeof message === "string" ? message : JSON.stringify(message)).replace(/\d{3,}/g, "…").slice(0, 200);
};

export const isSepaId = (id: unknown): id is string => typeof id === "string" && /^sepa_[A-Za-z0-9]{6,64}$/.test(id);
// Un identifiant Stancer donné tel quel ou dans un objet ({id: …}).
// deno-lint-ignore no-explicit-any
const idDe = (v: any): string => (typeof v === "string" ? v : typeof v?.id === "string" ? v.id : "");

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
    if (capture.status === 409) {
      // Une autre confirmation a capturé juste avant : on relit l'état.
      const relu = await stancer("GET", `/v1/checkout/${paiementId}`);
      statut = String(relu.data?.status ?? "");
    } else if (!capture.ok) {
      console.error("MichelIA+ : capture refusée", capture.status, safeError(capture.data));
      return { etat: "attente" };
    } else {
      statut = String(capture.data?.status ?? "") || "to_capture";
    }
  }

  if (FAILED.includes(statut)) return refuserEcheance(echeance.id, echeance.abonnement_id);
  if (!PAID.includes(statut)) return { etat: "attente" };

  // La carte enregistrée par Stancer (jeton et 4 derniers chiffres) sert aux échéances suivantes ; un
  // prélèvement SEPA, lui, réutilise le mandat déjà rangé.
  const carte = payment.data.card;
  const jeton = typeof carte === "object" && typeof carte?.id === "string" && /^card_[A-Za-z0-9]{6,64}$/.test(carte.id) ? carte.id : null;
  const chiffres = typeof carte?.last4 === "string" && /^\d{4}$/.test(carte.last4) ? carte.last4 : null;
  return marquerPayee(echeance, { ...(jeton ? { stancer_carte: jeton } : {}), ...(chiffres ? { derniers_chiffres: chiffres } : {}) });
}

type Echeance = { id: number; abonnement_id: number; periode_fin: string };

// L'échéance est payée : elle passe « paye » (une seule fois), puis l'abonnement est prolongé.
async function marquerPayee(echeance: Echeance, moyen: Record<string, string>, paiementId?: string): Promise<Etat> {
  const { data: marquee } = await admin
    .from("abonnement_echeances")
    .update({ statut: "paye", ...(paiementId ? { paiement_id: paiementId } : {}) })
    .eq("id", echeance.id)
    .eq("statut", "en_cours")
    .select("id");
  // Une autre confirmation est passée juste avant : l'abonnement est déjà à jour.
  if (!marquee?.length) return { etat: "paye", fin_periode: echeance.periode_fin };

  const { data: abonnement } = await admin.from("abonnements").select("statut, fin_periode").eq("id", echeance.abonnement_id).single();
  const { error } = await admin
    .from("abonnements")
    .update({
      // Une résiliation demandée pendant le paiement reste une résiliation.
      statut: abonnement?.statut === "resilie" ? "resilie" : "actif",
      fin_periode: [echeance.periode_fin, abonnement?.fin_periode].filter(Boolean).sort().pop(),
      echecs: 0,
      prochain_essai: null,
      ...moyen,
      updated_at: new Date().toISOString(),
    })
    .eq("id", echeance.abonnement_id);
  if (error) {
    // Rare (un autre abonnement vivant entre-temps) : l'échéance est payée, on le voit dans les journaux.
    console.error("MichelIA+ : abonnement non mis à jour après paiement", echeance.abonnement_id, error.code, error.message);
  }
  return { etat: "paye", fin_periode: echeance.periode_fin };
}

// Premier prélèvement SEPA, après la page Stancer : relit le payment intent (jamais sur la foi du
// navigateur), le capture si besoin, puis range le mandat signé (sepa_…, référence, titulaire,
// 4 derniers caractères de l'IBAN) et passe l'abonnement actif. Rejouable. Le prélèvement peut encore
// être rejeté par la banque dans les jours qui suivent : relireSepa s'en charge.
// abandon : un prélèvement que la personne n'a jamais commencé (page Stancer fermée) est compté refusé.
export async function confirmerSepa(intentId: string, abandon = false): Promise<Etat> {
  if (!isPaymentIntentId(intentId)) return { etat: "inconnu" };
  const { data: echeance } = await admin
    .from("abonnement_echeances")
    .select("id, abonnement_id, montant_cents, periode_fin, statut, abonnements!inner(user_id)")
    .eq("stancer_intent", intentId)
    .maybeSingle();
  if (!echeance) return { etat: "inconnu" };
  if (echeance.statut === "paye") return { etat: "paye", fin_periode: echeance.periode_fin };

  const intent = await stancer("GET", `/payment_intents/${intentId}`);
  if (echeance.statut === "refuse") {
    // Abandonnée chez nous, mais signée quand même chez Stancer (deux onglets) : à rembourser.
    if (["authorized", ...INTENT_PARTI].includes(String(intent.data?.status ?? ""))) {
      console.error("MichelIA+ : ALERTE prélèvement SEPA parti sur une souscription abandonnée, à rembourser", intentId);
    }
    return { etat: "refuse" };
  }
  if (!intent.ok || !intent.data) {
    console.error("MichelIA+ : prélèvement illisible", intent.status, safeError(intent.data));
    return { etat: "attente" };
  }
  if (Number(intent.data.amount) !== echeance.montant_cents || String(intent.data.currency ?? "eur").toLowerCase() !== "eur") {
    console.error("MichelIA+ : montant inattendu", intentId, intent.data.amount, echeance.montant_cents);
    return { etat: "inconnu" };
  }
  let statut = String(intent.data.status ?? "");
  if (INTENT_FAILED.includes(statut)) return refuserEcheance(echeance.id, echeance.abonnement_id);
  if (statut.startsWith("require_")) {
    return abandon ? refuserEcheance(echeance.id, echeance.abonnement_id) : { etat: "attente" };
  }
  if (statut === "authorized") {
    let capture = await stancer("POST", `/payment_intents/${intentId}/capture`);
    if (!capture.ok && (capture.status === 404 || capture.status === 405)) {
      capture = await stancer("PATCH", `/payment_intents/${intentId}`, { capture: true });
    }
    if (!capture.ok) {
      console.error("MichelIA+ : capture du prélèvement refusée", capture.status, safeError(capture.data));
      return { etat: "attente" };
    }
    statut = String(capture.data?.status ?? "") || "processing";
  }

  const paiementId = idDe(intent.data.payment);
  if (!isCardPaymentId(paiementId)) return { etat: "attente" };
  const payment = await stancer("GET", `/v1/checkout/${paiementId}`);
  if (!payment.ok || !payment.data) {
    console.error("MichelIA+ : prélèvement illisible", payment.status, safeError(payment.data));
    return { etat: "attente" };
  }
  const statutPaiement = String(payment.data.status ?? "");
  if (FAILED.includes(statutPaiement)) return refuserEcheance(echeance.id, echeance.abonnement_id);
  if (!PAID.includes(statutPaiement) && !INTENT_PARTI.includes(statut)) return { etat: "attente" };

  const sepaId = [idDe(payment.data.sepa), idDe(intent.data.sepa)].find(isSepaId);
  if (!sepaId) {
    console.error("MichelIA+ : ALERTE prélèvement parti sans mandat lisible", intentId, paiementId);
    return { etat: "attente" };
  }
  const mandat = await stancer("GET", `/v1/sepa/${sepaId}`);
  const m = mandat.ok ? mandat.data : typeof payment.data.sepa === "object" ? payment.data.sepa : null;
  const iban = typeof m?.last4 === "string" && /^[0-9A-Z]{4}$/.test(m.last4) ? m.last4 : null;
  const signe = Number(m?.date_mandate);
  // deno-lint-ignore no-explicit-any
  const userId = (echeance as any).abonnements?.user_id;
  const { error: mandatErr } = await admin.from("mandats_sepa").upsert({
    user_id: userId,
    abonnement_id: echeance.abonnement_id,
    stancer_sepa: sepaId,
    rum: typeof m?.mandate === "string" ? m.mandate.slice(0, 35) : null,
    titulaire: typeof m?.name === "string" ? m.name.trim().slice(0, 64) : null,
    iban_derniers: iban,
    signe_le: Number.isFinite(signe) && signe > 0 ? new Date(signe * 1000).toISOString() : new Date().toISOString(),
  }, { onConflict: "stancer_sepa", ignoreDuplicates: true });
  if (mandatErr) console.error("MichelIA+ : ALERTE mandat SEPA non rangé", sepaId, mandatErr.message);
  return marquerPayee(echeance, { stancer_sepa: sepaId, ...(iban ? { derniers_chiffres: iban } : {}) }, paiementId);
}

// Premiers prélèvements SEPA en attente depuis plus de ageMs : relus chez Stancer, et comptés refusés
// si la personne n'a jamais signé (la souscription en attente laisse alors la place).
export async function abandonnerSepa(ageMs: number, userId?: string): Promise<void> {
  let q = admin.from("abonnement_echeances").select("stancer_intent, abonnements!inner(user_id)")
    .eq("statut", "en_cours").like("paiement_id", "pi_%").not("stancer_intent", "is", null)
    .lt("created_at", new Date(Date.now() - ageMs).toISOString()).limit(20);
  if (userId) q = q.eq("abonnements.user_id", userId);
  const { data } = await q;
  for (const e of data ?? []) await confirmerSepa(e.stancer_intent, true);
}

// Une échéance refusée : marquée, puis l'abonnement suit (echecSur).
async function refuserEcheance(echeanceId: number, abonnementId: number): Promise<Etat> {
  await admin.from("abonnement_echeances").update({ statut: "refuse" }).eq("id", echeanceId).eq("statut", "en_cours");
  await echecSur(abonnementId);
  return { etat: "refuse" };
}

// Prélèvements SEPA déjà comptés payés mais encore rejetables (RELECTURE_SEPA_JOURS) : relus chez
// Stancer. Rejeté ou contesté : l'échéance passe refusée, la période payée est retirée (MichelIA+
// s'arrête), et Michel réessaie dans quelques jours si le motif le permet, sinon l'abonnement s'arrête.
export async function relireSepa(limite: number): Promise<number> {
  const { data: payees } = await admin
    .from("abonnement_echeances")
    .select("id, abonnement_id, paiement_id, periode_debut, periode_fin, abonnements!inner(moyen)")
    .eq("statut", "paye")
    .eq("abonnements.moyen", "sepa")
    .like("paiement_id", "paym_%")
    .gt("created_at", new Date(Date.now() - RELECTURE_SEPA_JOURS * 86_400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(limite);
  let rejets = 0;
  for (const e of payees ?? []) {
    if (!isCardPaymentId(e.paiement_id)) continue;
    const payment = await stancer("GET", `/v1/checkout/${e.paiement_id}`);
    if (!payment.ok || !payment.data) continue;
    const statut = String(payment.data.status ?? "");
    if (!FAILED.includes(statut) && statut !== "disputed") continue;
    const code = String(payment.data.response ?? "").toUpperCase().slice(0, 8);
    const { data: marquee } = await admin.from("abonnement_echeances").update({ statut: "refuse" })
      .eq("id", e.id).eq("statut", "paye").select("id");
    if (!marquee?.length) continue;
    rejets++;
    console.error("MichelIA+ : prélèvement SEPA rejeté", e.abonnement_id, statut, code || "sans code");
    const { data: ab } = await admin.from("abonnements").select("statut, fin_periode, echecs").eq("id", e.abonnement_id).single();
    if (!ab || ab.statut === "expire") continue;
    // La période de ce prélèvement n'est plus payée : la fin revient à son début.
    const recule = ab.fin_periode && new Date(ab.fin_periode).getTime() === new Date(e.periode_fin).getTime();
    const echecs = (ab.echecs ?? 0) + 1;
    const arreter = !REJETS_A_RETENTER.includes(code) || echecs >= ECHECS_MAX;
    await admin.from("abonnements").update({
      statut: arreter ? "expire" : ab.statut === "resilie" ? "resilie" : "impaye",
      echecs,
      ...(recule ? { fin_periode: e.periode_debut } : {}),
      prochain_essai: arreter ? null : new Date(Date.now() + RELANCE_JOURS * 86_400_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", e.abonnement_id);
  }
  return rejets;
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
