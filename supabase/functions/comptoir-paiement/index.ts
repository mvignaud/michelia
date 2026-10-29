// Fonction « comptoir-paiement » : ouvre une session Stripe Checkout intégrée à la page /comptoir
// (voir docs/COMPTOIR.md). Le navigateur envoie seulement {palier} ; le prix et le nom viennent
// toujours de app_config (comptoir_paliers), jamais du client. La fonction renvoie {clientSecret},
// que Stripe.js utilise pour afficher le formulaire de paiement dans la page.
// Sans SDK Stripe : un simple fetch vers l'API, avec STRIPE_SECRET_KEY (secret Supabase).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
// Version de l'API Stripe qui introduit ui_mode=embedded_page (2026-03-25.dahlia, voir le changelog Stripe).
const STRIPE_VERSION = "2026-03-25.dahlia";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim());

function corsHeaders(origin: string | null): HeadersInit {
  const allow = allowedOrigins.includes("*")
    ? "*"
    : origin && allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function reply(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

type Palier = { id: string; nom: string; prix_cents: number };

async function config(key: string): Promise<string | undefined> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? undefined;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "Méthode non permise" }, origin);
  // Un navigateur d'un autre site n'a rien à faire ici (appels sans Origin, hors navigateur, tolérés).
  if (origin && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) {
    return reply(403, { error: "Origine non autorisée" }, origin);
  }
  if (!STRIPE_SECRET_KEY) return reply(500, { error: "Paiement non configuré" }, origin);

  let palierId = "";
  try {
    const body = await req.json();
    palierId = typeof body?.palier === "string" ? body.palier : "";
  } catch {
    return reply(400, { error: "Corps illisible" }, origin);
  }

  if ((await config("comptoir_actif")) !== "true") return reply(403, { error: "Le comptoir est fermé" }, origin);

  let paliers: Palier[] = [];
  try {
    paliers = JSON.parse((await config("comptoir_paliers")) ?? "[]");
  } catch {
    return reply(500, { error: "Paliers illisibles" }, origin);
  }
  const palier = paliers.find((p) => p.id === palierId);
  if (!palier || !Number.isInteger(palier.prix_cents) || palier.prix_cents <= 0 || !palier.nom) {
    return reply(400, { error: "Palier inconnu" }, origin);
  }

  // Stripe Tax en option (app_config stripe_tax = 'true') : les prix affichés sont TTC.
  const taxe = (await config("stripe_tax")) === "true";

  const form = new URLSearchParams({
    mode: "payment",
    ui_mode: "embedded_page",
    // Le merci s'affiche dans la page (onComplete) : pas de redirection, donc pas de moyens de paiement à redirection.
    // Stripe refuse return_url avec redirect_on_completion=never : on ne l'envoie pas.
    redirect_on_completion: "never",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(palier.prix_cents),
    "line_items[0][price_data][product_data][name]": palier.nom,
    "metadata[palier]": palier.id,
    "custom_fields[0][key]": "prenom",
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "true",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Ton prénom pour le carnet des copains (facultatif)",
    "custom_fields[0][text][maximum_length]": "30",
    locale: "fr",
  });

  if (taxe) {
    form.set("automatic_tax[enabled]", "true");
    form.set("line_items[0][price_data][tax_behavior]", "inclusive");
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_VERSION,
    },
    body: form,
  });
  const session = await res.json().catch(() => null);
  if (!res.ok || !session?.client_secret) {
    // Le détail reste dans les journaux de la fonction, jamais renvoyé au navigateur.
    console.error("Stripe a refusé la session", res.status, session?.error?.type, session?.error?.message);
    return reply(502, { error: "Paiement indisponible" }, origin);
  }
  return reply(200, { clientSecret: session.client_secret }, origin);
});
