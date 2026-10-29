import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useInstall } from './pwa';
import { colors, serif } from './theme';

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
  card: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    boxShadow: '0 2px 10px rgba(60, 40, 20, 0.08)',
  },
  icon: { width: 52, height: 52, borderRadius: 12 },
  body: { flex: 1, gap: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', fontFamily: serif },
  text: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  strong: { color: colors.text, fontWeight: '600' },
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
  alone: { paddingHorizontal: 0 },
  laterText: { color: colors.secondary, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
