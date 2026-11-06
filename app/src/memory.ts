import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from './chat';
import { supabase } from './supabase';

// Ce que Michel retient : le prénom du visiteur et ses causettes, rangées comme dans un carnet
// (la plus récente en haut). Toujours sur l'appareil ; pour les membres, aussi sur le compte :
// table discussions, une ligne par causette. La causette où l'on vient d'écrire est en plus recopiée
// dans la table conversations (une ligne par compte), que lisent le back-office et les applis d'avant le carnet.
// « enLigne » : la causette est déjà arrivée sur le compte. Si elle n'y est plus au chargement suivant,
// c'est qu'elle a été effacée depuis un autre appareil, et l'appareil l'oublie aussi.
export type Discussion = { id: string; titre: string; messages: ChatMessage[]; maj: string; enLigne?: boolean };
export type Carnet = { name?: string; courante?: string; discussions: Discussion[] };

const KEY = 'michelia:carnet:v1';
// Avant le carnet, une seule conversation : reprise comme première causette.
const KEY_ANCIENNE = 'michelia:memoire:v1';
const MAX_SAVED = 40;
export const MAX_DISCUSSIONS = 30;

// Messages gardés : rôle, texte et la mention « photo ». Les photos elles-mêmes ne sont jamais gardées.
export function nettoyer(raw: unknown): ChatMessage[] {
  return Array.isArray(raw)
    ? raw
        .filter(
          (m): m is ChatMessage =>
            (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string',
        )
        .map(({ role, content, photo }) => ({ role, content, ...(photo === true && { photo }) }))
    : [];
}

const aGarder = (messages: ChatMessage[]) => nettoyer(messages).slice(-MAX_SAVED);

// Le titre d'une causette : le début de la première question.
export function titreDe(messages: ChatMessage[]): string {
  const question = messages.find((m) => m.role === 'user' && m.content.trim());
  const texte = question?.content.replace(/\s+/g, ' ').trim() ?? '';
  if (!texte) return messages.some((m) => m.photo) ? 'Une photo' : 'Causette';
  return texte.length > 60 ? `${texte.slice(0, 57).trimEnd()}…` : texte;
}

// Identifiant d'une causette (format uuid, attendu par la base).
export function nouvelId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const temps = (iso: string) => Date.parse(iso) || 0;

function discussion(raw: unknown): Discussion | null {
  const d = raw as Partial<Discussion & { updated_at: string }> | null;
  if (!d || typeof d.id !== 'string' || !UUID.test(d.id)) return null;
  const messages = nettoyer(d.messages);
  if (!messages.length) return null;
  const maj = typeof d.maj === 'string' ? d.maj : typeof d.updated_at === 'string' ? d.updated_at : '';
  return {
    id: d.id,
    titre: typeof d.titre === 'string' && d.titre.trim() ? d.titre : titreDe(messages),
    messages,
    maj: new Date(temps(maj)).toISOString(),
    ...(d.enLigne === true && { enLigne: true }),
  };
}

// La plus récente en haut, et pas plus de MAX_DISCUSSIONS : renvoie aussi celles qui tombent du carnet.
export function ranger(discussions: Discussion[]): { gardees: Discussion[]; tombees: Discussion[] } {
  const triees = [...discussions].sort((a, b) => temps(b.maj) - temps(a.maj));
  return { gardees: triees.slice(0, MAX_DISCUSSIONS), tombees: triees.slice(MAX_DISCUSSIONS) };
}

export async function loadCarnet(): Promise<Carnet> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Carnet>;
      const discussions = Array.isArray(saved.discussions)
        ? saved.discussions.map(discussion).filter((d): d is Discussion => !!d)
        : [];
      return {
        name: typeof saved.name === 'string' ? saved.name : undefined,
        courante: typeof saved.courante === 'string' ? saved.courante : undefined,
        discussions: ranger(discussions).gardees,
      };
    }
    const ancienne = JSON.parse((await AsyncStorage.getItem(KEY_ANCIENNE)) ?? '{}') as { name?: unknown; messages?: unknown };
    const messages = nettoyer(ancienne.messages);
    const premiere = messages.length
      ? [{ id: nouvelId(), titre: titreDe(messages), messages, maj: new Date().toISOString() }]
      : [];
    return {
      name: typeof ancienne.name === 'string' ? ancienne.name : undefined,
      courante: premiere[0]?.id,
      discussions: premiere,
    };
  } catch {
    return { discussions: [] };
  }
}

export async function saveCarnet(carnet: Carnet): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        name: carnet.name,
        courante: carnet.courante,
        discussions: carnet.discussions.map((d) => ({ ...d, messages: aGarder(d.messages) })),
      }),
    );
  } catch {
    // Stockage plein ou bloqué (navigation privée) : Michel oubliera, tant pis.
  }
}

// Les causettes gardées sur le compte (null en cas de souci réseau). « aEnvoyer » : celles à recopier
// dans la table discussions, c'est-à-dire la conversation écrite par une appli d'avant le carnet.
// « locales » : les causettes de l'appareil, pour reconnaître cette conversation si elle y est déjà.
export async function loadAccountCarnet(
  userId: string,
  locales: Discussion[],
  // « complet » : la liste des causettes a bien été lue (sinon on ne sait pas lesquelles ont été effacées).
): Promise<{ name?: string; discussions: Discussion[]; aEnvoyer: Discussion[]; complet: boolean } | null> {
  const [conv, liste] = await Promise.all([
    supabase.from('conversations').select('name, messages, updated_at').eq('user_id', userId).maybeSingle(),
    supabase
      .from('discussions')
      .select('id, titre, messages, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(MAX_DISCUSSIONS),
  ]);
  if (conv.error && liste.error) return null;
  const discussions: Discussion[] = (liste.data ?? [])
    .map(discussion)
    .filter((d): d is Discussion => !!d)
    .map((d) => ({ ...d, enLigne: true }));
  const aEnvoyer: Discussion[] = [];

  // La conversation du compte n'est plus récente que les causettes que si une appli d'avant le carnet
  // y a écrit (sinon elle est recopiée en même temps qu'une causette, à la même heure).
  const ancienne = nettoyer(conv.data?.messages);
  const majAncienne = conv.data?.updated_at ? temps(conv.data.updated_at) : 0;
  if (ancienne.length && discussions.every((d) => temps(d.maj) < majAncienne)) {
    const maj = new Date(majAncienne).toISOString();
    // La même causette, continuée par l'appli d'avant : tous ses messages ouvrent la conversation du compte.
    const continuee = (d: Discussion) =>
      d.messages.length <= ancienne.length &&
      d.messages.every((m, i) => ancienne[i].role === m.role && ancienne[i].content === m.content);
    const suite = discussions.find(continuee) ?? locales.find(continuee);
    const reprise: Discussion = suite
      ? { ...suite, messages: ancienne, maj }
      : { id: nouvelId(), titre: titreDe(ancienne), messages: ancienne, maj };
    aEnvoyer.push(reprise);
    const place = discussions.findIndex((d) => d.id === reprise.id);
    if (place >= 0) discussions[place] = reprise;
    else discussions.unshift(reprise);
  }
  return { name: conv.data?.name ?? undefined, discussions: ranger(discussions).gardees, aEnvoyer, complet: !liste.error };
}

// Garde une causette sur le compte. « enCours » : c'est celle où l'on vient d'écrire, recopiée aussi
// dans la table conversations (avec le prénom), à la même heure.
export async function saveAccountDiscussion(
  userId: string,
  d: Discussion,
  enCours?: { name?: string },
): Promise<void> {
  const messages = aGarder(d.messages);
  const [{ error }] = await Promise.all([
    supabase
      .from('discussions')
      .upsert({ id: d.id, user_id: userId, titre: d.titre.slice(0, 80), messages, updated_at: d.maj }),
    enCours &&
      supabase.from('conversations').upsert({
        user_id: userId,
        name: enCours.name?.slice(0, 30) ?? null,
        messages,
        updated_at: d.maj,
      }),
  ]);
  if (error) throw error;
}

// Retire une causette du compte. Si c'était la plus récente, sa copie dans la table conversations
// est vidée aussi : sinon elle reviendrait au prochain chargement comme une conversation d'avant le carnet.
export async function deleteAccountDiscussion(userId: string, id: string, plusRecente: boolean): Promise<void> {
  const [{ error }] = await Promise.all([
    supabase.from('discussions').delete().eq('user_id', userId).eq('id', id),
    plusRecente && supabase.from('conversations').update({ messages: [] }).eq('user_id', userId),
  ]);
  if (error) throw error;
}

// Causettes effacées sur l'appareil mais pas encore sur le compte (hors ligne, ou compte encore en
// chargement) : gardées de côté pour ne pas les reprendre du compte, et réessayées au chargement suivant.
const KEY_EFFACEES = 'michelia:carnet:effacees:v1';
let effacees: Promise<Set<string>> | null = null;

export function lireEffacees(): Promise<Set<string>> {
  effacees ??= AsyncStorage.getItem(KEY_EFFACEES)
    .then((raw) => {
      const ids: unknown = JSON.parse(raw ?? '[]');
      return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
    })
    .catch(() => new Set<string>());
  return effacees;
}

async function changerEffacees(change: (ids: Set<string>) => void): Promise<void> {
  const ids = await lireEffacees();
  change(ids);
  await AsyncStorage.setItem(KEY_EFFACEES, JSON.stringify([...ids].slice(-100))).catch(() => undefined);
}

// Efface une causette du compte ; tant que ce n'est pas fait, elle reste notée comme effacée.
export async function effacerDuCompte(userId: string, id: string, plusRecente: boolean): Promise<void> {
  await changerEffacees((ids) => ids.add(id));
  await deleteAccountDiscussion(userId, id, plusRecente);
  await changerEffacees((ids) => ids.delete(id));
}
