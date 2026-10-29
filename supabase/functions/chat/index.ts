// Fonction « chat » : vérifie l'utilisateur et son quota, puis renvoie la réponse
// de Michel en flux de texte brut. Les clés restent dans les secrets Supabase.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_HISTORY = 20;
const MAX_CHARS = 4000;

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
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

function reply(status: number, text: string, origin: string | null): Response {
  return new Response(text, {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Garde un historique propre : rôles alternés, se terminant par l'utilisateur.
function parseMessages(body: unknown): ChatMessage[] | null {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages = raw.slice(-MAX_HISTORY);
  while (messages.length && messages[0]?.role !== "user") messages.shift();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (m?.role !== expected || typeof m.content !== "string") return null;
    if (!m.content.trim() || m.content.length > MAX_CHARS) return null;
  }
  if (messages.length === 0 || messages.length % 2 === 0) return null;
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

async function loadConfig(): Promise<Record<string, string>> {
  const { data, error } = await admin.from("app_config").select("key, value");
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.key, row.value]));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, "Méthode non autorisée.", origin);

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return reply(401, "Session manquante, recharge la page.", origin);

  let messages: ChatMessage[] | null = null;
  try {
    messages = parseMessages(await req.json());
  } catch {
    // corps illisible : traité comme invalide juste en dessous
  }
  if (!messages) return reply(400, "Message invalide ou trop long.", origin);

  let config: Record<string, string>;
  try {
    config = await loadConfig();
  } catch (e) {
    console.error("config", e);
    return reply(500, "Michel est parti chercher du pain, réessaie dans un moment.", origin);
  }
  if (!config.system_prompt) {
    console.error("config: system_prompt manquant dans app_config");
    return reply(500, "Michel n'est pas encore installé dans la machine.", origin);
  }

  const limit = Number(config.daily_limit ?? 30);
  const { data: used, error: quotaError } = await admin.rpc("consume_message", {
    p_user: auth.user.id,
    p_limit: limit,
  });
  if (quotaError) {
    console.error("quota", quotaError);
    return reply(500, "Michel est parti chercher du pain, réessaie dans un moment.", origin);
  }
  if (used === null) {
    return reply(
      429,
      `Boudu, ${limit} questions aujourd'hui, tu m'as vidé ! Reviens demain, je serai requinqué.`,
      origin,
    );
  }

  const today = new Date().toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const stream = anthropic.messages.stream({
    model: config.model ?? "claude-haiku-5-5",
    max_tokens: Number(config.max_output_tokens ?? 1024),
    output_config: { effort: "low" },
    system: [
      { type: "text", text: config.system_prompt, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Nous sommes le ${today}. Tu n'as pas accès à internet ni à la météo en direct.` },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nOh con, là je peux pas t'aider. Demande-moi autre chose."));
        }
      } catch (e) {
        console.error("anthropic", e);
        controller.enqueue(encoder.encode("\n\nMacarel, la machine a fait des siennes. Réessaie."));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
