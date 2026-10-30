// Fonction « facturer » : chaque pourboire payé sur le web devient une facture GOLDEN PRINT dans l'ERP
// E-KO (jamais envoyée au client), et le payeur reçoit son reçu PDF aux couleurs de Michel. Un pourboire
// remboursé (relevé chez Stancer : rembourse_cents) vaut au payeur un avoir de Michel, par e-mail.
// Deux interrupteurs dans app_config : facturation_eko_active et recus_actifs. Sans facture (facturation
// coupée, jeton EKO_API_TOKEN absent, E-KO en panne), le reçu porte seulement son numéro (R2026-000123).
// Appelée toutes les 5 minutes par pg_cron (migration 20261030040000_facturation_eko.sql).
// Sans danger si quelqu'un d'autre l'appelle : elle ne traite que les pourboires en attente.
// Jamais les paiements d'essai, jamais les achats des applis (Apple et Google en sont les vendeurs).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { ekoConfigure, facturerVente, tiersGenerique } from "../_shared/eko.ts";
import { envoyerAvoir, envoyerRecu } from "../_shared/recu.ts";

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

// Numéro de reçu : tiré à la création du paiement (numéro de commande chez le prestataire), sinon ici,
// dans la même série.
async function numeroRecu(l: { id: number; numero_recu: string | null }): Promise<string> {
  if (l.numero_recu) return l.numero_recu;
  const { data, error } = await admin.rpc("prochain_numero_recu");
  if (error || !data) throw new Error(`numéro de reçu : ${error?.message ?? "vide"}`);
  await admin.from("pourboires").update({ numero_recu: data }).eq("id", l.id);
  return String(data);
}

type Ligne = {
  id: number; paiement_id: string; prestataire: string; montant_cents: number; devise: string; palier: string;
  prenom: string | null; email: string | null; created_at: string; facture_code: string | null;
  facture_reglee_at: string | null; facture_tentatives: number; recu_tentatives: number; numero_recu: string | null;
};
const COLONNES = "id, paiement_id, prestataire, montant_cents, devise, palier, prenom, email, created_at, facture_code, facture_reglee_at, facture_tentatives, recu_tentatives, numero_recu";

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
  let factures = 0, envoyes = 0, rembourses = 0, echecs = 0;
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
          reference: await numeroRecu(l),
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

  // 2. Les reçus : leur numéro (celui de la commande chez le prestataire), et celui de la facture si elle existe.
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
          numero: await numeroRecu(l),
          facture,
          date,
          email: l.email!,
          prenom: l.prenom,
          libelle: libelle(l),
          montantTtcCents: l.montant_cents,
          moyen: "Carte bancaire",
        });
      } catch (e) {
        console.error(`Pourboire ${l.id} : reçu impossible à préparer`, e instanceof Error ? e.message : e);
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

  // 3. Les remboursements : chaque part remboursée pas encore couverte devient un avoir de Michel, tiré
  // en base d'un seul coup avec son compteur (tirer_avoirs, migration 20261030070000_mes_recus.sql).
  // L'avoir E-KO se fera ici quand l'API d'E-KO saura en créer.
  if (recus) {
    const { error: et } = await admin.rpc("tirer_avoirs");
    if (et) {
      echecs++;
      console.error("Avoirs non tirés", et.message);
    }

    // Puis l'e-mail de remboursement, avoir en pièce jointe. Réservation atomique comme pour les reçus.
    const { data: avoirs, error: ea } = await admin.from("avoirs")
      .select("id, numero, montant_cents, rembourse_le, envoi_tentatives, pourboire_id")
      .is("envoye_at", null)
      .lt("envoi_tentatives", MAX_TENTATIVES)
      .order("id")
      .limit(PAR_PASSAGE);
    if (ea) return json(500, { error: ea.message });
    for (const a of avoirs ?? []) {
      const perimee = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: pris } = await admin.from("avoirs")
        .update({ envoi_reserve_at: new Date().toISOString() })
        .eq("id", a.id)
        .is("envoye_at", null)
        .or(`envoi_reserve_at.is.null,envoi_reserve_at.lt.${perimee}`)
        .select("id");
      if (!pris?.length) continue;
      const { data } = await pourboires().eq("id", a.pourboire_id).maybeSingle();
      const l = data as Ligne | null;
      let envoye = false;
      try {
        if (l?.email) envoye = await envoyerAvoir({
          numero: a.numero,
          montantCents: a.montant_cents,
          date: new Date(a.rembourse_le),
          recu: {
            numero: await numeroRecu(l),
            facture: l.facture_reglee_at ? l.facture_code : null,
            date: new Date(l.created_at),
            email: l.email,
            prenom: l.prenom,
            libelle: libelle(l),
            montantTtcCents: l.montant_cents,
            moyen: "Carte bancaire",
          },
        });
      } catch (e) {
        console.error(`Avoir ${a.numero} : impossible à préparer`, e instanceof Error ? e.message : e);
      }
      if (envoye) {
        await admin.from("avoirs").update({ envoye_at: new Date().toISOString(), envoi_erreur: null }).eq("id", a.id);
        rembourses++;
        if (l?.facture_reglee_at) console.warn(`Avoir ${a.numero} : avoir à faire dans E-KO sur la facture ${l.facture_code}`);
      } else {
        echecs++;
        console.error(`Avoir ${a.numero} : e-mail de remboursement refusé`);
        await admin.from("avoirs").update({
          envoi_reserve_at: null,
          envoi_erreur: "e-mail de remboursement refusé par Postal",
          envoi_tentatives: a.envoi_tentatives + 1,
        }).eq("id", a.id);
      }
    }
  }

  return json(200, { ok: true, factures, recus: envoyes, remboursements: rembourses, echecs });
});
