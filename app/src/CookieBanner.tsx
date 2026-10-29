import AsyncStorage from '@react-native-async-storage/async-storage';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ANALYTICS_ENABLED, clearAnalyticsCookies, startAnalytics } from './analytics';
import { colors } from './theme';

const KEY = 'michelia:cookies';

export type CookieBannerHandle = { reopen: () => void };

// Bandeau de consentement : « Refuser » et « J'accepte » ont le même poids, comme le veut la CNIL.
export const CookieBanner = forwardRef<CookieBannerHandle>(function CookieBanner(_, ref) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    AsyncStorage.getItem(KEY)
      .then((choice) => {
        if (choice === 'oui') startAnalytics();
        else if (choice !== 'non') setVisible(true);
      })
      .catch(() => setVisible(true));
  }, []);

  useImperativeHandle(ref, () => ({ reopen: () => ANALYTICS_ENABLED && setVisible(true) }), []);

  function choose(accept: boolean) {
    AsyncStorage.setItem(KEY, accept ? 'oui' : 'non').catch(() => undefined);
    if (accept) startAnalytics();
    else clearAnalyticsCookies();
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.text}>
          Boudu, une petite chose : Michel aimerait compter les visites avec Google Analytics, pour savoir
          si on vient le voir. Pas de pub, et tes questions ne partent pas chez Google.
        </Text>
        <View style={styles.buttons}>
          <Pressable onPress={() => choose(false)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>Refuser</Text>
          </Pressable>
          <Pressable onPress={() => choose(true)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>J'accepte</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', padding: 12, zIndex: 20 },
  card: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    boxShadow: '0 4px 16px rgba(60, 40, 20, 0.18)',
  },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
