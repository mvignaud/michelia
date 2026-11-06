// Grok (xAI), utilisé seulement pour le ton ultra-hard des abonnés MichelIA+ quand app_config
// grok_actif = true. API compatible OpenAI, réponse en flux SSE. La clé vit dans le secret XAI_API_KEY.
const URL_XAI = "https://api.x.ai/v1/chat/completions";
// Sans premier mot de Grok dans ce délai, on abandonne et Claude prend la main.
const PREMIER_MOT_MS = 15_000;

export type GrokMessage = { role: "system" | "user" | "assistant"; content: string };
export type GrokFin = "fin" | "longueur" | "refus";
export type GrokUsage = { input: number; output: number };

type Morceau = {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function grok(options: {
  cle: string;
  modele: string;
  messages: GrokMessage[];
  maxTokens: number;
  signal: AbortSignal;
  onText: (text: string) => void;
}): Promise<{ fin: GrokFin; usage: GrokUsage }> {
  const attente = new AbortController();
  const timer = setTimeout(() => attente.abort(), PREMIER_MOT_MS);
  const signal = AbortSignal.any([options.signal, attente.signal]);
  const usage: GrokUsage = { input: 0, output: 0 };
  let fin: GrokFin = "fin";
  try {
    const res = await fetch(URL_XAI, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.modele,
        messages: options.messages,
        max_tokens: options.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`xAI ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let reste = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reste += decoder.decode(value, { stream: true });
      const lignes = reste.split("\n");
      reste = lignes.pop() ?? "";
      for (const ligne of lignes) {
        const donnee = ligne.startsWith("data:") ? ligne.slice(5).trim() : "";
        if (!donnee || donnee === "[DONE]") continue;
        const morceau = JSON.parse(donnee) as Morceau;
        if (morceau.usage) {
          usage.input = morceau.usage.prompt_tokens ?? usage.input;
          usage.output = morceau.usage.completion_tokens ?? usage.output;
        }
        const choix = morceau.choices?.[0];
        const texte = choix?.delta?.content;
        if (texte) {
          clearTimeout(timer);
          options.onText(texte);
        }
        if (choix?.finish_reason === "length") fin = "longueur";
        else if (choix?.finish_reason === "content_filter") fin = "refus";
      }
    }
    return { fin, usage };
  } finally {
    clearTimeout(timer);
  }
}
