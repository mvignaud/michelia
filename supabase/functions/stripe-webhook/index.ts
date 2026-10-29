// Fonction « stripe-webhook » : enregistre les pourboires du comptoir (voir docs/COMPTOIR.md).
// Stripe appelle cette adresse à chaque paiement (checkout.session.completed, et
// checkout.session.async_payment_succeeded pour un paiement différé comme le prélèvement SEPA).
// La signature Stripe-Signature est vérifiée avec STRIPE_WEBHOOK_SECRET, sans SDK Stripe :
// HMAC-SHA256 de « {t}.{corps brut} », comparé en temps constant, à 5 minutes près.
// L'enregistrement est idempotent (une ligne par session de paiement) : Stripe peut rappeler.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const TOLERANCE_SECONDS = 300;

const reply = (status: number, body: string) => new Response(body, { status });

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Comparaison en temps constant de deux chaînes hexadécimales.
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSignature(body: string, header: string): Promise<boolean> {
  if (!WEBHOOK_SECRET || !header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=");
    if (key === "t") timestamp = value ?? "";
    if (key === "v1" && value) signatures.push(value);
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > TOLERANCE_SECONDS || !signatures.length) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  // Pas de court-circuit : toutes les signatures sont comparées.
  return signatures.map((s) => sameHex(s, expected)).includes(true);
}

// Prénom facultatif du carnet : lettres, espaces, tiret et apostrophe seulement, 30 caractères au plus.
function cleanFirstName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[^\p{L}\p{M} '’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .trim();
  return name || null;
}

type Palier = { id: string; prix_cents: number };

async function findPalier(amount: number, metadata: Record<string, string> | null): Promise<string> {
  const { data } = await admin.from("app_config").select("value").eq("key", "comptoir_paliers").maybeSingle();
  let paliers: Palier[] = [];
  try {
    paliers = JSON.parse(data?.value ?? "[]");
  } catch {
    // JSON mal rempli : on retombe sur « autre ».
  }
  // D'abord le palier choisi sur la page (metadata.palier), puis, à défaut, le montant payé.
  const fromMetadata = metadata?.palier;
  if (fromMetadata && paliers.some((p) => p.id === fromMetadata)) return fromMetadata;
  const byAmount = paliers.find((p) => p.prix_cents === amount);
  if (byAmount) return byAmount.id;
  return "autre";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, "Méthode non permise");

  const body = await req.text();
  if (!(await validSignature(body, req.headers.get("stripe-signature") ?? ""))) {
    return reply(400, "Signature invalide");
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return reply(400, "Corps illisible");
  }

  // Les autres événements sont accusés réception sans rien faire.
  const handled = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (!handled.includes(event.type)) return reply(200, "ok");
  const session = event.data?.object;
  if (!session?.id || session.payment_status !== "paid") return reply(200, "ok");

  const amount = Number(session.amount_total);
  if (!Number.isInteger(amount) || amount <= 0) return reply(200, "ok");

  const fields: { key?: string; text?: { value?: string } }[] = session.custom_fields ?? [];
  const prenom = cleanFirstName(fields.find((f) => f.key === "prenom")?.text?.value);

  const { error } = await admin.from("pourboires").upsert(
    {
      stripe_session_id: String(session.id),
      montant_cents: amount,
      devise: String(session.currency ?? "eur").toLowerCase().slice(0, 3),
      palier: await findPalier(amount, session.metadata ?? null),
      prenom,
    },
    { onConflict: "stripe_session_id", ignoreDuplicates: true },
  );
  // Une erreur de base fait rappeler Stripe plus tard, sans perdre le pourboire.
  if (error) return reply(500, "Enregistrement impossible");
  return reply(200, "ok");
});
