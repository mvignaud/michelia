import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getCaptchaToken } from './captcha';
import { supabase } from './supabase';

export type Profile = { firstName?: string; lastName?: string; birthYear?: number };

// Adresse où reviennent les liens des e-mails et les connexions Google / Facebook.
const SITE = Platform.OS === 'web' ? window.location.origin : 'https://michel.beer';

export const isMember = (session: Session | null) => !!session && !session.user.is_anonymous;

export function birthYearFromAge(age: number) {
  return new Date().getFullYear() - age;
}

export function ageFromBirthYear(year?: number) {
  return year ? new Date().getFullYear() - year : undefined;
}

// Traduit les erreurs de Supabase Auth les plus courantes en langage de Michel.
function explain(error: { message?: string; code?: string } | null): Error | null {
  if (!error) return null;
  const known: Record<string, string> = {
    invalid_credentials: 'E-mail ou mot de passe incorrect.',
    user_already_exists: 'Un compte existe déjà avec cet e-mail.',
    email_exists: 'Un compte existe déjà avec cet e-mail.',
    weak_password: 'Mot de passe trop faible : 8 caractères au moins.',
    email_not_confirmed: "Confirme d'abord ton e-mail avec le lien reçu.",
    over_email_send_rate_limit: "Trop d'e-mails envoyés, réessaie dans quelques minutes.",
    captcha_failed: 'Vérification anti-robot échouée, réessaie.',
  };
  return new Error((error.code && known[error.code]) || error.message || 'Ça a planté, réessaie.');
}

export async function signUpWithEmail(input: {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
  password: string;
}) {
  const captchaToken = await getCaptchaToken();
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      captchaToken,
      emailRedirectTo: SITE,
      data: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        birth_year: birthYearFromAge(input.age),
      },
    },
  });
  const failure = explain(error);
  if (failure) throw failure;
  // Sans session, Supabase attend la confirmation de l'e-mail.
  return { needsConfirmation: !data.session };
}

export async function signInWithEmail(email: string, password: string) {
  const captchaToken = await getCaptchaToken();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
    options: { captchaToken },
  });
  const failure = explain(error);
  if (failure) throw failure;
}

export async function signInWithProvider(provider: 'google' | 'facebook') {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: SITE },
  });
  const failure = explain(error);
  if (failure) throw failure;
}

export async function sendPasswordReset(email: string) {
  const captchaToken = await getCaptchaToken();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    captchaToken,
    redirectTo: SITE,
  });
  const failure = explain(error);
  if (failure) throw failure;
}

export async function setNewPassword(password: string) {
  const failure = explain((await supabase.auth.updateUser({ password })).error);
  if (failure) throw failure;
}

export async function loadProfile(userId: string): Promise<Profile> {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, birth_year')
    .eq('id', userId)
    .maybeSingle();
  return {
    firstName: data?.first_name ?? undefined,
    lastName: data?.last_name ?? undefined,
    birthYear: data?.birth_year ?? undefined,
  };
}

export async function saveProfile(userId: string, profile: Profile) {
  const { error } = await supabase
    .from('profiles')
    .update({
      first_name: profile.firstName?.trim() || null,
      last_name: profile.lastName?.trim() || null,
      birth_year: profile.birthYear ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  const failure = explain(error);
  if (failure) throw failure;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function deleteAccount() {
  const failure = explain((await supabase.rpc('delete_my_account')).error);
  if (failure) throw failure;
  await supabase.auth.signOut({ scope: 'local' });
}
