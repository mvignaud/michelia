// Grok (xAI), utilisé seulement pour le ton ultra-hard des abonnés MichelIA+ quand app_config
// grok_actif = true. API compatible OpenAI, réponse en flux SSE. La clé vit dans le secret XAI_API_KEY.
const URL_XAI = "https://api.x.ai/v1/chat/completions";
// Sans premier mot de Grok dans ce délai, on abandonne et Claude prend la main.
const PREMIER_MOT_MS = 15_000;

export type GrokMessage = { role: "system" | "user" | "assistant"; content: string };
export type GrokFin = "fin" | "longueur" | "refus";
// input : jetons d'entrée hors cache ; cache : jetons d'entrée servis depuis le cache de xAI (moins chers).
export type GrokUsage = { input: number; cache: number; output: number };

type Morceau = {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

export async function grok(options: {
  cle: string;
  // Même identifiant d'une requête à l'autre : xAI les envoie au même serveur, qui a le prompt en cache.
  conversation: string;
  modele: string;
  messages: GrokMessage[];
  maxTokens: number;
  signal: AbortSignal;
  onText: (text: string) => void;
}): Promise<{ fin: GrokFin; usage: GrokUsage }> {
  const attente = new AbortController();
  const timer = setTimeout(() => attente.abort(), PREMIER_MOT_MS);
  const signal = AbortSignal.any([options.signal, attente.signal]);
  const usage: GrokUsage = { input: 0, cache: 0, output: 0 };
  let fin: GrokFin = "fin";
  // Le flux doit se clore par une raison de fin ou [DONE] : sinon il a été coupé en route.
  let termine = false;
  try {
    const res = await fetch(URL_XAI, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.cle}`,
        "Content-Type": "application/json",
        "x-grok-conv-id": options.conversation,
      },
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
        if (donnee === "[DONE]") termine = true;
        if (!donnee || donnee === "[DONE]") continue;
        const morceau = JSON.parse(donnee) as Morceau;
        if (morceau.usage) {
          const cache = morceau.usage.prompt_tokens_details?.cached_tokens ?? 0;
          usage.cache = cache;
          usage.input = Math.max((morceau.usage.prompt_tokens ?? 0) - cache, 0);
          usage.output = morceau.usage.completion_tokens ?? usage.output;
        }
        const choix = morceau.choices?.[0];
        const texte = choix?.delta?.content;
        if (texte) {
          clearTimeout(timer);
          options.onText(texte);
        }
        if (choix?.finish_reason) termine = true;
        if (choix?.finish_reason === "length") fin = "longueur";
        else if (choix?.finish_reason === "content_filter") fin = "refus";
      }
    }
    if (!termine) throw new Error("xAI : flux coupé avant la fin");
    return { fin, usage };
  } finally {
    clearTimeout(timer);
  }
}
