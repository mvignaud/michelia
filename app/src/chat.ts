import { fetch } from 'expo/fetch';
import { SUPABASE_ANON_KEY, SUPABASE_URL, getAccessToken } from './supabase';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// Séparateur placé par la fonction avant ses informations de fin de réponse (le prénom retenu).
const TRAILER = '\u001e';

// Envoie l'historique à la fonction « chat » et transmet la réponse au fil de l'eau.
// Renvoie le prénom si la personne vient de le donner à Michel.
export async function askMichel(
  messages: ChatMessage[],
  name: string | undefined,
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ name?: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, name }),
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
