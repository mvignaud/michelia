import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { enablePush, pushState, setDailyPush } from './push';
import { colors, serif } from './theme';

const KEY = 'michelia:notifications';
export const DAILY_KEY = 'michelia:dicton';

// Michel propose ses notifications, dicton du jour compris ; à ceux qui les ont déjà
// acceptées, il propose seulement le dicton. « Non merci » le fait taire pour de bon.
export function NotifyCard() {
  const [offer, setOffer] = useState<'push' | 'daily' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      pushState(),
      AsyncStorage.getItem(KEY).catch(() => null),
      AsyncStorage.getItem(DAILY_KEY).catch(() => null),
    ])
      .then(([state, answer, daily]) => {
        if (answer === 'non' || daily) return;
        if (state === 'ask') setOffer('push');
        else if (state === 'on') setOffer('daily');
      })
      .catch(() => undefined);
  }, []);

  if (!offer) return null;

  function never() {
    setOffer(null);
    AsyncStorage.setItem(offer === 'push' ? KEY : DAILY_KEY, 'non').catch(() => undefined);
  }

  async function accept() {
    setBusy(true);
    setError(false);
    try {
      if (offer === 'push') {
        if (!(await enablePush(true))) return setOffer(null);
      } else {
        await setDailyPush(true);
      }
      AsyncStorage.setItem(DAILY_KEY, 'oui').catch(() => undefined);
      setOffer(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{offer === 'push' ? 'Je te fais signe ?' : 'Le dicton du jour ?'}</Text>
      <Text style={styles.text}>
        {error
          ? "Pétard, ça a pas pris. Réessaie dans un moment."
          : offer === 'push'
            ? "Chaque matin, un dicton ou un coup de gueule de Michel sur ton écran, et de temps en temps une nouvelle. Pas de quoi te casser les oreilles, promis."
            : "Chaque matin, Michel t'envoie un dicton ou un coup de gueule. Une notification par jour, pas une de plus."}
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
