// Fonction « alertes » : prévient Mathieu par e-mail de ce qui se passe chez Michel. Les triggers de la
// migration 20261030160000_alertes.sql déposent chaque événement dans public.alertes ; toutes les 5 minutes
// (pg_cron), cette fonction les réserve, les met en forme aux couleurs des courriers de Michel et les envoie
// à alertes_destinataire (contact@michel.beer). Au-delà de RECAP alertes d'un coup, un seul récapitulatif.
// Une doléance qui laisse un e-mail de contact se répond directement : il sert de Reply-To.
// Sans danger si quelqu'un d'autre l'appelle : elle n'écrit qu'à Mathieu, et une seule fois par alerte.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { type Alerte, courrier, estEmail, recapitulatif } from "../_shared/alertes.ts";
import { envoyerCourrier } from "../_shared/courriers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PAR_PASSAGE = 50;
const RECAP = 8;
const CONSERVATION_JOURS = 90;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function config(key: string): Promise<string | null> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

async function marquer(ids: number[], ok: boolean) {
  if (!ids.length) return;
  await admin.from("alertes")
    .update(ok ? { envoyee_at: new Date().toISOString(), erreur: null } : { reservee_at: null, erreur: "refusé par Postal" })
    .in("id", ids);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST seulement" });

  const destinataire = (await config("alertes_destinataire"))?.trim() || "contact@michel.beer";
  if (!estEmail(destinataire)) return json(500, { error: "alertes_destinataire n'est pas une adresse" });

  const { data, error } = await admin.rpc("reserver_alertes", { p_limite: PAR_PASSAGE });
  if (error) {
    console.error("Réservation des alertes impossible :", error.message);
    return json(500, { error: "réservation impossible" });
  }
  const alertes = (data ?? []) as Alerte[];

  let envoyees = 0;
  if (alertes.length > RECAP) {
    const ok = await envoyerCourrier(destinataire, recapitulatif(alertes), "alertes-recap");
    await marquer(alertes.map((a) => a.id), ok);
    if (ok) envoyees = alertes.length;
  } else {
    for (const a of alertes) {
      const { c, repondreA } = courrier(a);
      const ok = await envoyerCourrier(destinataire, c, `alerte-${a.genre}`, [], repondreA);
      await marquer([a.id], ok);
      if (ok) envoyees++;
    }
  }

  // Le ménage : les alertes envoyées ne servent plus à rien après quelques mois.
  await admin.from("alertes").delete()
    .lt("envoyee_at", new Date(Date.now() - CONSERVATION_JOURS * 86_400_000).toISOString());

  if (alertes.length) console.log("Alertes", alertes.length, "envoyées", envoyees);
  return json(200, { alertes: alertes.length, envoyees });
});
