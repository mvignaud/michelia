import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from './chat';
import { supabase } from './supabase';

// Ce que Michel retient : le prénom du visiteur et la dernière conversation.
// Toujours sur l'appareil ; pour les membres, aussi sur le compte (table conversations).
export type Memory = { name?: string; messages: ChatMessage[] };

const KEY = 'michelia:memoire:v1';
const MAX_SAVED = 40;

function clean(saved: Partial<Memory>): Memory {
  const messages = Array.isArray(saved.messages)
      ? saved.messages.filter(
          (m): m is ChatMessage =>
            (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string',
        ).map(({ role, content, photo }) => ({ role, content, ...(photo === true && { photo }) }))
      : [];
  return { name: typeof saved.name === 'string' ? saved.name : undefined, messages };
}

// Les photos ne sont jamais gardées : seule la mention « photo » reste dans la conversation.
const withoutImage = ({ image: _image, ...message }: ChatMessage): ChatMessage => message;

export async function loadMemory(): Promise<Memory> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return clean(raw ? (JSON.parse(raw) as Partial<Memory>) : {});
  } catch {
    return { messages: [] };
  }
}

// Conversation gardée sur le compte, ou null s'il n'y en a pas encore (ou en cas de souci réseau).
export async function loadAccountMemory(userId: string): Promise<Memory | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('name, messages')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return clean({ name: data.name ?? undefined, messages: data.messages });
}

export async function saveAccountMemory(userId: string, memory: Memory): Promise<void> {
  await supabase.from('conversations').upsert({
    user_id: userId,
    name: memory.name?.slice(0, 30) ?? null,
    messages: memory.messages.slice(-MAX_SAVED).map(withoutImage),
    updated_at: new Date().toISOString(),
  });
}

export async function saveMemory(memory: Memory): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ name: memory.name, messages: memory.messages.slice(-MAX_SAVED).map(withoutImage) }),
    );
  } catch {
    // Stockage plein ou bloqué (navigation privée) : Michel oubliera, tant pis.
  }
}
