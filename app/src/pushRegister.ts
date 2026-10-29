import { supabase } from './supabase';

// Enregistre l'appareil. Tant que la migration du dicton n'est pas passée, register_push
// ne connaît pas p_daily : on réessaie sans, l'appareil reçoit au moins les annonces.
export async function registerPush(args: Record<string, unknown>, daily?: boolean) {
  if (daily !== undefined) {
    const { error } = await supabase.rpc('register_push', { ...args, p_daily: daily });
    if (!error) return;
    if (error.code !== 'PGRST202') throw error;
  }
  const { error } = await supabase.rpc('register_push', args);
  if (error) throw error;
}
