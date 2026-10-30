// Fonction « facturer » : chaque pourboire payé sur le web devient une facture GOLDEN PRINT dans l'ERP
// E-KO (jamais envoyée au client), et le payeur reçoit son reçu PDF aux couleurs de Michel.
// Deux interrupteurs dans app_config : facturation_eko_active et recus_actifs. Tant que la facturation
// est coupée, le reçu porte un numéro propre à Michel (R2026-000123) au lieu du numéro de facture.
// Appelée toutes les 5 minutes par pg_cron (migration 20261030020000_facturation_eko.sql).
// Sans danger si quelqu'un d'autre l'appelle : elle ne traite que les pourboires en attente.
// Jamais les paiements d'essai, jamais les achats des applis (Apple et Google en sont les vendeurs).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { ekoConfigure, facturerVente, tiersGenerique } from "../_shared/eko.ts";
import { envoyerRecu } from "../_shared/recu.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PRESTATAIRES: Record<string, string> = { stripe: "Stripe", stancer: "Stancer" };
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

Deno.serve(async () => {
  const c = await config();
  const facturer = c.facturation_eko_active === "true";
  const recus = c.recus_actifs === "true";
  if (!facturer && !recus) return json(200, { ok: true, actif: false });
  if (facturer && !ekoConfigure()) return json(500, { error: "Secret EKO_API_TOKEN manquant." });

  // Factures et reçus ont chacun leur interrupteur et leur date de départ.
  const conditions: string[] = [];
  if (facturer) conditions.push(`and(facture_code.is.null,created_at.gte.${c.facturation_eko_depuis || "2999-01-01"})`);
  if (recus) conditions.push(`and(email.not.is.null,recu_envoye_at.is.null,created_at.gte.${c.recus_depuis || "2999-01-01"})`);

  const { data: lignes, error } = await admin
    .from("pourboires")
    .select("id, paiement_id, prestataire, montant_cents, devise, palier, prenom, email, created_at, facture_code, recu_envoye_at, facture_tentatives")
    .eq("canal", "web")
    .eq("essai", false)
    .in("prestataire", Object.keys(PRESTATAIRES))
    .lt("facture_tentatives", MAX_TENTATIVES)
    .or(conditions.join(","))
    .order("created_at")
    .limit(PAR_PASSAGE);
  if (error) return json(500, { error: error.message });
  if (!lignes?.length) return json(200, { ok: true, traites: 0 });

  const noms = libelles(c.comptoir_paliers);
  const tierId = facturer ? await tiersGenerique(c.facturation_eko_client || "ClientMichel Web") : 0;
  const depuisFactures = new Date(c.facturation_eko_depuis || "2999-01-01");
  const depuisRecus = new Date(c.recus_depuis || "2999-01-01");
  let factures = 0, envoyes = 0, echecs = 0;

  for (const l of lignes) {
    const libelle = `Pourboire MichelIA : ${noms[l.palier] ?? l.palier}`;
    const date = new Date(l.created_at);
    try {
      if (String(l.devise) !== "eur") throw new Error(`devise ${l.devise} non gérée`);
      let code = l.facture_code as string | null;
      const aFacturer = facturer && !code && date >= depuisFactures;
      if (aFacturer) {
        code = await facturerVente({
          tierId,
          paiementId: String(l.paiement_id),
          libelle,
          montantTtcCents: l.montant_cents,
          date: jourParis(date),
          prestataire: PRESTATAIRES[l.prestataire],
        });
        await admin.from("pourboires").update({ facture_code: code, facture_erreur: null }).eq("id", l.id);
        factures++;
      }
      if (recus && l.email && !l.recu_envoye_at && date >= depuisRecus) {
        const envoye = await envoyerRecu({
          numero: code ?? numeroRecu(l.id, date),
          facture: !!code,
          date,
          email: l.email,
          prenom: l.prenom,
          libelle,
          montantTtcCents: l.montant_cents,
          moyen: "Carte bancaire",
        });
        if (!envoye) throw new Error("reçu refusé par Postal");
        await admin.from("pourboires").update({ recu_envoye_at: new Date().toISOString() }).eq("id", l.id);
        envoyes++;
      }
    } catch (e) {
      echecs++;
      const message = e instanceof Error ? e.message : String(e);
      console.error("Pourboire", l.id, message);
      await admin.from("pourboires").update({
        facture_erreur: message.slice(0, 500),
        facture_tentatives: (l.facture_tentatives ?? 0) + 1,
      }).eq("id", l.id);
    }
  }
  return json(200, { ok: true, factures, recus: envoyes, echecs });
});
