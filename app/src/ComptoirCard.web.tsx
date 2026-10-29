import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { loadComptoir } from './comptoir';
import { colors, serif } from './theme';

// Rappel discret (web seulement) : une carte « Payer un café à Michel » après le 20e message envoyé
// du mois, au plus une fois par semaine. Seulement aux membres connectés, seulement si le comptoir est ouvert.
const KEY = 'michelia:comptoir';
const AFTER = 20;
const WEEK = 7 * 24 * 3600 * 1000;

type State = { month: string; sent: number; shown: number };

const thisMonth = () => new Date().toISOString().slice(0, 7);

function read(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const sent = saved.month === thisMonth() ? Number(saved.sent) || 0 : 0;
    return { month: thisMonth(), sent, shown: Number(saved.shown) || 0 };
  } catch {
    return { month: thisMonth(), sent: 0, shown: 0 };
  }
}

function write(state: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Stockage refusé (navigation privée…) : pas de rappel, pas de drame.
  }
}

// À appeler à chaque message envoyé.
export function countSentMessage() {
  const state = read();
  write({ ...state, sent: state.sent + 1 });
}

export function ComptoirCard({ member, tick }: { member: boolean; tick: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !member || tick === 0) return;
    const state = read();
    if (state.sent < AFTER || Date.now() - state.shown < WEEK) return;
    let cancelled = false;
    loadComptoir()
      .then((data) => {
        if (cancelled || !data.actif) return;
        write({ ...read(), shown: Date.now() });
        setVisible(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick, member, visible]);

  if (!visible || !member) return null;

  return (
    <View style={styles.card}>
      <View style={styles.texts}>
        <Text style={styles.title}>Payer un café à Michel</Text>
        <Text style={styles.text}>Il reste gratuit pour tout le monde, mais l'électricité se paie.</Text>
        <Text style={styles.link} onPress={() => window.location.assign('/comptoir')} accessibilityRole="link">
          Passer au comptoir
        </Text>
      </View>
      <Pressable
        onPress={() => setVisible(false)}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel="Fermer"
        hitSlop={8}
      >
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '92%',
    maxWidth: 700,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
  },
  texts: { flex: 1, gap: 2 },
  title: { color: colors.accent, fontSize: 16, fontFamily: serif, fontWeight: '700' },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline', marginTop: 2 },
  close: { color: colors.secondary, fontSize: 16 },
  pressed: { opacity: 0.6 },
});
