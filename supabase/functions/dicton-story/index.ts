// Fonction « dicton-story » : l'image (1080 × 1920, PNG) du dicton du jour de Michel, pour la story
// Instagram / Facebook. Une tâche du matin programme la story dans Metricool avec l'adresse
// …/functions/v1/dicton-story?d=AAAA-MM-JJ ; Metricool télécharge l'image une fois, à la programmation.
// - ?d=AAAA-MM-JJ : le dicton de ce jour-là (404 s'il n'est pas encore écrit).
// - Sans paramètre : le dernier dicton écrit.
// Déployée sans vérification du JWT : elle ne montre que le texte déjà envoyé à tout le monde
// en notification, et n'écrit rien.
import satori from "npm:satori@0.18.3";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { carte, HAUTEUR, type Kind, LARGEUR } from "./carte.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CDN = "https://cdn.jsdelivr.net/npm";
const charger = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} : ${r.status}`);
    return r.arrayBuffer();
  });

// Chargés une fois par démarrage de la fonction.
const pret = initWasm(charger(`${CDN}/@resvg/resvg-wasm@2.6.2/index_bg.wasm`));
const polices = Promise.all([
  charger(`${CDN}/@fontsource/fraunces@5.1.0/files/fraunces-latin-800-normal.woff`),
  charger(`${CDN}/@fontsource/fraunces@5.1.0/files/fraunces-latin-700-italic.woff`),
]).then(([gras, italique]) => [
  { name: "Fraunces", data: gras, weight: 800 as const, style: "normal" as const },
  { name: "Fraunces", data: italique, weight: 700 as const, style: "italic" as const },
]);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// « 2026-11-06 » → « Jeudi 6 novembre ».
function dateLisible(jour: string): string {
  const s = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${jour}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "GET seulement" });
  const d = new URL(req.url).searchParams.get("d");
  if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return json(400, { error: "d=AAAA-MM-JJ" });

  let requete = admin.from("daily_sayings").select("day, kind, text").not("text", "is", null);
  requete = d ? requete.eq("day", d) : requete.order("day", { ascending: false });
  const { data, error } = await requete.limit(1).maybeSingle();
  if (error) {
    console.error("daily_sayings", error);
    return json(500, { error: "lecture" });
  }
  if (!data) return json(404, { error: "pas encore de dicton" });

  try {
    await pret;
    const kind: Kind = data.kind === "coup_de_gueule" ? "coup_de_gueule" : "dicton";
    const svg = await satori(carte(data.text, kind, dateLisible(data.day)) as never, {
      width: LARGEUR,
      height: HAUTEUR,
      fonts: await polices,
    });
    const png = new Resvg(svg).render().asPng();
    return new Response(req.method === "HEAD" ? null : png, {
      headers: {
        "Content-Type": "image/png",
        // Un jour donné ne change plus ; sans date, l'image suit le dernier dicton.
        "Cache-Control": d ? "public, max-age=86400" : "public, max-age=600",
      },
    });
  } catch (e) {
    console.error("dessin", e);
    return json(500, { error: "dessin" });
  }
});
