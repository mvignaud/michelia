// Fonction « michelia-plus-echeances » : Stancer n'a pas d'abonnements, alors toutes les heures
// (pg_cron, migration 20261030100000_michelia_plus_carte.sql), Michel prélève lui-même les échéances
// MichelIA+ arrivées à terme sur le site, avec la carte enregistrée chez Stancer au premier paiement
// (jeton card_…) ou le mandat SEPA signé (sepa_…), sans la personne. Elle relit aussi les échéances
// restées en cours et les prélèvements SEPA encore rejetables, arrête les abonnements résiliés arrivés
// au bout, et ceux qui ont raté trop d'échéances (_shared/abonnement.ts).
// Seul le cron l'appelle : il envoie le secret « michelia_plus_cron » du coffre (vault), vérifié ici.
// Et même rejouée, elle ne prélève qu'une fois par période : l'identifiant unique envoyé à Stancer
// dépend de l'abonnement, de la période et du nombre d'échecs, et Stancer refuse un doublon.
import { admin, stancer, stancerConfigured } from "../_shared/stancer.ts";
import { abandonnerSepa, confirmerEcheance, confirmerSepa, echecSur, finDePeriode, type Formule, libelle, menageEnAttente, relireSepa, reprendrePremiersSepa, safeError } from "../_shared/abonnement.ts";

const PAR_PASSAGE = 20;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Méthode non permise" });
  const { data: cron } = await admin.rpc("michelia_plus_cron_ok", { p_secret: req.headers.get("x-michel-cron") ?? "" });
  if (cron !== true) return json(401, { error: "Non autorisé" });
  if (!stancerConfigured()) return json(200, { preleves: 0 });
  const maintenant = new Date().toISOString();

  // Résiliés arrivés au bout de la période payée : terminé.
  await admin.from("abonnements").update({ statut: "expire", updated_at: maintenant })
    .eq("source", "web").eq("statut", "resilie").lte("fin_periode", maintenant);
  // Souscriptions jamais payées : on fait le ménage au bout d'une demi-heure ; une page de prélèvement
  // SEPA jamais signée, au bout d'un jour.
  await abandonnerSepa(86_400_000);
  // Codes de signature de plus d'un jour : leur empreinte d'IBAN (salée, mais forçable) ne reste pas en base.
  const { error: purge } = await admin.from("mandats_sepa_codes").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if (purge) console.error("MichelIA+ : purge des codes de mandat impossible", purge.message);
  await menageEnAttente(1_800_000);
  // Mandats signés sur le site dont le premier prélèvement n'a pas eu de réponse nette : relancés.
  await reprendrePremiersSepa(PAR_PASSAGE);

  // Échéances restées en cours (Stancer lent à répondre, page SEPA pas encore revenue) : relues.
  const { data: enCours } = await admin.from("abonnement_echeances").select("paiement_id, stancer_intent")
    .eq("statut", "en_cours").lt("created_at", new Date(Date.now() - 600_000).toISOString()).limit(PAR_PASSAGE);
  for (const e of enCours ?? []) {
    await (e.stancer_intent && e.paiement_id === e.stancer_intent ? confirmerSepa(e.stancer_intent) : confirmerEcheance(e.paiement_id));
  }
  // Prélèvements SEPA rejetés par la banque après coup.
  const rejets = await relireSepa(100);

  // Échéances dues : carte enregistrée ou mandat signé, période finie, pas d'essai prévu plus tard.
  const { data: dus, error } = await admin
    .from("abonnements")
    .select("id, formule, moyen, prix_cents, fin_periode, stancer_carte, stancer_sepa, stancer_client, prochain_essai, echecs, essai")
    .eq("source", "web")
    .in("moyen", ["carte", "sepa"])
    .in("statut", ["actif", "impaye"])
    .lte("fin_periode", maintenant)
    .or(`prochain_essai.is.null,prochain_essai.lte.${maintenant}`)
    .order("fin_periode", { ascending: true })
    .limit(PAR_PASSAGE);
  if (error) {
    console.error("MichelIA+ : abonnements illisibles", error.message);
    return json(500, { error: "Base illisible" });
  }

  let preleves = 0;
  for (const a of dus ?? []) {
    const sepa = a.moyen === "sepa";
    if (sepa ? !a.stancer_sepa : !a.stancer_carte) {
      console.error(sepa ? "MichelIA+ : abonnement sans mandat SEPA" : "MichelIA+ : abonnement sans carte enregistrée", a.id);
      continue;
    }
    // On réserve l'abonnement (prochain essai dans une heure) avant tout appel : deux passages en
    // même temps ne prélèvent jamais deux fois.
    let reserve = admin.from("abonnements").update({ prochain_essai: new Date(Date.now() + 3_600_000).toISOString() }).eq("id", a.id);
    reserve = a.prochain_essai ? reserve.eq("prochain_essai", a.prochain_essai) : reserve.is("prochain_essai", null);
    const { data: pris } = await reserve.select("id");
    if (!pris?.length) continue;

    const debut = new Date(a.fin_periode);
    // Jour de prélèvement d'origine (début de la première période) : un abonnement pris le 31 janvier
    // passe le 28 février, puis revient le 31 mars au lieu de rester au 28.
    const { data: premiere } = await admin.from("abonnement_echeances").select("periode_debut")
      .eq("abonnement_id", a.id).order("periode_debut", { ascending: true }).limit(1);
    const ancre = premiere?.length ? new Date(premiere[0].periode_debut).getUTCDate() : debut.getUTCDate();
    const fin = finDePeriode(debut, a.formule as Formule, ancre);
    // Une seule échéance par période : si elle existe déjà (payée ou en cours), on la relit seulement.
    const { data: deja } = await admin.from("abonnement_echeances").select("paiement_id, statut")
      .eq("abonnement_id", a.id).eq("periode_debut", debut.toISOString()).neq("statut", "refuse").limit(1);
    if (deja?.length) {
      await confirmerEcheance(deja[0].paiement_id);
      continue;
    }

    const { data: numero } = await admin.rpc("prochain_numero_recu");
    const numeroRecu = typeof numero === "string" && numero.length <= 36 ? numero : null;
    // Même période, même nombre d'échecs : même identifiant, donc jamais deux prélèvements.
    const uniqueId = `abo_${a.id}.${debut.toISOString().slice(0, 10).replaceAll("-", "")}.${a.echecs ?? 0}`;
    const res = await stancer("POST", "/v1/checkout/", {
      amount: a.prix_cents,
      currency: "eur",
      description: libelle(a.formule as Formule),
      unique_id: uniqueId,
      ...(numeroRecu ? { order_id: numeroRecu } : {}),
      ...(a.stancer_client ? { customer: a.stancer_client } : {}),
      // Carte : paiement à l'initiative du marchand, sans 3D Secure. SEPA : prélèvement sur le mandat.
      ...(sepa ? { sepa: a.stancer_sepa } : { card: a.stancer_carte }),
      capture: true,
    });
    // Doublon (409) : ce prélèvement est déjà parti à un passage précédent, qui est tombé avant de
    // l'enregistrer. Pas un échec : on rattache le paiement existant à la période.
    if (res.status === 409) {
      const existant = res.data?.error?.message?.id;
      console.error("MichelIA+ : ALERTE prélèvement déjà envoyé pour cette période", a.id, uniqueId, typeof existant === "string" ? existant : "id inconnu");
      if (typeof existant === "string" && /^paym_[A-Za-z0-9]{6,64}$/.test(existant)) {
        const { data: vu } = await stancer("GET", `/v1/checkout/${existant}`);
        await admin.from("abonnement_echeances").upsert({
          abonnement_id: a.id,
          paiement_id: existant,
          montant_cents: a.prix_cents,
          periode_debut: debut.toISOString(),
          periode_fin: fin.toISOString(),
          numero_recu: typeof vu?.order_id === "string" && vu.order_id.length <= 36 ? vu.order_id : null,
          essai: a.essai,
        }, { onConflict: "paiement_id", ignoreDuplicates: true });
        const etat = await confirmerEcheance(existant);
        if (etat.etat === "paye") preleves++;
        // Déjà refusé (compte d'échecs en retard) : un échec de plus, pour que le prochain essai ait
        // un nouvel identifiant au lieu de retomber sur ce paiement.
        if (etat.etat === "refuse") await echecSur(a.id);
      }
      continue;
    }
    const paymentId = res.data?.id;
    if (!res.ok || typeof paymentId !== "string") {
      console.error("MichelIA+ : échéance refusée par Stancer", a.id, res.status, safeError(res.data));
      // Refus net (4xx) : comptée comme ratée, Michel réessaiera dans quelques jours.
      if (res.status < 500) await echecSur(a.id);
      continue;
    }
    const { error: noteErr } = await admin.from("abonnement_echeances").insert({
      abonnement_id: a.id,
      paiement_id: paymentId,
      montant_cents: a.prix_cents,
      periode_debut: debut.toISOString(),
      periode_fin: fin.toISOString(),
      numero_recu: numeroRecu,
      essai: a.essai,
    });
    if (noteErr) {
      console.error("MichelIA+ : ALERTE échéance non enregistrée pour un paiement Stancer", paymentId, noteErr.message);
      continue;
    }
    const etat = await confirmerEcheance(paymentId);
    if (etat.etat === "paye") preleves++;
    console.log("MichelIA+ : échéance", a.id, etat.etat);
  }
  return json(200, { dus: dus?.length ?? 0, preleves, rejets });
});
