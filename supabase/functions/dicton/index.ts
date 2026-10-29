// Fonction « dicton » : le dicton (ou le coup de gueule) du jour de Michel.
// Appelée chaque heure du matin par pg_cron (migration 20261029120000_dicton.sql).
// Une seule fois par jour, à partir de dicton_hour (heure de Paris) : Claude écrit une
// phrase, gardée dans daily_sayings, puis la fonction « push » l'envoie aux appareils
// qui l'ont demandée (audience « daily »).
// Sans danger si quelqu'un d'autre l'appelle : au pire, l'envoi du jour part un peu plus tôt.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

type Kind = "dicton" | "coup_de_gueule";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const TITLES: Record<Kind, string> = {
  dicton: "Le dicton de Michel",
  coup_de_gueule: "Le coup de gueule de Michel",
};

// Consigne par défaut, remplaçable par app_config.dicton_instruction ({kind} et {date} y sont remplacés).
const INSTRUCTION =
  "Écris le {kind} du jour de Michel, pour une notification sur téléphone. Nous sommes le {date}. " +
  "Une ou deux phrases, 150 caractères au plus, sans guillemets, sans émoji, sans titre ni explication. " +
  "Un dicton : à la manière des dictons de campagne, inventé, de saison, avec une chute qui fait sourire. " +
  "Un coup de gueule : une râlerie de papi sur un petit travers de la vie moderne, franche mais pas méchante. " +
  "Parler du Sud-Ouest, jamais de mot marseillais. Rien de politique, rien de triste.";

const paris = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", ...options }).format(date);

async function loadConfig(): Promise<Record<string, string>> {
  const { data, error } = await admin.from("app_config").select("key, value");
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.key, row.value]));
}

// Claude n'écrit qu'une ligne ; on retire ce qui dépasserait d'une notification.
function cleanSaying(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/^[\s«"“*]+|[\s»"”*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function write(kind: Kind, now: Date, config: Record<string, string>) {
  // Les trente derniers, pour que Michel ne radote pas.
  const { data: recent } = await admin
    .from("daily_sayings")
    .select("text")
    .not("text", "is", null)
    .order("day", { ascending: false })
    .limit(30);
  const already = (recent ?? []).map((r) => `- ${r.text}`).join("\n");

  const date = paris(now, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const instruction = (config.dicton_instruction || INSTRUCTION)
    .replaceAll("{kind}", kind === "dicton" ? "dicton" : "coup de gueule")
    .replaceAll("{date}", date);

  const message = await anthropic.messages.create({
    model: config.model ?? "claude-haiku-5-5",
    max_tokens: 200,
    output_config: { effort: "low" },
    system: config.system_prompt ? [{ type: "text", text: config.system_prompt }] : undefined,
    messages: [
      {
        role: "user",
        content: already ? `${instruction}\n\nDéjà dit ces derniers jours, ne le répète pas :\n${already}` : instruction,
      },
    ],
  });
  const text = cleanSaying(
    message.content.map((block) => (block.type === "text" ? block.text : "")).join(" "),
  );
  if (text.length < 10) throw new Error(`dicton trop court : ${JSON.stringify(text)}`);
  return { text, usage: message.usage };
}

async function send(kind: Kind, text: string): Promise<number> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: TITLES[kind], body: text, audience: "daily" }),
  });
  if (!response.ok) throw new Error(`push ${response.status} ${await response.text()}`);
  const { sent, failed } = (await response.json()) as { sent: number; failed: number };
  if (sent === 0 && failed > 0) throw new Error(`push : ${failed} échecs, aucun envoi`);
  return sent;
}

// Met à jour la ligne du jour, avec deux nouveaux essais si la base ne répond pas.
async function mark(day: string, fields: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin
      .from("daily_sayings")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("day", day);
    if (!error) return true;
    console.error("daily_sayings", error);
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  return false;
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST seulement" });

  const now = new Date();
  // Date du jour à Paris, au format AAAA-MM-JJ.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now),
  );

  let config: Record<string, string>;
  try {
    config = await loadConfig();
  } catch (e) {
    console.error("config", e);
    return json(500, { error: "config" });
  }
  if (config.dicton_enabled === "false") return json(200, { status: "désactivé" });
  if (hour < Number(config.dicton_hour ?? 8)) return json(200, { status: "trop tôt", hour });

  const { data: claimed, error: claimError } = await admin.rpc("claim_daily_saying", { p_day: day });
  if (claimError) {
    console.error("réservation", claimError);
    return json(500, { error: "réservation" });
  }
  if (!claimed) return json(200, { status: "déjà fait", day });

  // Un coup de gueule environ un jour sur trois, le reste en dictons.
  const { data: row } = await admin.from("daily_sayings").select("kind, text").eq("day", day).single();
  const kind: Kind = row?.kind ?? (Math.random() < 1 / 3 ? "coup_de_gueule" : "dicton");
  try {
    // Après un échec d'envoi, le texte déjà écrit resservira : Claude n'est payé qu'une fois.
    let text = row?.text as string | null;
    if (!text) {
      const written = await write(kind, now, config);
      text = written.text;
      // Texte noté avant l'envoi : sans lui, une reprise pourrait renvoyer le dicton.
      const saved = await mark(day, {
        kind,
        text,
        input_tokens: written.usage.input_tokens,
        output_tokens: written.usage.output_tokens,
      });
      if (!saved) throw new Error("texte du jour non enregistré");
    }
    let sent: number;
    try {
      sent = await send(kind, text);
    } catch (e) {
      console.error("dicton : envoi", e);
      await mark(day, { kind, status: "echec" });
      return json(500, { error: "échec", day });
    }
    // Envoyé : si la base refuse de le noter, la ligne reste « en_cours » avec son texte,
    // et claim_daily_saying ne la reprend jamais. Mieux vaut un dicton non noté qu'envoyé deux fois.
    if (!(await mark(day, { status: "envoye", sent }))) console.error("dicton : envoyé mais non noté", day);
    return json(200, { status: "envoye", day, kind, text, sent });
  } catch (e) {
    console.error("dicton", e);
    await mark(day, { kind, status: "echec" });
    return json(500, { error: "échec", day });
  }
});
