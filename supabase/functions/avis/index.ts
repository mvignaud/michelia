// Fonction « avis » : une seule fois par inscrit, quelques jours après l'inscription, Michel lui
// demande son avis par e-mail, avec un lien vers Trustpilot ; le courrier part aussi en copie cachée
// à l'adresse d'invitation de Trustpilot (secret TRUSTPILOT_BCC), qui envoie son invitation officielle.
// - Appelée chaque matin par pg_cron (migration 20261105020000_avis_trustpilot.sql).
// - Coupée tant que app_config.avis_email_actif ne vaut pas 'true'.
// - Chaque inscrit est réservé (profiles.avis_invite_at) avant l'envoi : deux appels simultanés
//   n'écrivent jamais deux fois ; un envoi refusé libère la réservation pour le lendemain.
// Déployée sans vérification du JWT : l'appeler en trop n'écrit à personne de plus.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { demandeAvis, envoyerCourrier, TRUSTPILOT_BCC } from "../_shared/courriers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Inscrits écrits par passage : la file se vide en quelques matins sans tout envoyer d'un coup.
const PAR_PASSAGE = 100;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function config(key: string): Promise<string | null> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

type Inscrit = { user_id: string; email: string; first_name: string | null };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  if ((await config("avis_email_actif")) !== "true") return json(200, { actif: false });

  const jours = Math.max(0, Number(await config("avis_email_jours")) || 3);
  const { data, error } = await admin.rpc("avis_a_inviter", { p_jours: jours, p_limite: PAR_PASSAGE });
  if (error) return json(500, { error: error.message });

  let envoyes = 0;
  let echecs = 0;
  for (const qui of (data ?? []) as Inscrit[]) {
    // Réservation atomique : seul l'appel qui pose la date écrit à cet inscrit.
    const { data: pris } = await admin.from("profiles")
      .update({ avis_invite_at: new Date().toISOString() })
      .eq("id", qui.user_id)
      .is("avis_invite_at", null)
      .select("id");
    if (!pris?.length) continue;
    const ok = await envoyerCourrier(qui.email, demandeAvis({ prenom: qui.first_name }), "avis", [], undefined, TRUSTPILOT_BCC ? [TRUSTPILOT_BCC] : []);
    if (ok) envoyes++;
    else {
      echecs++;
      await admin.from("profiles").update({ avis_invite_at: null }).eq("id", qui.user_id);
    }
  }
  return json(200, { actif: true, envoyes, echecs });
});
