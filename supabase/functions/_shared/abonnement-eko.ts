// MichelIA+ dans E-KO (voir docs/MICHELIA-PLUS.md, section « E-KO »). E-KO tient le contrat de chaque
// abonné du site, facture chaque période (compte 706000, jamais envoyée) et la prélève chez Stancer sur
// la carte ou le mandat obtenus par Michel au premier paiement. Michel :
// - pousse chaque nouvel abonnement dans E-KO, avec le premier paiement déjà encaissé (synchroniserEko,
//   appelée toutes les heures par michelia-plus-echeances) ; transmet résiliations et reprises ;
// - suit E-KO par ses webhooks (fonction eko-webhook → traiterEvenement) : période facturée, payée,
//   ratée, relances épuisées, résiliation.
// Tant que michelia_plus_eko_actif ne vaut pas 'true', rien ne part : Michel prélève lui-même, comme avant.
import { admin, isCardPaymentId } from "./stancer.ts";
import { changerMoyenEko, coupureProgrammeeEko, EkoError, ekoConfigure, type MoyenAbonnement, premiereFactureEko, reglerFacture, reprendreEko, resilierEko, souscrireEko, tiersAbonne } from "./eko.ts";

const MAX_TENTATIVES = 5;
const MAX_ESSAIS_EVENEMENT = 5;
// Marque d'un webhook en cours de traitement (eko_evenements.erreur), le temps de la réservation.
const EN_COURS = "en_cours";

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

// La première facture E-KO (et sa période) sur l'échéance du premier paiement. Lève une erreur si
// l'écriture échoue : l'étape 1 bis de synchroniserEko la reprend.
async function lierPremiereFacture(echeanceId: number, f: { factureId: number; factureCode: string | null; cycleId: string | null }): Promise<void> {
  const { error } = await admin.from("abonnement_echeances").update({ eko_facture: f.factureCode, eko_facture_id: f.factureId }).eq("id", echeanceId);
  if (error) throw new Error(`première facture non notée : ${error.message}`);
  if (f.cycleId) {
    const { error: cycleErr } = await admin.from("abonnement_echeances").update({ eko_cycle: f.cycleId }).eq("id", echeanceId).is("eko_cycle", null);
    if (cycleErr) throw new Error(`première période non notée : ${cycleErr.message}`);
  }
}

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
      // Le code tout de suite : une reprise ne souscrit jamais deux fois. Pas noté : on recommence au
      // passage suivant, avec la même clé (E-KO rend la même souscription).
      const { data: note, error: noteErr } = await admin.from("abonnements").update({ eko_abonnement: sub.code, eko_tentatives: 0 }).eq("id", a.id).select("id");
      if (noteErr) throw new Error(`abonnement ${sub.code} non noté : ${noteErr.message}`);
      if (!note?.length) {
        // Compte supprimé pendant la souscription : l'abonnement n'existe plus chez Michel, E-KO le
        // coupe au passage (étape 5).
        await garderResiliation(sub.code);
        continue;
      }
      bilan.crees++;
      // Première facture sur l'échéance du premier paiement ; ratée, l'étape 1 bis la reprend.
      if (sub.factureId) await lierPremiereFacture(premier.id, { factureId: sub.factureId, factureCode: sub.factureCode, cycleId: sub.cycleId });
    } catch (e) {
      await noterErreur(a.id, a.eko_tentatives, e, "souscription");
    }
  }

  // 1 bis. Souscriptions notées dont la première facture n'est pas rattachée (réponse sans facture,
  // écriture ratée) : relue chez E-KO dans les périodes de l'abonnement.
  // Lu par pages : les abonnements déjà rattachés ne prennent jamais la place d'un abonnement à reprendre.
  const recents: { id: number; eko_abonnement: string | null; eko_tentatives: number; abonnement_echeances: unknown }[] = [];
  const depuis7j = new Date(Date.now() - 7 * 86_400_000).toISOString();
  for (let page = 0; page < 50; page++) {
    const { data, error: pageErr } = await admin.from("abonnements")
      .select("id, eko_abonnement, eko_tentatives, abonnement_echeances(id, paiement_id, created_at, statut, eko_facture_id, eko_cycle)")
      .eq("source", "web").not("eko_abonnement", "is", null).is("eko_erreur", null)
      .gte("created_at", depuis7j)
      .order("id", { ascending: false })
      .range(page * 200, page * 200 + 199);
    if (pageErr) {
      console.error("MichelIA+ E-KO : abonnements récents illisibles", pageErr.message);
      break;
    }
    recents.push(...(data ?? []));
    if ((data ?? []).length < 200) break;
  }
  for (const a of recents) {
    const echeances = (a.abonnement_echeances ?? []) as Paiement[];
    if (echeances.some((e) => e.eko_cycle || e.eko_facture_id)) continue;
    const premier = echeances.filter((e) => e.statut === "paye" && isCardPaymentId(e.paiement_id))
      .sort((x, y) => x.created_at.localeCompare(y.created_at))[0];
    if (!premier) continue;
    try {
      const facture = await premiereFactureEko(a.eko_abonnement!);
      if (!facture) throw new Error("première facture introuvable dans les périodes E-KO");
      await lierPremiereFacture(premier.id, facture);
    } catch (e) {
      await noterErreur(a.id, a.eko_tentatives, e, "rattachement de la première facture");
    }
  }

  // 2. Premiers paiements (encaissés par Michel) à enregistrer sur la première facture E-KO.
  const { data: aRegler } = await admin.from("abonnement_echeances")
    .select("id, abonnement_id, paiement_id, montant_cents, numero_recu, created_at, eko_facture_id, abonnements!inner(eko_tentatives)")
    // Les abonnements bloqués (eko_erreur) sortent de la file : ils n'empêchent pas les suivants de passer.
    .is("abonnements.eko_erreur", null)
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

  // 3. Résiliations demandées par l'abonné : E-KO coupe au terme déjà payé. Un abonnement déjà arrivé
  // au bout chez Michel (expire) sans que la résiliation soit partie est coupé tout de suite chez E-KO,
  // pour qu'aucune période ne soit plus prélevée.
  // Toujours tentée, même si l'abonnement porte une erreur de facturation (eko_erreur) : une résiliation
  // ne doit jamais rester bloquée derrière un autre problème. Ratée, elle est retentée à chaque passage.
  const { data: resilies } = await admin.from("abonnements").select("id, statut, eko_abonnement")
    .in("statut", ["resilie", "expire"]).not("eko_abonnement", "is", null).is("eko_resilie_le", null).limit(limite);
  for (const a of resilies ?? []) {
    try {
      await resilierEko(a.eko_abonnement!, a.statut === "resilie", a.statut === "resilie" ? "Résilié par l'abonné depuis son espace Michel" : "Abonnement terminé chez Michel");
      await admin.from("abonnements").update({ eko_resilie_le: maintenant() }).eq("id", a.id);
      bilan.resilies++;
    } catch (e) {
      // 422 : E-KO refuse parce que l'abonnement est déjà résilié chez lui ; rien de plus à transmettre.
      if (e instanceof EkoError && e.status === 422) {
        console.error("MichelIA+ E-KO : résiliation refusée (déjà résilié ?), à vérifier", a.id, messageDe(e));
        await admin.from("abonnements").update({ eko_resilie_le: maintenant() }).eq("id", a.id);
      } else {
        console.error("MichelIA+ E-KO : ALERTE résiliation non transmise, retentée au prochain passage", a.id, messageDe(e));
      }
    }
  }

  // 4. Reprises avant la fin de la période : le renouvellement repart chez E-KO.
  // Comme les résiliations : toujours tentée, même avec une erreur de facturation, et retentée à chaque passage.
  const { data: repris } = await admin.from("abonnements").select("id, eko_abonnement")
    .in("statut", ["actif", "impaye"]).not("eko_abonnement", "is", null).not("eko_resilie_le", "is", null).limit(limite);
  for (const a of repris ?? []) {
    try {
      if (!(await reprendreEko(a.eko_abonnement!))) throw new Error("E-KO prévoit toujours la coupure en fin de période");
      await admin.from("abonnements").update({ eko_resilie_le: null }).eq("id", a.id);
      bilan.repris++;
    } catch (e) {
      console.error("MichelIA+ E-KO : ALERTE reprise non transmise, retentée au prochain passage", a.id, messageDe(e));
    }
  }

  // 4 bis. Nouvelle carte ou nouveau mandat choisis par l'abonné sur le site : E-KO prélève dessus
  // (abonnements en cours ou impayés : un résilié ne sera plus prélevé par E-KO).
  // Retenté à chaque passage ; un changement plus récent, arrivé entre-temps, repart au suivant.
  const { data: changes } = await admin.from("abonnements")
    .select("id, moyen, stancer_carte, stancer_client, stancer_sepa, eko_abonnement, eko_moyen_change_le")
    .in("statut", ["actif", "impaye"]).not("eko_abonnement", "is", null).not("eko_moyen_change_le", "is", null).limit(limite);
  for (const a of changes ?? []) {
    const moyen: MoyenAbonnement | null = a.moyen === "sepa"
      ? (a.stancer_sepa ? { provider: "stancer_sepa", sepa_id: a.stancer_sepa } : null)
      : (a.stancer_carte ? { provider: "stancer_card", card_id: a.stancer_carte, ...(a.stancer_client ? { customer_id: a.stancer_client } : {}) } : null);
    if (!moyen) continue;
    try {
      await changerMoyenEko(a.eko_abonnement!, moyen);
      await admin.from("abonnements").update({ eko_moyen_change_le: null }).eq("id", a.id).eq("eko_moyen_change_le", a.eko_moyen_change_le);
    } catch (e) {
      // Refus sur le fond : noté une fois, pas retenté (à reprendre à la main dans E-KO).
      if (e instanceof EkoError && e.status === 422) {
        console.error("MichelIA+ E-KO : ALERTE nouveau moyen de paiement refusé par E-KO, à poser à la main", a.id, messageDe(e));
        await admin.from("abonnements").update({ eko_moyen_change_le: null }).eq("id", a.id).eq("eko_moyen_change_le", a.eko_moyen_change_le);
      } else {
        console.error("MichelIA+ E-KO : ALERTE nouveau moyen de paiement non transmis, retenté au prochain passage", a.id, messageDe(e));
      }
    }
  }

  // 5. Comptes supprimés : leur abonnement E-KO (gardé par un déclencheur avant la suppression) est coupé
  // tout de suite, pour qu'aucune période ne soit prélevée sans compte d'où la résilier. Retenté à chaque passage.
  const { data: orphelins } = await admin.from("eko_resiliations").select("eko_abonnement, essais")
    .is("transmise_le", null).order("demande_le").limit(limite);
  for (const o of orphelins ?? []) {
    try {
      try {
        await resilierEko(o.eko_abonnement, false, "Compte Michel supprimé par son titulaire");
      } catch (e) {
        // 422 : déjà résilié chez E-KO, rien de plus à transmettre.
        if (!(e instanceof EkoError && e.status === 422)) throw e;
      }
      const { error: fini } = await admin.from("eko_resiliations").update({ transmise_le: maintenant(), erreur: null })
        .eq("eko_abonnement", o.eko_abonnement);
      if (fini) throw new Error(`résiliation transmise mais pas notée : ${fini.message}`);
      bilan.resilies++;
    } catch (e) {
      await admin.from("eko_resiliations").update({ essais: (o.essais ?? 0) + 1, erreur: messageDe(e) }).eq("eko_abonnement", o.eko_abonnement);
      console.error("MichelIA+ E-KO : ALERTE abonnement d'un compte supprimé pas encore coupé, retenté au prochain passage", o.eko_abonnement, messageDe(e));
    }
  }
  return bilan;
}

// Un abonnement E-KO à couper parce que son compte Michel n'existe plus.
async function garderResiliation(code: string): Promise<void> {
  const { error } = await admin.from("eko_resiliations").upsert({ eko_abonnement: code }, { onConflict: "eko_abonnement", ignoreDuplicates: true });
  if (error) console.error("MichelIA+ E-KO : ALERTE résiliation d'un compte supprimé non gardée", code, error.message);
}

// ── Webhooks d'E-KO, gardés dans eko_evenements par la fonction eko-webhook.

type Abonnement = { id: number; statut: string; fin_periode: string | null; echecs: number; essai: boolean; eko_abonnement: string; eko_resilie_le: string | null };

class PasEncore extends Error {}

// Traite un webhook reçu. Rejouable : chaque cas vérifie l'état avant d'écrire. Un événement qui arrive
// avant ce qu'il suppose (abonnement pas encore noté, période pas encore vue) est laissé au cron, qui le
// reprend quelques minutes plus tard.
export async function traiterEvenement(livraison: number): Promise<void> {
  const { data: ev } = await admin.from("eko_evenements").select("livraison, evenement, abonnement, charge, traite_le, essais, erreur")
    .eq("livraison", livraison).maybeSingle();
  if (!ev) return;
  // Réservation pour toute la durée du traitement : traite_le posé avec erreur = EN_COURS, par une
  // écriture conditionnelle (un seul gagnant). Un traitement coupé en route est repris après 10 minutes.
  const perimee = new Date(Date.now() - 600_000).toISOString();
  const essais = (ev.essais ?? 0) + 1;
  const { data: pris } = await admin.from("eko_evenements")
    .update({ traite_le: maintenant(), erreur: EN_COURS, essais })
    .eq("livraison", livraison)
    .or(`traite_le.is.null,and(erreur.eq.${EN_COURS},traite_le.lt.${perimee})`)
    .select("livraison");
  if (!pris?.length) return;
  try {
    await appliquer(ev.evenement, ev.charge?.data ?? {}, ev.abonnement, String(ev.charge?.occurred_at ?? ""));
    await admin.from("eko_evenements").update({ traite_le: maintenant(), erreur: null }).eq("livraison", livraison);
  } catch (e) {
    const abandon = essais >= MAX_ESSAIS_EVENEMENT;
    // Raté : la réservation est rendue (traite_le vide) pour que le cron le reprenne, sauf au dernier essai.
    await admin.from("eko_evenements").update({
      erreur: messageDe(e),
      traite_le: abandon ? maintenant() : null,
    }).eq("livraison", livraison);
    if (abandon || !(e instanceof PasEncore)) {
      console.error(`MichelIA+ E-KO : ${abandon ? "ALERTE webhook abandonné" : "webhook en échec"}`, livraison, ev.evenement, messageDe(e));
    }
  }
}

// Les webhooks pas encore traités (traitement raté, ou arrivés trop tôt), repris par le cron.
export async function reprendreEvenements(limite: number): Promise<void> {
  const perimee = new Date(Date.now() - 600_000).toISOString();
  const { data } = await admin.from("eko_evenements").select("livraison")
    .or(`traite_le.is.null,and(erreur.eq.${EN_COURS},traite_le.lt.${perimee})`)
    .lt("recu_le", new Date(Date.now() - 120_000).toISOString()).order("livraison").limit(limite);
  for (const e of data ?? []) await traiterEvenement(e.livraison);
}

// deno-lint-ignore no-explicit-any
async function appliquer(evenement: string, d: any, code: string | null, survenu: string): Promise<void> {
  const suivis = ["cycle.billed", "cycle.paid", "cycle.failed", "dunning.exhausted", "subscription.cancelled", "subscription.cancel_scheduled"];
  if (!suivis.includes(evenement)) return;
  if (!code) throw new Error("webhook sans abonnement");
  const { data: ab } = await admin.from("abonnements").select("id, statut, fin_periode, echecs, essai, eko_abonnement, eko_resilie_le")
    .eq("eko_abonnement", code).maybeSingle();
  if (!ab) {
    // Compte supprimé : l'abonnement est coupé chez E-KO (étape 5), ses avis n'ont plus rien à mettre à jour.
    const { data: supprime } = await admin.from("eko_resiliations").select("eko_abonnement").eq("eko_abonnement", code).maybeSingle();
    if (supprime) return;
    // Souscription en cours de notation chez Michel (le webhook arrive pendant l'appel) : plus tard.
    throw new PasEncore(`abonnement ${code} pas encore connu`);
  }
  const a = ab as Abonnement;

  switch (evenement) {
    case "cycle.billed":
      return periodeFacturee(a, d.cycle ?? {});
    case "cycle.paid":
      return periodePayee(a, d, survenu);
    case "cycle.failed":
      return periodeRatee(a, d, survenu);
    case "dunning.exhausted": {
      // Relances finies sans paiement (J+21) : l'abonnement s'arrête tout de suite.
      // Sauf si la période a été payée depuis (avis livré en retard après le cycle.paid) : rien à couper.
      if (a.statut !== "expire" && !(await impayeToujoursDu(a.id, d.cycle_id ?? d.cycle?.id))) {
        console.log("MichelIA+ E-KO : relances épuisées ignorées, la période a été payée depuis", a.id);
        return;
      }
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
      // Résiliation programmée depuis E-KO (ou transmise par Michel : déjà notée). Relue chez E-KO : un
      // avis en retard, arrivé après une reprise, ne doit pas résilier un abonnement qui renouvelle.
      // Reprise demandée chez Michel après une résiliation déjà transmise (eko_resilie_le posé) : elle
      // part vers E-KO au prochain passage (étape 4) ; l'avis ne la défait pas.
      if (["actif", "impaye"].includes(a.statut) && a.eko_resilie_le) return;
      if (!(await coupureProgrammeeEko(a.eko_abonnement))) return;
      await admin.from("abonnements").update({ statut: "resilie", resilie_le: maintenant(), eko_resilie_le: maintenant(), updated_at: maintenant() })
        .eq("id", a.id).in("statut", ["actif", "impaye"]);
      return;
    }
  }
}

// Reste-t-il quelque chose d'impayé ? La période de l'avis si E-KO la donne, sinon toute période E-KO
// encore en cours (non payée) de l'abonnement.
async function impayeToujoursDu(abonnementId: number, cycleId: unknown): Promise<boolean> {
  if (cycleId !== undefined && cycleId !== null && cycleId !== "") {
    const e = await echeanceDuCycle(cycleId);
    if (e) return e.statut === "en_cours";
  }
  const { count, error } = await admin.from("abonnement_echeances").select("id", { count: "exact", head: true })
    .eq("abonnement_id", abonnementId).not("eko_cycle", "is", null).eq("statut", "en_cours");
  if (error) throw new Error(`périodes illisibles : ${error.message}`);
  return (count ?? 0) > 0;
}

// deno-lint-ignore no-explicit-any
async function echeanceDuCycle(cycleId: unknown): Promise<any> {
  if (cycleId === undefined || cycleId === null || cycleId === "") throw new Error("webhook sans cycle");
  const { data } = await admin.from("abonnement_echeances").select("id, abonnement_id, statut, periode_debut, periode_fin, eko_regle_le, eko_rejete_le")
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

// Heure d'un événement d'E-KO (occurred_at), sinon maintenant.
const heureDe = (survenu: string) => {
  const t = new Date(survenu);
  return Number.isNaN(t.getTime()) ? new Date() : t;
};

// Le prélèvement d'E-KO est passé (ou Michel a enregistré le premier paiement) : la période est payée,
// MichelIA+ est prolongé jusqu'à sa fin, les échecs repartent à zéro. eko_regle_le garde l'heure du
// paiement chez E-KO : un échec plus ancien qui arriverait ensuite ne le défait pas (periodeRatee).
// deno-lint-ignore no-explicit-any
async function periodePayee(a: Abonnement, d: any, survenu: string): Promise<void> {
  const e = await echeanceDuCycle(d.cycle_id ?? d.cycle?.id);
  if (!e) throw new PasEncore("période payée pas encore vue");
  if (e.statut === "paye") {
    // Déjà payée : l'heure du paiement manque si son écriture avait raté (ou si l'avis rejoue) ; on la
    // complète, sans quoi un vieux rejet livré ensuite rouvrirait la période.
    if (!e.eko_regle_le) await noterHeurePaiement(e.id, survenu);
    return;
  }
  // Un paiement antérieur au dernier rejet bancaire de la période (avis livré en retard) ne compte plus.
  if (e.eko_rejete_le && heureDe(survenu).getTime() <= new Date(e.eko_rejete_le).getTime()) {
    console.log("MichelIA+ E-KO : paiement ancien ignoré, rejeté depuis par la banque", a.id, e.id);
    return;
  }
  const transaction = typeof d.transaction_id === "string" && isCardPaymentId(d.transaction_id) ? d.transaction_id : null;
  const { data: paye, error } = await admin.rpc("payer_echeance", { p_echeance: e.id, p_paiement: transaction, p_carte: null, p_sepa: null, p_chiffres: null });
  if (error) throw new Error(`période payée non notée : ${error.message}`);
  // payer_echeance ne paie qu'une échéance en cours : sinon, rien n'a été écrit, on le dit.
  if (paye !== true) throw new Error(`période payée non notée : échéance ${e.id} au statut ${e.statut}`);
  await noterHeurePaiement(e.id, survenu);
  console.log("MichelIA+ E-KO : période payée", a.id, e.periode_fin);
}

// Heure du paiement chez E-KO. Ratée, l'erreur remonte : l'avis est repris et la complète (période déjà payée).
async function noterHeurePaiement(echeanceId: number, survenu: string): Promise<void> {
  const { error } = await admin.from("abonnement_echeances").update({ eko_regle_le: heureDe(survenu).toISOString() })
    .eq("id", echeanceId).is("eko_regle_le", null);
  if (error) throw new Error(`heure du paiement non notée : ${error.message}`);
}

// Le prélèvement a raté, ou un prélèvement SEPA déjà compté a été rejeté par la banque : la période
// redevient due (E-KO retente à J+3, J+7 et J+14), l'abonnement passe impayé. Une période rejetée après
// coup n'est plus payée : MichelIA+ revient au début de cette période.
// Une période déjà payée n'est rouverte que par un vrai rejet (payment_rejected) survenu après son
// paiement : l'échec d'un essai précédent, livré en retard après le cycle.paid du nouvel essai, est ignoré.
// deno-lint-ignore no-explicit-any
async function periodeRatee(a: Abonnement, d: any, survenu: string): Promise<void> {
  const e = await echeanceDuCycle(d.cycle_id ?? d.cycle?.id);
  if (!e) throw new PasEncore("période ratée pas encore vue");
  const rejet = String(d.failure_reason ?? "") === "payment_rejected";
  if (e.statut === "paye") {
    const apresPaiement = !e.eko_regle_le || heureDe(survenu).getTime() > new Date(e.eko_regle_le).getTime();
    if (!rejet || !apresPaiement) {
      console.log("MichelIA+ E-KO : échec ancien ignoré, la période est payée", a.id, e.id);
      return;
    }
    const { error } = await admin.from("abonnement_echeances").update({ statut: "en_cours", eko_regle_le: null })
      .eq("id", e.id).eq("statut", "paye");
    if (error) throw new Error(`période rejetée non rouverte : ${error.message}`);
  }
  // L'heure du rejet est gardée (la plus récente) : un avis de paiement plus ancien, livré ensuite, est ignoré.
  if (rejet) {
    const quand = heureDe(survenu).toISOString();
    const { error } = await admin.from("abonnement_echeances").update({ eko_rejete_le: quand })
      .eq("id", e.id).or(`eko_rejete_le.is.null,eko_rejete_le.lt.${quand}`);
    if (error) throw new Error(`heure du rejet non notée : ${error.message}`);
  }
  // Une période non payée ne compte pas dans le droit : si la fin est encore la sienne, elle revient à son
  // début. Rejouable (une reprise après une coupure refait ce recul), et l'erreur est remontée pour
  // que l'événement soit repris.
  if (rejet) {
    const { error } = await admin.from("abonnements").update({ fin_periode: e.periode_debut, updated_at: maintenant() })
      .eq("id", a.id).eq("fin_periode", e.periode_fin);
    if (error) throw new Error(`droit non ramené au début de la période : ${error.message}`);
  }
  // Un échec de plus, sur le compte lu : si quelqu'un l'a changé entre-temps, on relit et on recommence.
  for (let essai = 0; essai < 3; essai++) {
    const { data: lu, error: luErr } = await admin.from("abonnements").select("echecs").eq("id", a.id).single();
    if (luErr) throw new Error(`abonnement illisible : ${luErr.message}`);
    const { data: fait, error } = await admin.from("abonnements").update({ statut: "impaye", echecs: (lu?.echecs ?? 0) + 1, updated_at: maintenant() })
      .eq("id", a.id).in("statut", ["actif", "impaye"]).eq("echecs", lu?.echecs ?? 0).select("id");
    if (error) throw new Error(`impayé non noté : ${error.message}`);
    if (fait?.length) break;
  }
  console.error("MichelIA+ E-KO : prélèvement raté", a.id, String(d.failure_reason ?? "").slice(0, 60), String(d.psp_status ?? "").slice(0, 40));
}
