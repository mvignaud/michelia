import { fetch } from 'expo/fetch';
import type { Photo } from './photo';
import { SUPABASE_ANON_KEY, SUPABASE_URL, getAccessToken } from './supabase';

// « photo » : la question portait une photo. L'image elle-même (« image ») n'est envoyée
// qu'avec la dernière question et n'est jamais gardée en mémoire.
export type ChatMessage = { role: 'user' | 'assistant'; content: string; photo?: boolean; image?: Photo };

// Séparateur placé par la fonction avant ses informations de fin de réponse (le prénom retenu).
const TRAILER = '\u001e';

// Sans nouvelles de la fonction pendant ce temps, on coupe et on affiche une erreur.
const SILENCE_MS = 60_000;

// Envoie l'historique à la fonction « chat » et transmet la réponse au fil de l'eau.
// Renvoie le prénom si la personne vient de le donner à Michel.
// mode : identifiant du mode thématique choisi (voir modes.ts), ou rien.
export async function askMichel(
  messages: ChatMessage[],
  name: string | undefined,
  mode: string | undefined,
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ name?: string }> {
  const token = await getAccessToken();
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort());
  let silence: ReturnType<typeof setTimeout> | undefined;
  const wait = () => {
    clearTimeout(silence);
    silence = setTimeout(() => controller.abort(), SILENCE_MS);
  };
  wait();
  try {
    return await read(token, messages, name, mode, onText, controller.signal, wait);
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Michel s’est endormi sur sa chaise. Réessaie, con.');
    throw e;
  } finally {
    clearTimeout(silence);
  }
}

async function read(
  token: string,
  messages: ChatMessage[],
  name: string | undefined,
  mode: string | undefined,
  onText: (chunk: string) => void,
  signal: AbortSignal,
  alive: () => void,
): Promise<{ name?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: messages.map(({ role, content, photo, image }) => ({
        role,
        content,
        ...(photo && { photo }),
        ...(image && { image: { media_type: image.media_type, data: image.data } }),
      })),
      name,
      mode,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Erreur ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let trailer: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    alive();
    const chunk = decoder.decode(value, { stream: true });
    if (trailer !== null) {
      trailer += chunk;
      continue;
    }
    const cut = chunk.indexOf(TRAILER);
    if (cut === -1) {
      onText(chunk);
    } else {
      if (cut > 0) onText(chunk.slice(0, cut));
      trailer = chunk.slice(cut + 1);
    }
  }

  try {
    const info = trailer ? (JSON.parse(trailer) as { prenom?: unknown }) : {};
    return typeof info.prenom === 'string' ? { name: info.prenom } : {};
  } catch {
    return {};
  }
}
