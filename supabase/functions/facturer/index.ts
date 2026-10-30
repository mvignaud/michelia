// Fonction « facturer » : chaque pourboire payé sur le web devient une facture GOLDEN PRINT dans l'ERP
// E-KO (jamais envoyée au client), et le payeur reçoit son reçu PDF aux couleurs de Michel.
// Deux interrupteurs dans app_config : facturation_eko_active et recus_actifs. Sans facture (facturation
// coupée, jeton EKO_API_TOKEN absent, E-KO en panne), le reçu porte un numéro propre à Michel (R2026-000123).
// Appelée toutes les 5 minutes par pg_cron (migration 20261030040000_facturation_eko.sql).
// Sans danger si quelqu'un d'autre l'appelle : elle ne traite que les pourboires en attente.
// Jamais les paiements d'essai, jamais les achats des applis (Apple et Google en sont les vendeurs).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { ekoConfigure, facturerVente, tiersGenerique } from "../_shared/eko.ts";
import { envoyerRecu } from "../_shared/recu.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PRESTATAIRES = ["stripe", "stancer"];
const MAX_TENTATIVES = 5;
const PAR_PASSAGE = 20;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const jourParis = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);

async function config(): Promise<Record<string, string>> {
  const { data, error } = await admin.from("app_config").select("key, value").in("key", [
    "facturation_eko_active",
    "facturation_eko_depuis",
    "facturation_eko_client",
    "recus_actifs",
    "recus_depuis",
    "comptoir_paliers",
  ]);
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.key, row.value]));
}

function libelles(raw: string | undefined): Record<string, string> {
  try {
    return Object.fromEntries((JSON.parse(raw ?? "[]") as { id: string; nom: string }[]).map((p) => [p.id, p.nom]));
  } catch {
    return {};
  }
}

// Numéro du reçu tant que la facture E-KO n'existe pas : propre à Michel, tiré de la ligne du pourboire.
const numeroRecu = (id: number, date: Date) => `R${jourParis(date).slice(0, 4)}-${String(id).padStart(6, "0")}`;

type Ligne = {
  id: number; paiement_id: string; prestataire: string; montant_cents: number; devise: string; palier: string;
  prenom: string | null; email: string | null; created_at: string; facture_code: string | null;
  facture_reglee_at: string | null; facture_tentatives: number; recu_tentatives: number;
};
const COLONNES = "id, paiement_id, prestataire, montant_cents, devise, palier, prenom, email, created_at, facture_code, facture_reglee_at, facture_tentatives, recu_tentatives";

// Pourboires concernés : web, réels, payés chez un prestataire du locataire.
const pourboires = () =>
  admin.from("pourboires").select(COLONNES).eq("canal", "web").eq("essai", false).in("prestataire", PRESTATAIRES);

Deno.serve(async () => {
  const c = await config();
  // Sans jeton E-KO, la facturation attend sans bloquer les reçus.
  const facturer = c.facturation_eko_active === "true" && ekoConfigure();
  const recus = c.recus_actifs === "true";
  if (!facturer && !recus) return json(200, { ok: true, actif: false });

  const noms = libelles(c.comptoir_paliers);
  const libelle = (l: Ligne) => `Pourboire MichelIA : ${noms[l.palier] ?? l.palier}`;
  let factures = 0, envoyes = 0, echecs = 0;
  const erreur = (l: Ligne, quoi: string, e: unknown) => {
    echecs++;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Pourboire ${l.id} (${quoi})`, message);
    return message.slice(0, 500);
  };

  // 1. Les factures d'abord, pour que les reçus qui suivent portent leur numéro. Chacune a son compteur
  // d'essais : une panne d'E-KO n'arrête pas les reçus, une panne de Postal n'arrête pas la facturation.
  if (facturer) {
    const { data, error } = await pourboires()
      .is("facture_reglee_at", null)
      .gte("created_at", c.facturation_eko_depuis || "2999-01-01")
      .lt("facture_tentatives", MAX_TENTATIVES)
      .order("created_at")
      .limit(PAR_PASSAGE);
    if (error) return json(500, { error: error.message });
    let tierId = 0;
    if (data?.length) {
      try {
        tierId = await tiersGenerique(c.facturation_eko_client || "ClientMichel Web");
      } catch (e) {
        echecs++;
        console.error("E-KO : client générique introuvable", e instanceof Error ? e.message : e);
      }
    }
    for (const l of (tierId ? data ?? [] : []) as Ligne[]) {
      try {
        if (l.devise !== "eur") throw new Error(`devise ${l.devise} non gérée`);
        await facturerVente({
          tierId,
          paiementId: l.paiement_id,
          libelle: libelle(l),
          montantTtcCents: l.montant_cents,
          date: jourParis(new Date(l.created_at)),
          prestataire: l.prestataire,
        }, l.facture_code, async (numero) => {
          await admin.from("pourboires").update({ facture_code: numero }).eq("id", l.id);
        });
        await admin.from("pourboires").update({ facture_reglee_at: new Date().toISOString(), facture_erreur: null }).eq("id", l.id);
        factures++;
      } catch (e) {
        await admin.from("pourboires").update({ facture_erreur: erreur(l, "facture", e), facture_tentatives: l.facture_tentatives + 1 }).eq("id", l.id);
      }
    }
  }

  // 2. Les reçus, avec le numéro de facture quand elle existe, sinon un numéro de reçu Michel.
  if (recus) {
    const { data, error } = await pourboires()
      .not("email", "is", null)
      .is("recu_envoye_at", null)
      .gte("created_at", c.recus_depuis || "2999-01-01")
      .lt("recu_tentatives", MAX_TENTATIVES)
      .order("created_at")
      .limit(PAR_PASSAGE);
    if (error) return json(500, { error: error.message });
    for (const l of (data ?? []) as Ligne[]) {
      // Réservation atomique : deux appels simultanés n'envoient jamais deux reçus. Une réservation
      // vieille de plus de 10 minutes (appel coupé en route) est reprise.
      const perimee = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: pris } = await admin.from("pourboires")
        .update({ recu_reserve_at: new Date().toISOString() })
        .eq("id", l.id)
        .is("recu_envoye_at", null)
        .or(`recu_reserve_at.is.null,recu_reserve_at.lt.${perimee}`)
        .select("id");
      if (!pris?.length) continue;

      const facture = l.facture_reglee_at ? l.facture_code : null;
      const date = new Date(l.created_at);
      let envoye = false;
      try {
        envoye = l.devise === "eur" && await envoyerRecu({
          numero: facture ?? numeroRecu(l.id, date),
          facture: !!facture,
          date,
          email: l.email!,
          prenom: l.prenom,
          libelle: libelle(l),
          montantTtcCents: l.montant_cents,
          moyen: "Carte bancaire",
        });
      } catch (e) {
        console.error(`Pourboire ${l.id} : reçu impossible à fabriquer`, e instanceof Error ? e.message : e);
      }
      if (envoye) {
        await admin.from("pourboires").update({ recu_envoye_at: new Date().toISOString() }).eq("id", l.id);
        envoyes++;
      } else {
        const message = erreur(l, "reçu", l.devise === "eur" ? "reçu refusé par Postal" : `devise ${l.devise} non gérée`);
        await admin.from("pourboires").update({ recu_reserve_at: null, recu_erreur: message, recu_tentatives: l.recu_tentatives + 1 }).eq("id", l.id);
      }
    }
  }

  return json(200, { ok: true, factures, recus: envoyes, echecs });
});
