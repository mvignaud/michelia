import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { enablePush, pushState, setDailyPush } from './push';
import { carteInvite } from './ecran';

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
  ...carteInvite,
  card: {
    gap: 6,
    ...carteInvite.card,
  },
});
