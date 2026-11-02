// MichelIA+ dans E-KO (voir docs/MICHELIA-PLUS.md, section « E-KO »). E-KO tient le contrat de chaque
// abonné du site, facture chaque période (compte 706000, jamais envoyée) et la prélève chez Stancer sur
// la carte ou le mandat obtenus par Michel au premier paiement. Michel :
// - pousse chaque nouvel abonnement dans E-KO, avec le premier paiement déjà encaissé (synchroniserEko,
//   appelée toutes les heures par michelia-plus-echeances) ; transmet résiliations et reprises ;
// - suit E-KO par ses webhooks (fonction eko-webhook → traiterEvenement) : période facturée, payée,
//   ratée, relances épuisées, résiliation.
// Tant que michelia_plus_eko_actif ne vaut pas 'true', rien ne part : Michel prélève lui-même, comme avant.
import { admin, isCardPaymentId } from "./stancer.ts";
import { EkoError, ekoConfigure, type MoyenAbonnement, reglerFacture, reprendreEko, resilierEko, souscrireEko, tiersAbonne } from "./eko.ts";

const MAX_TENTATIVES = 5;
const MAX_ESSAIS_EVENEMENT = 5;

const jourParis = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
const messageDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const maintenant = () => new Date().toISOString();

async function reglages(): Promise<{ actif: boolean; depuis: string; plans: Record<string, string> }> {
  const { data } = await admin.from("app_config").select("key, value")
    .in("key", ["michelia_plus_eko_actif", "michelia_plus_eko_depuis", "michelia_plus_eko_plans"]);
  const c = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  let plans: Record<string, string> = {};
  try {
    plans = JSON.parse(c.michelia_plus_eko_plans ?? "{}");
  } catch {
    plans = {};
  }
  return { actif: c.michelia_plus_eko_actif === "true", depuis: c.michelia_plus_eko_depuis || "2999-01-01", plans };
}

async function nomDe(userId: string, email: string | null): Promise<string> {
  const { data } = await admin.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle();
  const nom = [data?.first_name, data?.last_name].map((n) => (typeof n === "string" ? n.trim().slice(0, 50) : "")).filter(Boolean).join(" ");
  return nom || email || `Abonné MichelIA+ ${userId.slice(0, 8)}`;
}

// Une erreur de l'API : comptée, et notée pour de bon si c'est un refus sur le fond (422), qui ne se
// corrige pas en réessayant à l'identique (vider eko_erreur pour relancer).
async function noterErreur(abonnementId: number, tentatives: number, e: unknown, quoi: string): Promise<void> {
  const message = messageDe(e);
  console.error(`MichelIA+ E-KO : ${quoi} impossible`, abonnementId, message);
  const definitive = (e instanceof EkoError && e.status === 422) || tentatives + 1 >= MAX_TENTATIVES;
  await admin.from("abonnements").update({
    eko_tentatives: tentatives + 1,
    ...(definitive ? { eko_erreur: `${quoi} : ${message}` } : {}),
  }).eq("id", abonnementId);
  if (definitive) console.error("MichelIA+ E-KO : ALERTE abonnement bloqué, à regarder (eko_erreur)", abonnementId);
}

type Paiement = { id: number; paiement_id: string; montant_cents: number; numero_recu: string | null; created_at: string; statut: string; eko_facture: string | null; eko_facture_id: number | null; eko_regle_le: string | null; eko_cycle: string | null };

// Le passage horaire : nouveaux abonnements, premiers paiements, résiliations et reprises.
export async function synchroniserEko(limite: number): Promise<{ crees: number; regles: number; resilies: number; repris: number }> {
  const bilan = { crees: 0, regles: 0, resilies: 0, repris: 0 };
  if (!ekoConfigure()) return bilan;
  const r = await reglages();
  if (!r.actif) return bilan;

  // 1. Abonnements du site payés et pas encore dans E-KO : tiers, puis souscription sur la carte ou le
  // mandat, première période facturée tout de suite.
  const { data: nouveaux, error } = await admin.from("abonnements")
    .select("id, user_id, formule, moyen, statut, email, stancer_carte, stancer_client, stancer_sepa, eko_tiers, eko_tentatives, abonnement_echeances(id, paiement_id, montant_cents, numero_recu, created_at, statut, eko_facture, eko_facture_id, eko_regle_le, eko_cycle)")
    .eq("source", "web").eq("essai", false)
    .is("eko_abonnement", null).is("eko_erreur", null)
    .in("statut", ["actif", "impaye", "resilie"])
    .gte("created_at", r.depuis)
    .lt("eko_tentatives", MAX_TENTATIVES)
    .order("id")
    .limit(limite);
  if (error) console.error("MichelIA+ E-KO : abonnements illisibles", error.message);
  for (const a of nouveaux ?? []) {
    const premier = ((a.abonnement_echeances ?? []) as Paiement[])
      .filter((e) => e.statut === "paye" && isCardPaymentId(e.paiement_id))
      .sort((x, y) => x.created_at.localeCompare(y.created_at))[0];
    if (!premier) continue;
    const plan = r.plans[a.formule];
    const moyen: MoyenAbonnement | null = a.moyen === "sepa"
      ? (a.stancer_sepa ? { provider: "stancer_sepa", sepa_id: a.stancer_sepa } : null)
      : (a.stancer_carte ? { provider: "stancer_card", card_id: a.stancer_carte, ...(a.stancer_client ? { customer_id: a.stancer_client } : {}) } : null);
    if (!plan || !moyen) {
      await noterErreur(a.id, MAX_TENTATIVES, new Error(!plan ? `pas de plan E-KO pour « ${a.formule} »` : "ni carte ni mandat enregistré"), "souscription");
      continue;
    }
    try {
      let tiers = a.eko_tiers as string | null;
      if (!tiers) {
        tiers = await tiersAbonne(a.user_id, await nomDe(a.user_id, a.email));
        await admin.from("abonnements").update({ eko_tiers: tiers }).eq("id", a.id);
      }
      const sub = await souscrireEko({ abonnementId: a.id, tierCode: tiers, planCode: plan, moyen });
      // Le code tout de suite : une reprise ne souscrit jamais deux fois.
      await admin.from("abonnements").update({ eko_abonnement: sub.code, eko_tentatives: 0 }).eq("id", a.id);
      bilan.crees++;
      if (sub.factureId) {
        await admin.from("abonnement_echeances").update({ eko_facture: sub.factureCode, eko_facture_id: sub.factureId }).eq("id", premier.id);
        if (sub.cycleId) {
          await admin.from("abonnement_echeances").update({ eko_cycle: sub.cycleId }).eq("id", premier.id).is("eko_cycle", null);
        }
      } else {
        console.error("MichelIA+ E-KO : ALERTE souscription sans première facture, premier paiement à enregistrer à la main", a.id, sub.code);
      }
    } catch (e) {
      await noterErreur(a.id, a.eko_tentatives, e, "souscription");
    }
  }

  // 2. Premiers paiements (encaissés par Michel) à enregistrer sur la première facture E-KO.
  const { data: aRegler } = await admin.from("abonnement_echeances")
    .select("id, abonnement_id, paiement_id, montant_cents, numero_recu, created_at, eko_facture_id, abonnements!inner(eko_tentatives)")
    .not("eko_facture_id", "is", null).is("eko_regle_le", null).eq("statut", "paye").like("paiement_id", "paym_%")
    .order("id").limit(limite);
  for (const e of aRegler ?? []) {
    try {
      await reglerFacture({
        factureId: e.eko_facture_id!,
        transaction: e.paiement_id,
        reference: e.numero_recu ?? e.paiement_id,
        montantTtcCents: e.montant_cents,
        date: jourParis(new Date(e.created_at)),
      });
      await admin.from("abonnement_echeances").update({ eko_regle_le: maintenant() }).eq("id", e.id);
      bilan.regles++;
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      await noterErreur(e.abonnement_id, Number((e as any).abonnements?.eko_tentatives ?? 0), err, "règlement du premier paiement");
    }
  }

  // 3. Résiliations demandées par l'abonné : E-KO coupe au terme déjà payé.
  const { data: resilies } = await admin.from("abonnements").select("id, eko_abonnement, eko_tentatives")
    .eq("statut", "resilie").not("eko_abonnement", "is", null).is("eko_resilie_le", null).is("eko_erreur", null).limit(limite);
  for (const a of resilies ?? []) {
    try {
      await resilierEko(a.eko_abonnement!, true, "Résilié par l'abonné depuis son espace Michel");
      await admin.from("abonnements").update({ eko_resilie_le: maintenant(), eko_tentatives: 0 }).eq("id", a.id);
      bilan.resilies++;
    } catch (e) {
      await noterErreur(a.id, a.eko_tentatives, e, "résiliation");
    }
  }

  // 4. Reprises avant la fin de la période : le renouvellement repart chez E-KO.
  const { data: repris } = await admin.from("abonnements").select("id, eko_abonnement, eko_tentatives")
    .in("statut", ["actif", "impaye"]).not("eko_abonnement", "is", null).not("eko_resilie_le", "is", null).is("eko_erreur", null).limit(limite);
  for (const a of repris ?? []) {
    try {
      if (!(await reprendreEko(a.eko_abonnement!))) throw new Error("E-KO prévoit toujours la coupure en fin de période");
      await admin.from("abonnements").update({ eko_resilie_le: null, eko_tentatives: 0 }).eq("id", a.id);
      bilan.repris++;
    } catch (e) {
      await noterErreur(a.id, a.eko_tentatives, e, "reprise");
    }
  }
  return bilan;
}

// ── Webhooks d'E-KO, gardés dans eko_evenements par la fonction eko-webhook.

type Abonnement = { id: number; statut: string; fin_periode: string | null; echecs: number; essai: boolean; eko_abonnement: string };

class PasEncore extends Error {}

// Traite un webhook reçu. Rejouable : chaque cas vérifie l'état avant d'écrire. Un événement qui arrive
// avant ce qu'il suppose (abonnement pas encore noté, période pas encore vue) est laissé au cron, qui le
// reprend quelques minutes plus tard.
export async function traiterEvenement(livraison: number): Promise<void> {
  const { data: ev } = await admin.from("eko_evenements").select("livraison, evenement, abonnement, charge, traite_le, essais")
    .eq("livraison", livraison).maybeSingle();
  if (!ev || ev.traite_le) return;
  try {
    await appliquer(ev.evenement, ev.charge?.data ?? {}, ev.abonnement);
    await admin.from("eko_evenements").update({ traite_le: maintenant(), erreur: null }).eq("livraison", livraison);
  } catch (e) {
    const essais = (ev.essais ?? 0) + 1;
    const abandon = essais >= MAX_ESSAIS_EVENEMENT;
    await admin.from("eko_evenements").update({
      essais,
      erreur: messageDe(e),
      ...(abandon ? { traite_le: maintenant() } : {}),
    }).eq("livraison", livraison);
    if (abandon || !(e instanceof PasEncore)) {
      console.error(`MichelIA+ E-KO : ${abandon ? "ALERTE webhook abandonné" : "webhook en échec"}`, livraison, ev.evenement, messageDe(e));
    }
  }
}

// Les webhooks pas encore traités (traitement raté, ou arrivés trop tôt), repris par le cron.
export async function reprendreEvenements(limite: number): Promise<void> {
  const { data } = await admin.from("eko_evenements").select("livraison")
    .is("traite_le", null).lt("recu_le", new Date(Date.now() - 120_000).toISOString()).order("livraison").limit(limite);
  for (const e of data ?? []) await traiterEvenement(e.livraison);
}

// deno-lint-ignore no-explicit-any
async function appliquer(evenement: string, d: any, code: string | null): Promise<void> {
  const suivis = ["cycle.billed", "cycle.paid", "cycle.failed", "dunning.exhausted", "subscription.cancelled", "subscription.cancel_scheduled"];
  if (!suivis.includes(evenement)) return;
  if (!code) throw new Error("webhook sans abonnement");
  const { data: ab } = await admin.from("abonnements").select("id, statut, fin_periode, echecs, essai, eko_abonnement")
    .eq("eko_abonnement", code).maybeSingle();
  // Souscription en cours de notation chez Michel (le webhook arrive pendant l'appel) : plus tard.
  if (!ab) throw new PasEncore(`abonnement ${code} pas encore connu`);
  const a = ab as Abonnement;

  switch (evenement) {
    case "cycle.billed":
      return periodeFacturee(a, d.cycle ?? {});
    case "cycle.paid":
      return periodePayee(a, d);
    case "cycle.failed":
      return periodeRatee(a, d);
    case "dunning.exhausted": {
      // Relances finies sans paiement (J+21) : l'abonnement s'arrête tout de suite.
      if (a.statut !== "expire") {
        try {
          await resilierEko(a.eko_abonnement, false, "Relances épuisées sans paiement");
        } catch (e) {
          if (!(e instanceof EkoError && e.status === 422)) throw e;
        }
        await admin.from("abonnements").update({ statut: "expire", eko_resilie_le: maintenant(), prochain_essai: null, updated_at: maintenant() })
          .eq("id", a.id).neq("statut", "expire");
        console.log("MichelIA+ E-KO : abonnement arrêté après les relances", a.id);
      }
      return;
    }
    case "subscription.cancelled": {
      if (a.statut === "expire") return;
      const fini = !a.fin_periode || new Date(a.fin_periode).getTime() <= Date.now();
      await admin.from("abonnements").update({
        statut: fini ? "expire" : "resilie",
        resilie_le: maintenant(),
        eko_resilie_le: maintenant(),
        prochain_essai: null,
        updated_at: maintenant(),
      }).eq("id", a.id).neq("statut", "expire");
      return;
    }
    case "subscription.cancel_scheduled": {
      // Résiliation programmée depuis E-KO (ou transmise par Michel : déjà notée).
      await admin.from("abonnements").update({ statut: "resilie", resilie_le: maintenant(), eko_resilie_le: maintenant(), updated_at: maintenant() })
        .eq("id", a.id).in("statut", ["actif", "impaye"]);
      return;
    }
  }
}

// deno-lint-ignore no-explicit-any
async function echeanceDuCycle(cycleId: unknown): Promise<any> {
  if (cycleId === undefined || cycleId === null || cycleId === "") throw new Error("webhook sans cycle");
  const { data } = await admin.from("abonnement_echeances").select("id, abonnement_id, statut, periode_debut, periode_fin")
    .eq("eko_cycle", String(cycleId)).maybeSingle();
  return data;
}

// Une période vient d'être facturée : elle devient une échéance en cours, payée ensuite par le
// prélèvement d'E-KO. La toute première (bill_now) est celle du premier paiement, déjà payée chez Michel.
// deno-lint-ignore no-explicit-any
async function periodeFacturee(a: Abonnement, c: any): Promise<void> {
  if (await echeanceDuCycle(c.id)) return;
  const factureCode = c.invoice_code != null ? String(c.invoice_code) : null;
  if (factureCode) {
    const { data: premiere } = await admin.from("abonnement_echeances").update({ eko_cycle: String(c.id) })
      .eq("abonnement_id", a.id).eq("eko_facture", factureCode).is("eko_cycle", null).select("id");
    if (premiere?.length) return;
  }
  // Pas encore de période vue : c'est la première, dont la souscription n'est pas encore notée chez Michel.
  const { count } = await admin.from("abonnement_echeances").select("id", { count: "exact", head: true })
    .eq("abonnement_id", a.id).not("eko_cycle", "is", null);
  if (!count) throw new PasEncore("première période pas encore rattachée");
  const montant = Math.round(Number(c.total_ttc) * 100);
  const debut = new Date(c.period_start);
  const fin = new Date(c.period_end);
  if (!Number.isInteger(montant) || montant <= 0 || Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
    throw new Error("cycle illisible");
  }
  const { error } = await admin.from("abonnement_echeances").insert({
    abonnement_id: a.id,
    paiement_id: `eko:${c.id}`,
    eko_cycle: String(c.id),
    eko_facture: factureCode,
    eko_facture_id: c.invoice_id != null ? Number(c.invoice_id) : null,
    montant_cents: montant,
    periode_debut: debut.toISOString(),
    periode_fin: fin.toISOString(),
    essai: a.essai,
  });
  if (error && error.code !== "23505") throw new Error(`échéance non notée : ${error.message}`);
  if (error) {
    // Même période déjà là (doublon, ou ancienne échéance Michel) : on regarde laquelle.
    const deja = await echeanceDuCycle(c.id);
    if (!deja) throw new Error(`période ${debut.toISOString()} déjà notée sans ce cycle`);
  }
}

// Le prélèvement d'E-KO est passé (ou Michel a enregistré le premier paiement) : la période est payée,
// MichelIA+ est prolongé jusqu'à sa fin, les échecs repartent à zéro.
// deno-lint-ignore no-explicit-any
async function periodePayee(a: Abonnement, d: any): Promise<void> {
  const e = await echeanceDuCycle(d.cycle_id ?? d.cycle?.id);
  if (!e) throw new PasEncore("période payée pas encore vue");
  if (e.statut === "paye") return;
  const transaction = typeof d.transaction_id === "string" && isCardPaymentId(d.transaction_id) ? d.transaction_id : null;
  const { error } = await admin.rpc("payer_echeance", { p_echeance: e.id, p_paiement: transaction, p_carte: null, p_sepa: null, p_chiffres: null });
  if (error) throw new Error(`période payée non notée : ${error.message}`);
  await admin.from("abonnement_echeances").update({ eko_regle_le: maintenant() }).eq("id", e.id);
  console.log("MichelIA+ E-KO : période payée", a.id, e.periode_fin);
}

// Le prélèvement a raté, ou un prélèvement SEPA déjà compté a été rejeté par la banque : la période
// redevient due (E-KO retente à J+3, J+7 et J+14), l'abonnement passe impayé. Une période rejetée après
// coup n'est plus payée : MichelIA+ revient au début de cette période.
// deno-lint-ignore no-explicit-any
async function periodeRatee(a: Abonnement, d: any): Promise<void> {
  const e = await echeanceDuCycle(d.cycle_id ?? d.cycle?.id);
  if (!e) throw new PasEncore("période ratée pas encore vue");
  if (e.statut === "paye") {
    const { data: rouverte } = await admin.from("abonnement_echeances").update({ statut: "en_cours", eko_regle_le: null })
      .eq("id", e.id).eq("statut", "paye").select("id");
    if (rouverte?.length && a.fin_periode && new Date(a.fin_periode).getTime() === new Date(e.periode_fin).getTime()) {
      await admin.from("abonnements").update({ fin_periode: e.periode_debut, updated_at: maintenant() }).eq("id", a.id);
    }
  }
  await admin.from("abonnements").update({ statut: "impaye", echecs: (a.echecs ?? 0) + 1, updated_at: maintenant() })
    .eq("id", a.id).in("statut", ["actif", "impaye"]);
  console.error("MichelIA+ E-KO : prélèvement raté", a.id, String(d.failure_reason ?? "").slice(0, 60), String(d.psp_status ?? "").slice(0, 40));
}
