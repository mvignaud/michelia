// Fonction « chat » : vérifie l'utilisateur et son quota, puis renvoie la réponse
// de Michel en flux de texte brut. Les clés restent dans les secrets Supabase.
// Les premières questions passent d'abord par un cache de réponses déjà écrites.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Modèle d'embeddings gratuit fourni par le runtime des Edge Functions Supabase.
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<number[]>;
    };
  };
};

const MAX_HISTORY = 20;
const MAX_CHARS = 4000;
// Seules les questions d'ouverture courtes et sans chiffres ni adresse vont dans le cache.
const CACHE_MAX_CHARS = 200;
// Séparateur avant les informations de fin de réponse, lu par l'appli.
const TRAILER = "\u001e";
const NAME_TAG = /<prenom>([^<]*)<\/prenom>/;
// Ajoutée après la première réponse quand Michel ne connaît pas encore le prénom
// (hors cache, pour que les réponses resservies restent anonymes).
const ASK_NAME = [
  "\n\nAu fait, c'est quoi ton petit nom ? Que je sache à qui je cause.",
  "\n\nEt toi, tu t'appelles comment ? J'aime bien savoir à qui je cause, hè.",
  "\n\nDis, tu me donnes ton prénom ? Ici dans la machine, tout le monde s'appelle « utilisateur », c'est triste à mourir.",
];
const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];
const askName = () => pick(ASK_NAME);

// Quota du jour atteint, sans compte : Michel pousse à l'inscription.
const GUEST_LIMIT = [
  "Oh, doucement ! Je cause pas plus que ça aux inconnus, moi. Inscris-toi dans le cloud (bouton « Connexion » en haut) : " +
    "promis, le patron sait même pas allumer l'ordinateur, il fera rien de tes données. Et après on cause tant que tu veux.",
  "Macarel, t'as vidé ma réserve du jour ! Crée-toi un compte, bouton « Connexion » en haut, et je te fais crédit. " +
    "Tes données, le chef y touche pas : il sait à peine se servir de la télécommande.",
  "Hé, je te connais même pas et tu me fais déjà trimer comme à la vendange ! Inscris-toi (bouton « Connexion »), " +
    "que je sache à qui j'ai affaire. Tes données restent au chaud, le patron y comprend rien de toute façon.",
];

// Quota de l'heure atteint : Michel demande une pause.
const GUEST_HOUR_LIMIT = [
  "Holà, tu mitrailles ! Laisse-moi souffler une heure. Ou inscris-toi (bouton « Connexion » en haut) : " +
    "promis, le patron fait rien de tes données, et moi je te laisserai causer bien plus.",
  "Boudu, cinq questions d'affilée, j'ai les fils qui fument ! Reviens dans une heure, ou crée-toi un compte " +
    "et je te fais un tarif d'ami.",
];
const MEMBER_HOUR_LIMIT = [
  "Oh, tu me chauffes la carafe, là ! Va boire un café, reviens dans une heure, je serai d'attaque.",
  "Macarel, pause syndicale ! J'ai besoin d'une heure pour refroidir les fusibles, après on reprend.",
];

// Quota du jour atteint, avec un compte : Michel rend son tablier jusqu'à demain.
const MEMBER_LIMIT = [
  "Oh, tu me chauffes la carafe, là ! Laisse-moi un peu tranquille et reviens demain me poser tes questions bêtes.",
  "Boudu, j'ai la tête comme une citrouille ! Assez causé pour aujourd'hui, va voir dehors si j'y suis et reviens demain.",
  "Macarel, même au comptoir on me fout la paix plus que ça ! Je ferme boutique, reviens demain, je serai requinqué.",
];

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

// Prénom affichable : lettres, espaces, tirets et apostrophes, 30 caractères au plus.
function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/[^\p{L}\s'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
  return name || undefined;
}

function cacheable(messages: ChatMessage[]): string | null {
  if (messages.length !== 1) return null;
  const question = messages[0].content.trim();
  if (question.length > CACHE_MAX_CHARS || /[0-9@]/.test(question)) return null;
  return question;
}

// Longueur de la fin du texte qui pourrait être le début de « <prenom> ».
function partialTag(text: string): number {
  for (let n = Math.min(7, text.length); n > 0; n--) {
    if ("<prenom>".startsWith(text.slice(-n))) return n;
  }
  return 0;
}

let embedder: InstanceType<typeof Supabase.ai.Session> | null = null;

async function embed(text: string): Promise<number[] | null> {
  try {
    embedder ??= new Supabase.ai.Session("gte-small");
    return await embedder.run(text.toLowerCase(), { mean_pool: true, normalize: true });
  } catch (e) {
    console.error("embeddings", e);
    return null;
  }
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
  let name: string | undefined;
  try {
    const body = await req.json();
    messages = parseMessages(body);
    name = cleanName((body as { name?: unknown })?.name);
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

  // Quota du jour : plus large pour les membres inscrits que pour les visiteurs anonymes.
  const guest = auth.user.is_anonymous ?? true;
  const limit = guest
    ? Number(config.daily_limit_guest ?? config.daily_limit ?? 20)
    : Number(config.daily_limit_member ?? 200);
  const hourLimit = guest
    ? Number(config.hourly_limit_guest ?? 5)
    : Number(config.hourly_limit_member ?? 30);
  const { data: quota, error: quotaError } = await admin.rpc("consume_message", {
    p_user: auth.user.id,
    p_limit: limit,
    p_global_limit: Number(config.global_daily_limit ?? 5000),
    p_hour_limit: hourLimit,
  });
  if (quotaError) {
    console.error("quota", quotaError);
    return reply(500, "Michel est parti chercher du pain, réessaie dans un moment.", origin);
  }
  if (quota === "hour_limit") {
    return reply(429, pick(guest ? GUEST_HOUR_LIMIT : MEMBER_HOUR_LIMIT), origin);
  }
  if (quota === "user_limit") {
    return reply(
      429,
      pick(guest ? GUEST_LIMIT : MEMBER_LIMIT),
      origin,
    );
  }
  if (quota === "global_limit") {
    console.warn("quota: plafond global du jour atteint");
    return reply(
      429,
      "Macarel, tout le Gers m'a posé des questions aujourd'hui, je suis rincé. Reviens demain !",
      origin,
    );
  }

  const headers = {
    ...corsHeaders(origin),
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  };

  // Question d'ouverture : on ressert une réponse déjà écrite si la base en a assez de proches.
  const question = config.cache_enabled === "false" ? null : cacheable(messages);
  const embedding = question ? await embed(question) : null;
  if (embedding) {
    const { data: cached, error } = await admin.rpc("pick_cached_answer", {
      p_embedding: embedding,
      p_threshold: Number(config.cache_threshold ?? 0.94),
      p_min_variants: Number(config.cache_variants ?? 3),
    });
    if (error) console.error("cache", error);
    else if (typeof cached === "string" && cached) {
      return new Response(cached + (name ? "" : askName()), { headers });
    }
  }

  const today = new Date().toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const context = [
    `Nous sommes le ${today}. Tu n'as pas accès à internet ni à la météo en direct.`,
    embedding
      ? "Ta réponse pourra être resservie à d'autres personnes : n'utilise aucun prénom."
      : name
        ? `La personne s'appelle ${name}. Appelle-la par son prénom de temps en temps, sans en abuser.`
        : messages.length === 1
          ? "Réponds directement à la question. Ne demande pas le prénom : la question est ajoutée après ta réponse."
          : messages.length === 3 || messages.length === 9
            ? "Tu as demandé son prénom à la personne et elle ne l'a pas donné : glisse une pique " +
              "d'humour là-dessus en une phrase (au début ou à la fin), puis réponds normalement."
            : "Tu ne connais pas le prénom de la personne : n'en parle pas.",
    "Quand la personne te donne son prénom ou te demande de l'appeler autrement, termine ta " +
      "réponse par la balise <prenom>Prénom</prenom>, sans rien après. N'utilise jamais cette balise autrement.",
  ].join("\n");

  const stream = anthropic.messages.stream({
    model: config.model ?? "claude-haiku-5-5",
    max_tokens: Number(config.max_output_tokens ?? 2048),
    output_config: { effort: "low" },
    system: [
      { type: "text", text: config.system_prompt, cache_control: { type: "ephemeral" } },
      { type: "text", text: context },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Le texte part au fil de l'eau, sauf ce qui pourrait être le début de la balise <prenom>.
      let pending = "";
      let held = false;
      let answer = "";
      let complete = false;
      const flush = (text: string) => {
        if (!text) return;
        answer += text;
        controller.enqueue(encoder.encode(text));
      };
      try {
        for await (const event of stream) {
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          pending += event.delta.text;
          if (held) continue;
          const tag = pending.indexOf("<prenom>");
          if (tag !== -1) {
            flush(pending.slice(0, tag));
            pending = pending.slice(tag);
            held = true;
            continue;
          }
          const keep = partialTag(pending);
          flush(pending.slice(0, pending.length - keep));
          pending = pending.slice(pending.length - keep);
        }
        const learned = cleanName(pending.match(NAME_TAG)?.[1]);
        flush(pending.replace(NAME_TAG, "").trimEnd());

        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nOh con, là je peux pas t'aider. Demande-moi autre chose."));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("…\n\nBoudu, j'ai trop causé, j'ai plus de souffle. Dis-moi « la suite » et je continue."));
        } else {
          complete = !learned;
          if (!name && !learned && messages.length === 1) {
            controller.enqueue(encoder.encode(askName()));
          }
        }
        if (learned) controller.enqueue(encoder.encode(TRAILER + JSON.stringify({ prenom: learned })));
      } catch (e) {
        console.error("anthropic", e);
        controller.enqueue(encoder.encode("\n\nMacarel, la machine a fait des siennes. Réessaie."));
      } finally {
        controller.close();
      }

      if (embedding && complete && answer.trim()) {
        const { error } = await admin.from("response_cache").insert({
          question,
          embedding,
          answer: answer.trim(),
        });
        if (error) console.error("cache: enregistrement", error);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, { headers });
});
