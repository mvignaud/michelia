// Fonction « push » : envoie les notifications sur les applis (via Expo, qui relaie vers
// Apple et Google) et sur le site (Web Push, signé avec les clés VAPID).
//
// - POST sans corps : envoie les annonces du back-office en attente (table broadcasts).
//   N'importe quel utilisateur connecté peut la déclencher : seules partent les annonces
//   que l'admin a mises en attente.
// - POST { title, body, url?, audience? | user_ids? } avec la clé service_role : envoi libre,
//   réutilisable par d'autres fonctions ou scripts (la fonction « dicton » s'en sert, audience « daily »).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

type Platform = "ios" | "android" | "web";
type Target = { platform: Platform; token: string; keys: { p256dh: string; auth: string } | null };
type Message = { title: string; body: string; url?: string };
type Result = { sent: number; failed: number; expired: string[] };

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, {
  auth: { persistSession: false },
});

const VAPID = {
  subject: Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@michel.beer",
  publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
  privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
};
// Facultatif : seulement si la « sécurité renforcée des push » est activée sur expo.dev.
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN");

// Même garde-fou que dans la base : on n'écrit qu'aux services push des navigateurs.
const WEB_PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)\//;

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

function json(status: number, data: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Les notifications restent courtes : l'écran de verrouillage coupe de toute façon.
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
};

async function sendExpo(targets: Target[], message: Message): Promise<Result> {
  const result: Result = { sent: 0, failed: 0, expired: [] };
  // Expo accepte 100 notifications par requête.
  for (let i = 0; i < targets.length; i += 100) {
    const chunk = targets.slice(i, i + 100);
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(
          chunk.map((t) => ({
            to: t.token,
            title: message.title,
            body: message.body,
            data: message.url ? { url: message.url } : {},
            sound: "default",
            channelId: "default",
          })),
        ),
      });
      if (!response.ok) throw new Error(`Expo ${response.status} ${await response.text()}`);
      const { data } = (await response.json()) as {
        data: { status: "ok" | "error"; details?: { error?: string } }[];
      };
      data.forEach((ticket, j) => {
        if (ticket.status === "ok") {
          result.sent++;
        } else {
          result.failed++;
          if (ticket.details?.error === "DeviceNotRegistered") result.expired.push(chunk[j].token);
        }
      });
    } catch (e) {
      console.error("envoi Expo", e);
      result.failed += chunk.length;
    }
  }
  return result;
}

async function sendWeb(targets: Target[], message: Message): Promise<Result> {
  const result: Result = { sent: 0, failed: 0, expired: [] };
  if (!VAPID.publicKey || !VAPID.privateKey) {
    console.error("clés VAPID absentes : notifications web non envoyées");
    result.failed = targets.length;
    return result;
  }
  const payload = JSON.stringify(message);
  const one = async (t: Target) => {
    if (!t.keys || !WEB_PUSH_HOST.test(t.token)) {
      result.failed++;
      return;
    }
    try {
      // web-push chiffre et signe ; l'envoi passe par fetch, plus sûr dans Deno que son client https.
      const request = webpush.generateRequestDetails({ endpoint: t.token, keys: t.keys }, payload, {
        TTL: 60 * 60 * 24,
        vapidDetails: VAPID,
      });
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      await response.body?.cancel();
      if (response.ok) {
        result.sent++;
      } else {
        result.failed++;
        // 404 / 410 : le navigateur a retiré l'abonnement.
        if (response.status === 404 || response.status === 410) result.expired.push(t.token);
      }
    } catch (e) {
      console.error("envoi web", e);
      result.failed++;
    }
  };
  // Vingt envois à la fois.
  for (let i = 0; i < targets.length; i += 20) {
    await Promise.all(targets.slice(i, i + 20).map(one));
  }
  return result;
}

// Envoi vers une liste d'appareils ; les abonnements morts sont supprimés au passage.
async function sendPush(targets: Target[], message: Message): Promise<Result> {
  const clean: Message = {
    title: clip(message.title, 60) || "MichelIA",
    body: clip(message.body, 180),
    ...(message.url ? { url: message.url } : {}),
  };
  const [native, web] = await Promise.all([
    sendExpo(targets.filter((t) => t.platform !== "web"), clean),
    sendWeb(targets.filter((t) => t.platform === "web"), clean),
  ]);
  const expired = [...native.expired, ...web.expired];
  if (expired.length) {
    const { error } = await admin.from("push_subscriptions").delete().in("token", expired);
    if (error) console.error("nettoyage des abonnements", error);
  }
  return { sent: native.sent + web.sent, failed: native.failed + web.failed, expired };
}

async function targetsFor(audience: string): Promise<Target[]> {
  const { data, error } = await admin.rpc("push_targets", { p_audience: audience });
  if (error) throw error;
  return data as Target[];
}

async function targetsForUsers(userIds: string[]): Promise<Target[]> {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("platform, token, keys")
    .in("user_id", userIds);
  if (error) throw error;
  return data as Target[];
}

// Annonces du back-office : réservées d'abord, puis envoyées une par une.
async function sendBroadcasts() {
  const { data, error } = await admin.rpc("claim_push_broadcasts");
  if (error) throw error;
  const report = [];
  for (const b of data as { id: number; subject: string; body: string; audience: string }[]) {
    try {
      const result = await sendPush(await targetsFor(b.audience), { title: b.subject, body: b.body });
      const status = result.sent > 0 || result.failed === 0 ? "envoye" : "echec";
      await admin.from("broadcasts").update({ push_status: status, push_sent: result.sent }).eq("id", b.id);
      report.push({ id: b.id, status, ...result, expired: result.expired.length });
    } catch (e) {
      console.error("annonce", b.id, e);
      await admin.from("broadcasts").update({ push_status: "echec", push_sent: 0 }).eq("id", b.id);
      report.push({ id: b.id, status: "echec" });
    }
  }
  return report;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "POST seulement" }, origin);

  const input = await req.json().catch(() => ({})) as {
    title?: unknown;
    body?: unknown;
    url?: unknown;
    audience?: unknown;
    user_ids?: unknown;
  };

  try {
    if (input.title === undefined && input.body === undefined) {
      return json(200, { broadcasts: await sendBroadcasts() }, origin);
    }

    // Envoi libre : réservé au serveur (clé service_role).
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer !== SERVICE_KEY) return json(403, { error: "clé service_role requise" }, origin);
    if (typeof input.title !== "string" || typeof input.body !== "string" || !input.body.trim()) {
      return json(400, { error: "title et body requis" }, origin);
    }
    const url = typeof input.url === "string" && /^https:\/\//.test(input.url) ? input.url : undefined;
    let targets: Target[];
    if (Array.isArray(input.user_ids)) {
      targets = await targetsForUsers(input.user_ids.filter((id): id is string => typeof id === "string"));
    } else if (input.audience === "service" || input.audience === "news" || input.audience === "daily") {
      targets = await targetsFor(input.audience);
    } else {
      return json(400, { error: "audience ('service', 'news' ou 'daily') ou user_ids requis" }, origin);
    }
    const result = await sendPush(targets, { title: input.title, body: input.body, url });
    return json(200, { ...result, expired: result.expired.length }, origin);
  } catch (e) {
    console.error(e);
    return json(500, { error: "envoi impossible" }, origin);
  }
});
