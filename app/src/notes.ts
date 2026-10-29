import { getAccessToken, supabase } from './supabase';

// Les étoiles sous les réponses de Michel. La question et la réponse partent avec la note, seulement
// quand on note (voir la migration 20261029190000_notes_reponses.sql et la politique de confidentialité).
export const nouvelleCle = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function noterReponse(input: { cle: string; note: number; reponse: string; question?: string; mode?: string }) {
  await getAccessToken();
  const { data, error } = await supabase.rpc('noter_reponse', {
    p_cle: input.cle,
    p_note: input.note,
    p_reponse: input.reponse,
    p_question: input.question ?? null,
    p_mode: input.mode ?? null,
  });
  if (error || data !== 'ok') throw error ?? new Error(String(data));
}
