// Fonction « eko-webhook » : les webhooks du module Abonnements d'E-KO (MichelIA+ : période facturée,
// payée, ratée, relances épuisées, résiliation). Voir docs/MICHELIA-PLUS.md, section « E-KO ».
// Chaque envoi est signé (X-Subscriptions-Signature : sha256=<HMAC-SHA256 du corps brut>) avec le secret
// de l'endpoint créé dans E-KO (Sales → Webhooks), posé dans les secrets des Edge Functions sous
// EKO_WEBHOOK_SECRET (deux secrets séparés par une virgule pendant un changement de secret).
// L'envoi est gardé (eko_evenements, un seul par X-Subscriptions-Delivery-Id), acquitté tout de suite,
// puis traité ; un traitement raté est repris par le cron de michelia-plus-echeances.
import { admin } from "../_shared/stancer.ts";
import { traiterEvenement } from "../_shared/abonnement-eko.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SECRETS = (Deno.env.get("EKO_WEBHOOK_SECRET") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const reply = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), { status, headers: { "Content-Type": "application/json" } });

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// Comparaison à temps constant.
function memes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureOk(corps: Uint8Array, recue: string): Promise<boolean> {
  if (!recue.startsWith("sha256=")) return false;
  const attendues = await Promise.all(SECRETS.map(async (secret) => {
    const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return "sha256=" + hex(await crypto.subtle.sign("HMAC", cle, corps));
  }));
  return attendues.map((a) => memes(a, recue.toLowerCase())).includes(true);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, "Méthode non permise");
  if (!SECRETS.length) {
    console.error("E-KO : ALERTE secret EKO_WEBHOOK_SECRET manquant, webhooks refusés");
    return reply(503, "Non configuré");
  }
  const corps = new Uint8Array(await req.arrayBuffer());
  // La signature d'abord, avant de lire le JSON.
  if (!(await signatureOk(corps, req.headers.get("x-subscriptions-signature") ?? ""))) return reply(401, "Signature invalide");

  // deno-lint-ignore no-explicit-any
  let charge: any;
  try {
    charge = JSON.parse(new TextDecoder().decode(corps));
  } catch {
    return reply(400, "Corps illisible");
  }
  const livraison = Number(req.headers.get("x-subscriptions-delivery-id"));
  const evenement = String(req.headers.get("x-subscriptions-event") ?? charge?.event ?? "").slice(0, 64);
  if (!Number.isSafeInteger(livraison) || livraison <= 0 || !evenement) return reply(400, "Envoi incomplet");
  const code = charge?.data?.subscription?.code;

  const { error } = await admin.from("eko_evenements").upsert({
    livraison,
    evenement,
    abonnement: typeof code === "string" ? code.slice(0, 64) : null,
    charge,
  }, { onConflict: "livraison", ignoreDuplicates: true });
  if (error) {
    // Pas gardé : E-KO renverra (1 min, 5 min, 30 min).
    console.error("E-KO : webhook non gardé", livraison, error.message);
    return reply(500, "À renvoyer");
  }
  EdgeRuntime.waitUntil(traiterEvenement(livraison).catch((e) => console.error("E-KO : webhook non traité", livraison, e instanceof Error ? e.message : e)));
  return reply(200, "ok");
});
