import type { Session, UserIdentity } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { addEmail, addPhone, confirmPhone, linkProvider, listIdentities, unlinkProvider } from './auth';
import { COUNTRIES, PhoneField, fullPhone } from './PhoneField';
import { colors } from './theme';

type Provider = 'google' | 'facebook' | 'apple';

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'apple', label: 'Apple' },
];

// « Mon compte » : relier plusieurs moyens de connexion au même compte.
export function LinkedAccounts({ session, apple }: { session: Session; apple: boolean }) {
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [adding, setAdding] = useState<'email' | 'phone' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const user = session.user;

  const refresh = () => listIdentities().then(setIdentities).catch(() => setIdentities([]));
  useEffect(() => {
    refresh();
  }, [user.id, user.email, user.phone]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ça a planté, réessaie.');
    } finally {
      setBusy(false);
    }
  }

  const canUnlink = identities.length > 1;
  const shown = PROVIDERS.filter((p) => p.id !== 'apple' || apple || identities.some((i) => i.provider === 'apple'));
  const number = fullPhone(country, phone);

  const submitEmail = () =>
    run(async () => {
      if (password.length < 8) throw new Error('Mot de passe trop faible : 8 caractères au moins.');
      await addEmail(email, password);
      setAdding(null);
      setNotice(`Clique sur le lien envoyé à ${email.trim()} pour activer cette adresse.`);
    });

  const submitPhone = () =>
    run(async () => {
      if (!codeSent) {
        await addPhone(number);
        setCodeSent(true);
        setNotice('Code envoyé par SMS.');
      } else {
        await confirmPhone(number, code);
        setAdding(null);
        setCodeSent(false);
        setNotice('Numéro ajouté.');
      }
    });

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Moyens de connexion</Text>
      <View style={styles.card}>
        <Row label="E-mail" value={user.email}>
          {!user.email && <Action label="Ajouter" onPress={() => setAdding(adding === 'email' ? null : 'email')} />}
        </Row>
        {adding === 'email' && (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="ton@adresse.fr"
              placeholderTextColor={colors.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Mot de passe (8 caractères au moins)"
              placeholderTextColor={colors.tertiary}
              secureTextEntry
              autoComplete="new-password"
            />
            <Action label="Envoyer le lien de confirmation" onPress={submitEmail} />
          </View>
        )}

        <Row label="Téléphone" value={user.phone ? `+${user.phone.replace(/^\+/, '')}` : undefined}>
          {!user.phone && <Action label="Ajouter" onPress={() => setAdding(adding === 'phone' ? null : 'phone')} />}
        </Row>
        {adding === 'phone' && (
          <View style={styles.form}>
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
              last
            />
            {codeSent && (
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="Code reçu par SMS"
                placeholderTextColor={colors.tertiary}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={8}
              />
            )}
            <Action label={codeSent ? 'Valider le code' : 'Recevoir le code'} onPress={submitPhone} />
          </View>
        )}

        {shown.map((p, index) => {
          const identity = identities.find((i) => i.provider === p.id);
          return (
            <Row key={p.id} label={p.label} value={identity ? 'Relié' : undefined} last={index === shown.length - 1}>
              {identity ? (
                canUnlink && <Action label="Retirer" danger onPress={() => run(() => unlinkProvider(identity))} />
              ) : (
                <Action label="Relier" onPress={() => run(() => linkProvider(p.id))} />
              )}
            </Row>
          );
        })}
      </View>
      {busy && <ActivityIndicator color={colors.accent} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}
    </View>
  );
}

function Row({ label, value, last, children }: { label: string; value?: string; last?: boolean; children?: React.ReactNode }) {
  return (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={value ? styles.rowValue : styles.rowEmpty} numberOfLines={1}>
          {value ? `✓ ${value}` : 'Pas encore'}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Action({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      <Text style={[styles.action, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 8 },
  title: { color: colors.secondary, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 16 },
  rowValue: { color: colors.online, fontSize: 13 },
  rowEmpty: { color: colors.tertiary, fontSize: 13 },
  form: { gap: 8, paddingBottom: 12 },
  input: {
    color: colors.text,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  action: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  danger: { color: colors.failed },
  error: { color: colors.failed, fontSize: 14, textAlign: 'center' },
  notice: { color: colors.online, fontSize: 14, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
