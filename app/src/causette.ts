import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';
import type { ChatMessage } from './chat';
import { getAccessToken, supabase } from './supabase';

// La causette : une conversation partagée par un lien public en lecture seule, ou copiée en texte.
// Seuls le texte et qui parle partent, jamais les photos (voir la migration 20261030150000_causettes.sql).
export type Echange = Pick<ChatMessage, 'role' | 'content'>;
export type MaCausette = { id: string; created_at: string; apercu: string | null };

export const CAUSETTE_PATH = '/la-causette/';
export const MAX_ECHANGES = 60;
const SITE = 'https://michel.beer';

export const causetteUrl = (id: string) => `${SITE}${CAUSETTE_PATH}${id}`;

// Identifiant de la causette dans l'adresse de la page (web seulement).
export function causetteId(path: string) {
  const match = path.match(/^\/la-causette\/([A-Za-z0-9_-]{8,16})$/);
  return match?.[1];
}

// Texte brut pour le copier-coller : sans les étoiles du gras, puces en « • ».
export function plain(text: string) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
}

export function causetteTexte(echanges: Echange[]) {
  const corps = echanges.map((e) => `${e.role === 'user' ? 'Moi' : 'Michel'} : ${plain(e.content)}`).join('\n\n');
  return `${corps}\n\n— Michel, le papi du Gers coincé dans la machine : ${SITE}`;
}

export async function copier(text: string) {
  await Clipboard.setStringAsync(text);
}

// Feuille de partage du téléphone ; sur un ordinateur sans partage, on copie le lien.
// Renvoie 'copie' quand le lien a été copié faute de feuille de partage.
export async function partagerLien(url: string): Promise<'partage' | 'copie'> {
  if (Platform.OS !== 'web') {
    await Share.share(Platform.OS === 'ios' ? { url } : { message: url }, { dialogTitle: 'Partager la causette' });
    return 'partage';
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Ma causette avec Michel', url });
      return 'partage';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'partage';
    }
  }
  await copier(url);
  return 'copie';
}

export async function partagerCausette(echanges: Echange[]): Promise<string> {
  await getAccessToken();
  const { data, error } = await supabase.rpc('partager_causette', {
    p_messages: echanges.map(({ role, content }) => ({ role, content })),
  });
  const result = data as { id?: string; erreur?: string } | null;
  if (error || !result?.id) throw new Error(result?.erreur ?? error?.message ?? 'inconnu');
  return result.id;
}

export async function lireCausette(id: string): Promise<{ messages: Echange[]; created_at: string } | null> {
  const { data, error } = await supabase.rpc('lire_causette', { p_id: id });
  if (error) throw error;
  return data;
}

// Les liens partagés, par pages de MES_CAUSETTES_PAGE (du plus récent) ; avant : date du dernier lien déjà lu.
export const MES_CAUSETTES_PAGE = 50;
export async function mesCausettes(avant?: string): Promise<MaCausette[]> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return [];
  const { data: rows, error } = await supabase.rpc('mes_causettes', avant ? { p_avant: avant } : {});
  if (error) throw error;
  return rows ?? [];
}

export async function retirerCausette(id: string) {
  const { error } = await supabase.rpc('retirer_causette', { p_id: id });
  if (error) throw error;
}
