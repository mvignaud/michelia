// Fonction « chat » : vérifie l'utilisateur et son quota, puis renvoie la réponse
// de Michel en flux de texte brut. Les clés restent dans les secrets Supabase.
// Les premières questions passent d'abord par un cache de réponses déjà écrites.
// Michel peut consulter la météo (Open-Meteo) et l'actualité (Google Actualités),
// deux services gratuits et sans clé.
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
// Questions sur la météo ou l'actualité : jamais servies depuis le cache, la réponse change chaque jour.
const FRESH = /m[ée]t[ée]o|temps|pleu|pluie|soleil|neige|orage|chaud|froid|actu|nouvelles|news|info|aujourd|demain|ce soir|week-end|match|score|résultat/i;
// Séparateur avant les informations de fin de réponse, lu par l'appli.
const TRAILER = "\u001e";
const NAME_TAG = /<prenom>([^<]*)<\/prenom>/;
// Identifiant de mode thématique choisi dans l'appli (cuisine, rugby…). Sa consigne vit
// dans app_config sous la clé mode_<id> ; un mode sans consigne est ignoré.
const MODE_ID = /^[a-z]{1,20}$/;
// Ajoutée après la première réponse quand Michel ne connaît pas encore le prénom
// (hors cache, pour que les réponses resservies restent anonymes).
const ASK_NAME = [
  "\n\nAu fait, c'est quoi ton petit nom ? Que je sache à qui je cause.",
  "\n\nEt toi, tu t'appelles comment ? J'aime bien savoir à qui je cause, hè.",
  "\n\nDis, tu me donnes ton prénom ? Ici dans la machine, tout le monde s'appelle « utilisateur », c'est triste à mourir.",
];
// Rappel de personnage par défaut, ajouté au contexte de chaque message.
const PERSONA_REMINDER =
  "Rappel : tu es Michel jusqu'au bout. Pas de formule d'assistant, pas d'excuse, pas de « ça dépend » : " +
  "un avis tranché, au moins deux expressions du Sud-Ouest, une vraie réponse et une chute. " +
  "Seule exception : les moments sérieux, où tu ranges les blagues.";
// Outils : au plus trois allers-retours par message, et des sources qui répondent vite.
const MAX_TOOL_ROUNDS = 3;
const TOOL_TIMEOUT_MS = 5000;
const MAX_NEWS = 8;
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "meteo",
    description:
      "Météo actuelle et prévisions jour par jour pour un lieu (ville, village, pays). " +
      "À utiliser dès qu'on te parle du temps qu'il fait ou qu'il va faire. Sans lieu précisé, prends Auch.",
    input_schema: {
      type: "object",
      properties: {
        lieu: { type: "string", description: "Nom du lieu, par exemple « Auch » ou « Condom, Gers »." },
        jours: { type: "integer", minimum: 1, maximum: 7, description: "Nombre de jours de prévision (3 par défaut)." },
      },
      required: ["lieu"],
    },
  },
  {
    name: "actualites",
    description:
      "Derniers titres de l'actualité en français (Google Actualités), avec leur source et leur date. " +
      "À utiliser pour toute question sur l'actualité, un événement récent, un résultat sportif ou une " +
      "personnalité dont il faut des nouvelles fraîches. Sans sujet, renvoie la une.",
    input_schema: {
      type: "object",
      properties: {
        sujet: { type: "string", description: "Mots-clés à chercher, par exemple « Stade Toulousain » ou « Gers »." },
      },
    },
  },
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
  if (question.length > CACHE_MAX_CHARS || /[0-9@]/.test(question) || FRESH.test(question)) return null;
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

// Jetons d'une réponse, cumulés sur tous les allers-retours avec les outils.
type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

function addUsage(total: Tokens, usage: Anthropic.Messages.Usage) {
  total.input += usage.input_tokens;
  total.output += usage.output_tokens;
  total.cacheRead += usage.cache_read_input_tokens ?? 0;
  total.cacheWrite += usage.cache_creation_input_tokens ?? 0;
}

// Coût Claude indicatif du back-office : jetons de chaque réponse, par compte et par jour.
async function recordTokens(userId: string, tokens: Tokens) {
  const { error } = await admin.rpc("record_tokens", {
    p_user: userId,
    p_input: tokens.input,
    p_output: tokens.output,
    p_cache_read: tokens.cacheRead,
    p_cache_write: tokens.cacheWrite,
  });
  if (error) console.error("jetons: enregistrement", error);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as T;
}

type Place = { name: string; latitude: number; longitude: number; country?: string; admin1?: string; admin2?: string };
type Forecast = {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: (number | null)[];
    wind_speed_10m_max: number[];
  };
};

// Codes météo de l'OMM utilisés par Open-Meteo.
const WEATHER_CODES: Record<number, string> = {
  0: "grand soleil", 1: "plutôt dégagé", 2: "quelques nuages", 3: "couvert",
  45: "brouillard", 48: "brouillard givrant",
  51: "bruine légère", 53: "bruine", 55: "bruine forte", 56: "bruine verglaçante", 57: "bruine verglaçante forte",
  61: "pluie faible", 63: "pluie", 65: "grosse pluie", 66: "pluie verglaçante", 67: "pluie verglaçante forte",
  71: "neige faible", 73: "neige", 75: "grosse neige", 77: "grains de neige",
  80: "averses", 81: "averses fortes", 82: "averses violentes", 85: "averses de neige", 86: "grosses averses de neige",
  95: "orage", 96: "orage avec grêle", 99: "gros orage avec grêle",
};
const sky = (code: number) => WEATHER_CODES[code] ?? "temps indéterminé";

async function weather(input: { lieu?: unknown; jours?: unknown }): Promise<string> {
  const place = typeof input.lieu === "string" && input.lieu.trim() ? input.lieu.trim().slice(0, 100) : "Auch";
  const days = Math.min(7, Math.max(1, Math.round(Number(input.jours) || 3)));
  // « Condom, Gers » : on cherche la ville, puis on préfère le résultat qui cite le reste.
  const [city, ...rest] = place.split(",").map((part) => part.trim());
  const hint = rest.join(" ").toLowerCase();
  const geo = await fetchJson<{ results?: Place[] }>(
    "https://geocoding-api.open-meteo.com/v1/search?count=10&language=fr&format=json&name=" +
      encodeURIComponent(city),
  );
  const results = geo.results ?? [];
  const found = (hint &&
    results.find((r) => [r.admin1, r.admin2, r.country].some((v) => v?.toLowerCase().includes(hint)))) ||
    results[0];
  if (!found) return `Lieu introuvable : « ${place} ».`;

  const params = new URLSearchParams({
    latitude: String(found.latitude),
    longitude: String(found.longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum," +
      "precipitation_probability_max,wind_speed_10m_max",
    timezone: "auto",
    forecast_days: String(days),
  });
  const data = await fetchJson<Forecast>(`https://api.open-meteo.com/v1/forecast?${params}`);
  const name = [found.name, found.admin2 ?? found.admin1, found.country].filter(Boolean).join(", ");
  const now = data.current;
  const lines = [
    `Météo à ${name} (heure locale ${now.time.replace("T", " ")}) :`,
    `Maintenant : ${sky(now.weather_code)}, ${Math.round(now.temperature_2m)} °C ` +
      `(ressenti ${Math.round(now.apparent_temperature)} °C), vent ${Math.round(now.wind_speed_10m)} km/h, ` +
      `pluie ${now.precipitation} mm.`,
  ];
  const daily = data.daily;
  daily.time.forEach((date: string, i: number) => {
    const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    });
    lines.push(
      `${day} : ${sky(daily.weather_code[i])}, ${Math.round(daily.temperature_2m_min[i])} à ` +
        `${Math.round(daily.temperature_2m_max[i])} °C, pluie ${daily.precipitation_sum[i]} mm` +
        (daily.precipitation_probability_max[i] == null ? "" : ` (risque ${daily.precipitation_probability_max[i]} %)`) +
        `, vent jusqu'à ` +
        `${Math.round(daily.wind_speed_10m_max[i])} km/h.`,
    );
  });
  return lines.join("\n");
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function xmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, code: string) =>
      code[0] === "#"
        ? String.fromCodePoint(parseInt(code.slice(code[1] === "x" ? 2 : 1), code[1] === "x" ? 16 : 10))
        : XML_ENTITIES[code] ?? all)
    .trim();
}

const xmlTag = (item: string, tag: string) =>
  xmlText(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");

async function news(input: { sujet?: unknown }): Promise<string> {
  const topic = typeof input.sujet === "string" ? input.sujet.trim().slice(0, 100) : "";
  const url = topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=fr&gl=FR&ceid=FR:fr`
    : "https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr";
  const res = await fetch(url, { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.text()).match(/<item>[\s\S]*?<\/item>/g) ?? [];
  if (!items.length) return topic ? `Aucun article trouvé sur « ${topic} ».` : "Aucun titre disponible.";
  const lines = items.slice(0, MAX_NEWS).map((item) => {
    const source = xmlTag(item, "source");
    // Google ajoute « - Source » à la fin du titre : on l'enlève, la source est donnée à part.
    let title = xmlTag(item, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
    const date = new Date(xmlTag(item, "pubDate"));
    const when = isNaN(date.getTime())
      ? ""
      : date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
    const meta = [source, when].filter(Boolean).join(", ");
    return `- ${title}${meta ? ` (${meta})` : ""}`;
  });
  return `${topic ? `Actualités sur « ${topic} »` : "À la une"} :\n${lines.join("\n")}`;
}

// Exécute un outil demandé par Claude ; une panne devient un message d'erreur pour Michel.
async function runTool(block: Anthropic.Messages.ToolUseBlock): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = (block.input ?? {}) as Record<string, unknown>;
  try {
    const content = block.name === "meteo"
      ? await weather(input)
      : block.name === "actualites"
        ? await news(input)
        : `Outil inconnu : ${block.name}.`;
    return { type: "tool_result", tool_use_id: block.id, content };
  } catch (e) {
    console.error(`outil ${block.name}`, e);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: "Le service ne répond pas pour l'instant.",
      is_error: true,
    };
  }
}

// Laisse finir une écriture après la fin de la réponse, sans la faire attendre.
function keepAlive(task: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, "Méthode non autorisée.", origin);

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return reply(401, "Session manquante, recharge la page.", origin);
  const userId = auth.user.id;

  let messages: ChatMessage[] | null = null;
  let name: string | undefined;
  let mode: string | undefined;
  try {
    const body = await req.json();
    messages = parseMessages(body);
    name = cleanName((body as { name?: unknown })?.name);
    const rawMode = (body as { mode?: unknown })?.mode;
    if (typeof rawMode === "string" && MODE_ID.test(rawMode)) mode = rawMode;
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

  const modeText = mode ? config[`mode_${mode}`]?.trim() : undefined;

  // Question d'ouverture : on ressert une réponse déjà écrite si la base en a assez de proches.
  // Pas en mode thématique : la réponse dépend du mode, elle ne vaut pas pour tout le monde.
  const question = config.cache_enabled === "false" || modeText ? null : cacheable(messages);
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
  // Interrupteur des outils dans app_config (tools_enabled = false pour les couper).
  const tools = config.tools_enabled === "false" ? undefined : TOOLS;
  const context = [
    `Nous sommes le ${today}.`,
    tools
      ? "Tu as deux outils : « meteo » pour le temps qu'il fait et « actualites » pour les nouvelles fraîches. " +
        "Sers-t'en dès que la question le demande au lieu d'inventer, puis donne ton avis de Gersois sur ce que " +
        "tu trouves, sans lister de liens. Pour le reste, tu n'as pas internet."
      : "Tu n'as pas accès à internet ni à la météo en direct.",
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
    // Rappel de personnage relu à chaque message, pour que Michel ne s'affadisse pas
    // au fil de la conversation. Réglable dans app_config (persona_reminder, vide = aucun).
    config.persona_reminder ?? PERSONA_REMINDER,
    modeText,
  ].filter(Boolean).join("\n");

  // La conversation s'allonge des appels d'outils et de leurs résultats au fil des allers-retours.
  const convo: Anthropic.Messages.MessageParam[] = [...messages];
  const ask = (withTools: boolean) =>
    anthropic.messages.stream({
      model: config.model ?? "claude-haiku-5-5",
      max_tokens: Number(config.max_output_tokens ?? 2048),
      output_config: { effort: "low" },
      ...(tools ? { tools, tool_choice: withTools ? { type: "auto" as const } : { type: "none" as const } } : {}),
      system: [
        { type: "text", text: config.system_prompt, cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
      ],
      messages: convo,
    });
  let stream = ask(true);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Le texte part au fil de l'eau, sauf ce qui pourrait être le début de la balise <prenom>.
      let pending = "";
      let held = false;
      let answer = "";
      let complete = false;
      let usedTools = false;
      const tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let counted = false;
      const flush = (text: string) => {
        if (!text) return;
        answer += text;
        controller.enqueue(encoder.encode(text));
      };
      try {
        let final: Anthropic.Messages.Message;
        for (let round = 1; ; round++) {
          let fresh = true;
          for await (const event of stream) {
            if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
            // Nouveau tour après un outil : on saute une ligne si Michel avait déjà parlé.
            if (fresh && (answer || pending) && !/\s$/.test(answer + pending)) pending += "\n\n";
            fresh = false;
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
          final = await stream.finalMessage();
          addUsage(tokens, final.usage);
          counted = true;
          if (final.stop_reason !== "tool_use") break;

          // Michel consulte ses outils, puis reprend la parole avec les résultats.
          usedTools = true;
          const calls = final.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
          const results = await Promise.all(calls.map(runTool));
          convo.push({ role: "assistant", content: final.content }, { role: "user", content: results });
          // Dernier tour : plus d'outil, il doit répondre avec ce qu'il a.
          stream = ask(round + 1 < MAX_TOOL_ROUNDS);
          counted = false;
        }
        const learned = cleanName(pending.match(NAME_TAG)?.[1]);
        flush(pending.replace(NAME_TAG, "").trimEnd());

        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nOh con, là je peux pas t'aider. Demande-moi autre chose."));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("…\n\nBoudu, j'ai trop causé, j'ai plus de souffle. Dis-moi « la suite » et je continue."));
        } else {
          // Une réponse tirée de la météo ou de l'actu ne va pas dans le cache : elle périmerait.
          complete = !learned && !usedTools;
          if (!name && !learned && messages.length === 1) {
            controller.enqueue(encoder.encode(askName()));
          }
        }
        if (learned) controller.enqueue(encoder.encode(TRAILER + JSON.stringify({ prenom: learned })));
      } catch (e) {
        console.error("anthropic", e);
        controller.enqueue(encoder.encode("\n\nMacarel, la machine a fait des siennes. Réessaie."));
      } finally {
        // Jetons consommés, même si la réponse a été coupée en route (ils sont facturés quand même).
        const partial = counted ? undefined : stream.currentMessage?.usage;
        if (partial) addUsage(tokens, partial);
        if (tokens.input || tokens.output) {
          keepAlive(recordTokens(userId, tokens).catch((e) => console.error("jetons", e)));
        }
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
