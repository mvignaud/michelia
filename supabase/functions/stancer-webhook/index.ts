// Fonction « stancer-webhook » : enregistre les pourboires du comptoir payés avec Stancer, quand
// Stancer prévient (voir docs/COMPTOIR.md). Filet de sécurité de la confirmation faite par la page :
// si le visiteur ferme l'onglet juste après avoir payé, le pourboire est quand même enregistré.
// La signature Stancer-Signature (« t=…,v1=… ») est vérifiée avec le secret rangé en base par
// comptoir-paiement à l'enregistrement du webhook (ou STANCER_WEBHOOK_SECRET s'il est posé) :
// HMAC-SHA256 de « {t}.{corps brut} », comparé en temps constant, à 5 minutes près. Le corps ne sert
// qu'à trouver le payment intent : le paiement est toujours relu chez Stancer (_shared/stancer.ts).
import { confirmPayment, isPaymentIntentId, webhookSecrets } from "../_shared/stancer.ts";

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

async function hmac(key: Uint8Array<ArrayBuffer>, payload: string): Promise<string> {
  const cle = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(payload)));
}

// Les clés HMAC d'un secret : la doc Stancer le décode en hexadécimal ; s'il n'en est pas, ses octets tels quels.
function keysOf(secret: string): Uint8Array<ArrayBuffer>[] {
  const keys: Uint8Array<ArrayBuffer>[] = [new TextEncoder().encode(secret)];
  if (/^([0-9a-f]{2})+$/i.test(secret)) keys.unshift(new Uint8Array(secret.match(/../g)!.map((h) => parseInt(h, 16))));
  return keys;
}

async function validSignature(body: string, header: string): Promise<boolean> {
  if (!header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=");
    if (key === "t") timestamp = value ?? "";
    if (key === "v1" && value) signatures.push(value.toLowerCase());
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > TOLERANCE_SECONDS || !signatures.length) return false;

  const keys = (await webhookSecrets()).flatMap(keysOf);
  if (!keys.length) return false;
  const payload = `${timestamp}.${body}`;
  const expected = await Promise.all(keys.map((k) => hmac(k, payload)));
  // Pas de court-circuit : toutes les signatures sont comparées.
  return signatures.flatMap((s) => expected.map((e) => sameHex(s, e))).includes(true);
}

// Le payment intent concerné, quelle que soit la forme de l'objet (payment_intent.* ou payment.*).
// deno-lint-ignore no-explicit-any
function intentOf(data: any): string | null {
  const candidates = [data?.id, data?.payment_intent, data?.payment_intent?.id, data?.object?.id, data?.object?.payment_intent];
  return candidates.find(isPaymentIntentId) ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, "Méthode non permise");

  const body = await req.text();
  if (!(await validSignature(body, req.headers.get("stancer-signature") ?? ""))) {
    return reply(400, "Signature invalide");
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return reply(400, "Corps illisible");
  }

  // Seuls les paiements nous intéressent ; le reste est accusé réception sans rien faire.
  const type = String(event?.type ?? "");
  if (!type.startsWith("payment_intent.") && !type.startsWith("payment.")) return reply(200, "ok");
  const intent = intentOf(event?.data);
  if (!intent) return reply(200, "ok");

  const result = await confirmPayment(intent);
  // Un souci passager (Stancer ou la base) : Stancer rappellera plus tard.
  if (result.etat === "attente" && type.endsWith(".succeeded")) return reply(500, "À rappeler");
  return reply(200, "ok");
});
