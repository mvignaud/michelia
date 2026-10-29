import { fetch } from 'expo/fetch';
import { SUPABASE_ANON_KEY, SUPABASE_URL, getAccessToken } from './supabase';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// Envoie l'historique à la fonction « chat » et transmet la réponse au fil de l'eau.
export async function askMichel(
  messages: ChatMessage[],
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Erreur ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(decoder.decode(value, { stream: true }));
  }
}
