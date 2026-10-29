import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { getCaptchaToken } from './captcha';
import { supabase } from './supabase';

export type Profile = { firstName?: string; lastName?: string; birthYear?: number };

// Adresse où reviennent les liens des e-mails et les connexions Google / Facebook.
const SITE = Platform.OS === 'web' ? window.location.origin : 'https://michel.beer';

// Dans les applis, Google et Facebook renvoient vers l'appli elle-même.
const APP_RETURN = 'michelia://auth';

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
    otp_expired: 'Code faux ou expiré, redemande-en un.',
    over_sms_send_rate_limit: 'Trop de SMS envoyés, réessaie dans quelques minutes.',
    sms_send_failed: "Le SMS n'est pas parti, vérifie le numéro.",
    phone_provider_disabled: 'La connexion par SMS est coupée pour le moment.',
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
  const native = Platform.OS !== 'web';
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: native ? APP_RETURN : SITE, skipBrowserRedirect: native },
  });
  const failure = explain(error);
  if (failure) throw failure;
  if (!native || !data.url) return;

  const result = await WebBrowser.openAuthSessionAsync(data.url, APP_RETURN);
  if (result.type !== 'success') return;
  // Le retour porte soit un code à échanger, soit les jetons dans l'ancre de l'adresse.
  const url = new URL(result.url);
  const params = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get('code');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const outcome = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : access_token && refresh_token
      ? await supabase.auth.setSession({ access_token, refresh_token })
      : { error: { message: url.searchParams.get('error_description') ?? 'Connexion annulée.' } };
  const returned = explain(outcome.error);
  if (returned) throw returned;
}

// Connexion avec Apple, proposée seulement sur iPhone et iPad (obligatoire sur l'App Store
// dès qu'on propose Google ou Facebook).
export const appleSignInAvailable = () =>
  Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false);

export async function signInWithApple() {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple ne nous a rien renvoyé, réessaie.');
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  const failure = explain(error);
  if (failure) throw failure;
  // Apple ne donne le nom qu'à la première connexion : on le range tout de suite.
  const { givenName, familyName } = credential.fullName ?? {};
  if (data.user && (givenName || familyName)) {
    await saveProfile(data.user.id, {
      ...(await loadProfile(data.user.id)),
      firstName: givenName ?? undefined,
      lastName: familyName ?? undefined,
    });
  }
}

// Numéro au format international : « 06 12 34 56 78 » devient « +33612345678 ».
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s.\-()]/g, '');
  const phone = digits.startsWith('00') ? `+${digits.slice(2)}` : /^0\d{9}$/.test(digits) ? `+33${digits.slice(1)}` : digits;
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error('Numéro de téléphone invalide.');
  return phone;
}

// Envoie un code par SMS : il sert aussi bien à créer le compte qu'à s'y reconnecter.
export async function sendPhoneCode(phone: string) {
  const captchaToken = await getCaptchaToken();
  const { error } = await supabase.auth.signInWithOtp({
    phone: normalizePhone(phone),
    options: { captchaToken, channel: 'sms' },
  });
  const failure = explain(error);
  if (failure) throw failure;
}

export async function verifyPhoneCode(phone: string, code: string) {
  const { error } = await supabase.auth.verifyOtp({
    phone: normalizePhone(phone),
    token: code.replace(/\s/g, ''),
    type: 'sms',
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
