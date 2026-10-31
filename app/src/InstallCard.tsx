import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useInstall } from './pwa';
import { carteInvite } from './ecran';
import { colors } from './theme';

const KEY = 'michelia:installer';

// Petite carte pour mettre Michel sur l'écran d'accueil ; « Plus tard » la fait taire pour de bon.
export function InstallCard() {
  const { mode, install } = useInstall();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setHidden(v === 'non'))
      .catch(() => setHidden(false));
  }, []);

  if (mode === 'none' || hidden) return null;

  function later() {
    setHidden(true);
    AsyncStorage.setItem(KEY, 'non').catch(() => undefined);
  }

  return (
    <View style={styles.card}>
      <Image source={require('../assets/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
      <View style={styles.body}>
        <Text style={styles.title}>Mets Michel dans ta poche</Text>
        {mode === 'ios' ? (
          <Text style={styles.text}>
            Touche <Text style={styles.strong}>Partager</Text> (le carré avec la flèche), puis{' '}
            <Text style={styles.strong}>« Sur l'écran d'accueil »</Text>. Il s'ouvrira comme une vraie appli, pardi.
          </Text>
        ) : (
          <Text style={styles.text}>Une icône sur ton écran d'accueil, et il s'ouvre comme une vraie appli.</Text>
        )}
        <View style={styles.buttons}>
          {mode === 'prompt' && (
            <Pressable
              onPress={install}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Installer</Text>
            </Pressable>
          )}
          <Pressable
            onPress={later}
            style={({ pressed }) => [styles.later, mode === 'ios' && styles.alone, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.laterText}>{mode === 'ios' ? 'Compris' : 'Plus tard'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ...carteInvite,
  card: {
    flexDirection: 'row',
    gap: 14,
    ...carteInvite.card,
  },
  icon: { width: 52, height: 52, borderRadius: 12 },
  body: { flex: 1, gap: 6 },
  strong: { color: colors.text, fontWeight: '600' },
  alone: { paddingHorizontal: 0 },
});
