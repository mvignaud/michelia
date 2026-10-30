// Fonction « michelia-plus-echeances » : Stancer n'a pas d'abonnements, alors toutes les heures
// (pg_cron, migration 20261030100000_michelia_plus_carte.sql), Michel prélève lui-même les échéances
// MichelIA+ arrivées à terme sur le site, avec la carte enregistrée chez Stancer au premier paiement
// (jeton card_…), sans la personne. Elle relit aussi les échéances restées en cours, arrête les
// abonnements résiliés arrivés au bout, et ceux qui ont raté trop d'échéances (_shared/abonnement.ts).
// Sans danger si quelqu'un d'autre l'appelle : elle ne fait que ce qui est dû, une fois.
import { admin, stancer, stancerConfigured } from "../_shared/stancer.ts";
import { confirmerEcheance, finDePeriode, type Formule, libelle, safeError } from "../_shared/abonnement.ts";

const PAR_PASSAGE = 20;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Méthode non permise" });
  if (!stancerConfigured()) return json(200, { preleves: 0 });
  const maintenant = new Date().toISOString();

  // Résiliés arrivés au bout de la période payée : terminé.
  await admin.from("abonnements").update({ statut: "expire", updated_at: maintenant })
    .eq("source", "web").eq("statut", "resilie").lte("fin_periode", maintenant);
  // Souscriptions jamais payées : on fait le ménage au bout d'un jour.
  await admin.from("abonnements").delete()
    .eq("source", "web").eq("statut", "en_attente").lt("created_at", new Date(Date.now() - 86_400_000).toISOString());

  // Échéances restées en cours (Stancer lent à répondre) : relues.
  const { data: enCours } = await admin.from("abonnement_echeances").select("paiement_id")
    .eq("statut", "en_cours").lt("created_at", new Date(Date.now() - 600_000).toISOString()).limit(PAR_PASSAGE);
  for (const e of enCours ?? []) await confirmerEcheance(e.paiement_id);

  // Échéances dues : carte enregistrée, période finie, pas d'essai prévu plus tard.
  const { data: dus, error } = await admin
    .from("abonnements")
    .select("id, formule, prix_cents, fin_periode, stancer_carte, stancer_client, prochain_essai, essai")
    .eq("source", "web")
    .eq("moyen", "carte")
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
    if (!a.stancer_carte) {
      console.error("MichelIA+ : abonnement sans carte enregistrée", a.id);
      continue;
    }
    // On réserve l'abonnement (prochain essai dans une heure) avant tout appel : deux passages en
    // même temps ne prélèvent jamais deux fois.
    let reserve = admin.from("abonnements").update({ prochain_essai: new Date(Date.now() + 3_600_000).toISOString() }).eq("id", a.id);
    reserve = a.prochain_essai ? reserve.eq("prochain_essai", a.prochain_essai) : reserve.is("prochain_essai", null);
    const { data: pris } = await reserve.select("id");
    if (!pris?.length) continue;

    const debut = new Date(a.fin_periode);
    const fin = finDePeriode(debut, a.formule as Formule);
    // Une seule échéance par période : si elle existe déjà (payée ou en cours), on la relit seulement.
    const { data: deja } = await admin.from("abonnement_echeances").select("paiement_id, statut")
      .eq("abonnement_id", a.id).eq("periode_debut", debut.toISOString()).neq("statut", "refuse").limit(1);
    if (deja?.length) {
      await confirmerEcheance(deja[0].paiement_id);
      continue;
    }

    const { data: numero } = await admin.rpc("prochain_numero_recu");
    const numeroRecu = typeof numero === "string" && numero.length <= 36 ? numero : null;
    const suffixe = crypto.getRandomValues(new Uint8Array(3)).reduce((t, b) => t + b.toString(16).padStart(2, "0"), "");
    const res = await stancer("POST", "/v1/checkout/", {
      amount: a.prix_cents,
      currency: "eur",
      description: libelle(a.formule as Formule),
      unique_id: `abo_${a.id}.${suffixe}`,
      ...(numeroRecu ? { order_id: numeroRecu } : {}),
      ...(a.stancer_client ? { customer: a.stancer_client } : {}),
      card: a.stancer_carte,
      capture: true,
    });
    const paymentId = res.data?.id;
    if (!res.ok || typeof paymentId !== "string") {
      console.error("MichelIA+ : échéance refusée par Stancer", a.id, res.status, safeError(res.data));
      // Refus net (4xx) : comptée comme ratée, Michel réessaiera dans quelques jours.
      if (res.status < 500) {
        const { data: ab } = await admin.from("abonnements").select("echecs").eq("id", a.id).single();
        const echecs = (ab?.echecs ?? 0) + 1;
        await admin.from("abonnements").update({
          statut: echecs >= 3 ? "expire" : "impaye",
          echecs,
          prochain_essai: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", a.id);
      }
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
  return json(200, { dus: dus?.length ?? 0, preleves });
});
