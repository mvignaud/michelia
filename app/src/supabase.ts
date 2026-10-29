import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Valeurs publiques (URL et clé publique du projet), fournies au build via .env.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Chaque visiteur reçoit un compte anonyme : c'est lui qui porte le quota du jour.
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error || !created.session) throw error ?? new Error('Connexion impossible');
  return created.session.access_token;
}

export { SUPABASE_ANON_KEY };
