import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from './chat';

// Ce que Michel retient sur l'appareil (stockage local du navigateur ou du téléphone) :
// le prénom du visiteur et la dernière conversation. Rien de tout ça n'est gardé sur le serveur.
export type Memory = { name?: string; messages: ChatMessage[] };

const KEY = 'michelia:memoire:v1';
const MAX_SAVED = 40;

export async function loadMemory(): Promise<Memory> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Memory>) : {};
    const messages = Array.isArray(saved.messages)
      ? saved.messages.filter(
          (m): m is ChatMessage =>
            (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string',
        )
      : [];
    return { name: typeof saved.name === 'string' ? saved.name : undefined, messages };
  } catch {
    return { messages: [] };
  }
}

export async function saveMemory(memory: Memory): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ name: memory.name, messages: memory.messages.slice(-MAX_SAVED) }),
    );
  } catch {
    // Stockage plein ou bloqué (navigation privée) : Michel oubliera, tant pis.
  }
}
