import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { enablePush, pushState } from './push';
import { colors, serif } from './theme';

const KEY = 'michelia:notifications';

// Michel propose d'envoyer un mot de temps en temps ; « Non merci » la fait taire pour de bon.
export function NotifyCard() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([pushState(), AsyncStorage.getItem(KEY).catch(() => null)])
      .then(([state, answer]) => setVisible(state === 'ask' && answer !== 'non'))
      .catch(() => undefined);
  }, []);

  if (!visible) return null;

  function never() {
    setVisible(false);
    AsyncStorage.setItem(KEY, 'non').catch(() => undefined);
  }

  async function accept() {
    setBusy(true);
    setError(false);
    try {
      await enablePush();
      setVisible(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Je te fais signe ?</Text>
      <Text style={styles.text}>
        {error
          ? "Boudu, ça a pas pris. Réessaie dans un moment."
          : "De temps en temps, une nouvelle de Michel sur ton écran. Pas de quoi te casser les oreilles, promis."}
      </Text>
      <View style={styles.buttons}>
        <Pressable
          onPress={accept}
          disabled={busy}
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Oui, vas-y</Text>
        </Pressable>
        <Pressable
          onPress={never}
          style={({ pressed }) => [styles.later, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.laterText}>Non merci</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    boxShadow: '0 2px 10px rgba(60, 40, 20, 0.08)',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', fontFamily: serif },
  text: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  later: { height: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  laterText: { color: colors.secondary, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
