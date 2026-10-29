import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import {
  ageFromBirthYear,
  appleSignInAvailable,
  birthYearFromAge,
  deleteAccount,
  isMember,
  loadProfile,
  saveProfile,
  sendPasswordReset,
  sendPhoneCode,
  setNewPassword,
  signInWithApple,
  signInWithEmail,
  signInWithProvider,
  signOut,
  signUpWithEmail,
  verifyPhoneCode,
  type Profile,
} from './auth';
import { LinkedAccounts } from './LinkedAccounts';
import { COUNTRIES, PhoneField, fullPhone } from './PhoneField';
import { colors, serif } from './theme';

export type AccountMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'profile' | 'phone';

type Props = {
  session: Session | null;
  initialMode: AccountMode;
  onClose: () => void;
  onProfile: (profile: Profile) => void;
};

const MIN_AGE = 18;

export function AccountScreen({ session, initialMode, onClose, onProfile }: Props) {
  const member = isMember(session);
  const [mode, setMode] = useState<AccountMode>(member && initialMode !== 'reset' ? 'profile' : initialMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState(COUNTRIES[0]);
  const number = fullPhone(country, phone);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [apple, setApple] = useState(false);

  useEffect(() => {
    appleSignInAvailable().then(setApple);
  }, []);

  useEffect(() => {
    if (mode !== 'profile' || !session) return;
    loadProfile(session.user.id).then((p) => {
      setFirstName(p.firstName ?? '');
      setLastName(p.lastName ?? '');
      setAge(String(ageFromBirthYear(p.birthYear) ?? ''));
    });
  }, [mode, session]);

  function go(next: AccountMode) {
    setMode(next);
    setError(undefined);
    setNotice(undefined);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ça a planté, réessaie.');
    } finally {
      setBusy(false);
    }
  }

  function checkAge(): number {
    const value = Number(age);
    if (!Number.isInteger(value) || value < 1 || value > 120) throw new Error('Indique ton âge en chiffres.');
    if (value < MIN_AGE) throw new Error(`MichelIA est réservé aux ${MIN_AGE} ans et plus.`);
    return value;
  }

  const signup = () =>
    run(async () => {
      if (!firstName.trim()) throw new Error('Il me faut au moins ton prénom.');
      const years = checkAge();
      const { needsConfirmation } = await signUpWithEmail({ firstName, lastName, age: years, email, password });
      if (needsConfirmation) {
        setNotice(`C'est presque bon ! Clique sur le lien envoyé à ${email.trim()} pour activer ton compte.`);
      } else {
        onProfile({ firstName, lastName, birthYear: birthYearFromAge(years) });
        onClose();
      }
    });

  const signin = () =>
    run(async () => {
      await signInWithEmail(email, password);
      onClose();
    });

  const forgot = () =>
    run(async () => {
      if (!email.trim()) throw new Error('Indique ton e-mail.');
      await sendPasswordReset(email);
      setNotice(`Si un compte existe pour ${email.trim()}, un lien pour changer le mot de passe vient de partir.`);
    });

  const phoneStep = () =>
    run(async () => {
      if (!codeSent) {
        await sendPhoneCode(number);
        setCodeSent(true);
        setNotice('Code envoyé par SMS. Il est valable quelques minutes.');
      } else {
        await verifyPhoneCode(number, code);
        onClose();
      }
    });

  const reset = () =>
    run(async () => {
      await setNewPassword(password);
      setNotice('Mot de passe changé. Tu es connecté.');
      setPassword('');
    });

  const save = () =>
    run(async () => {
      if (!session) return;
      const profile = { firstName, lastName, birthYear: birthYearFromAge(checkAge()) };
      await saveProfile(session.user.id, profile);
      onProfile(profile);
      setNotice('Profil enregistré.');
    });

  const remove = () =>
    run(async () => {
      await deleteAccount();
      onProfile({});
      onClose();
    });

  const titles: Record<AccountMode, string> = {
    signin: 'Se connecter',
    signup: 'Créer un compte',
    forgot: 'Mot de passe oublié',
    reset: 'Nouveau mot de passe',
    profile: 'Mon compte',
    phone: 'Par SMS',
  };

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <Text style={styles.title}>{titles[mode]}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.close}>Fermer</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {(mode === 'signin' || mode === 'signup') && (
          <>
            <Text style={styles.intro}>
              {mode === 'signup'
                ? 'Avec un compte, Michel te reconnaît sur tous tes appareils.'
                : 'Content de te revoir, boudu.'}
            </Text>
            {apple && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={12}
                style={styles.apple}
                onPress={() => run(signInWithApple)}
              />
            )}
            <ProviderButton label="Continuer avec Google" onPress={() => run(() => signInWithProvider('google'))} />
            <ProviderButton label="Continuer avec Facebook" onPress={() => run(() => signInWithProvider('facebook'))} />
            <ProviderButton label="Continuer avec mon numéro" onPress={() => go('phone')} />
            <Text style={styles.or}>ou avec ton e-mail</Text>
          </>
        )}

        <View style={styles.card}>
          {(mode === 'signup' || mode === 'profile') && (
            <>
              <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
              <Field label="Nom" value={lastName} onChangeText={setLastName} autoComplete="family-name" />
              <Field label="Âge" value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} />
            </>
          )}
          {mode === 'profile' && (session?.user.email || session?.user.phone) && (
            <Text style={styles.email}>
              Connecté avec {session.user.email || `+${session.user.phone?.replace(/^\+/, '')}`}
            </Text>
          )}
          {mode === 'phone' && (
            <PhoneField
              country={country}
              onCountry={(value) => {
                setCountry(value);
                setCodeSent(false);
              }}
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setCodeSent(false);
              }}
              last={!codeSent}
            />
          )}
          {mode === 'phone' && codeSent && (
            <Field
              label="Code reçu par SMS"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={8}
              last
            />
          )}
          {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
            <Field
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          )}
          {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
            <Field
              label={mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              last
            />
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        <Pressable
          style={({ pressed }) => [styles.primary, (busy || pressed) && styles.pressed]}
          disabled={busy}
          onPress={{ signin, signup, forgot, reset, profile: save, phone: phoneStep }[mode]}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.primaryText}>
              {{
                signin: 'Se connecter',
                signup: 'Créer mon compte',
                forgot: 'Recevoir le lien',
                reset: 'Changer le mot de passe',
                profile: 'Enregistrer',
                phone: codeSent ? 'Valider le code' : 'Recevoir le code',
              }[mode]}
            </Text>
          )}
        </Pressable>

        {mode === 'profile' && session && <LinkedAccounts session={session} apple={apple} />}

        <View style={styles.links}>
          {mode === 'signin' && (
            <>
              <Link label="Pas encore de compte ? En créer un" onPress={() => go('signup')} />
              <Link label="Mot de passe oublié ?" onPress={() => go('forgot')} />
            </>
          )}
          {(mode === 'signup' || mode === 'forgot') && (
            <Link label="Déjà un compte ? Se connecter" onPress={() => go('signin')} />
          )}
          {mode === 'phone' && (
            <>
              {codeSent && <Link label="Renvoyer le code" onPress={() => run(() => sendPhoneCode(number))} />}
              <Link label="Plutôt avec un e-mail" onPress={() => go('signin')} />
            </>
          )}
          {mode === 'profile' && (
            <>
              <Link label="Se déconnecter" onPress={() => run(async () => { await signOut(); onClose(); })} />
              {confirmDelete ? (
                <Link label="Confirmer : supprimer définitivement mon compte" danger onPress={remove} />
              ) : (
                <Link label="Supprimer mon compte" danger onPress={() => setConfirmDelete(true)} />
              )}
            </>
          )}
        </View>

        {mode === 'phone' && (
          <Text style={styles.legal}>
            Le même numéro sert à créer le compte puis à s'y reconnecter. On garde seulement ton
            numéro, ton prénom, ton nom et ton année de naissance.
          </Text>
        )}

        {mode === 'signup' && (
          <Text style={styles.legal}>
            En créant un compte, tu acceptes les conditions d'utilisation. On garde seulement ton
            prénom, ton nom, ton année de naissance et ton e-mail.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, last, ...input }: TextInputProps & { label: string; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.fieldBorder]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.tertiary} {...input} />
    </View>
  );
}

function ProviderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.provider, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={styles.providerText}>{label}</Text>
    </Pressable>
  );
}

function Link({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Text style={[styles.link, danger && styles.danger]} onPress={onPress} accessibilityRole="link">
      {label}
    </Text>
  );
}

const COLUMN = { width: '100%', maxWidth: 480, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 10 },
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.bar,
    paddingTop: Platform.OS === 'ios' ? 48 : 0,
  },
  barInner: {
    ...COLUMN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 56,
  },
  title: { color: colors.text, fontSize: 20, fontFamily: serif, fontWeight: '700' },
  close: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  content: { ...COLUMN, padding: 16, paddingBottom: 48, gap: 12 },
  intro: { color: colors.secondary, fontSize: 15, textAlign: 'center', marginVertical: 8 },
  provider: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  apple: { height: 48 },
  providerText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  or: { color: colors.tertiary, fontSize: 13, textAlign: 'center', marginVertical: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  field: { paddingVertical: 8 },
  fieldBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  label: { color: colors.secondary, fontSize: 12 },
  input: { color: colors.text, fontSize: 17, paddingVertical: 4 },
  email: { color: colors.secondary, fontSize: 13, paddingVertical: 10 },
  error: { color: colors.failed, fontSize: 14, textAlign: 'center' },
  notice: { color: colors.online, fontSize: 14, textAlign: 'center' },
  primary: {
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  links: { alignItems: 'center', gap: 14, marginTop: 8 },
  link: { color: colors.accent, fontSize: 15 },
  danger: { color: colors.failed },
  legal: { color: colors.tertiary, fontSize: 12, textAlign: 'center', lineHeight: 17, marginTop: 8 },
});
