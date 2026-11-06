import { useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { TONS, TONS_DURS_DISPONIBLES, loadMajeur, saveMajeur, type Ton, type TonId } from './tons';
import { colors, serif } from './theme';

const CONDITIONS = 'https://michel.beer/conditions';

// Choix du ton de Michel. Les tons durs (hard, ultra) sont cachés quand la plateforme ne les propose pas,
// verrouillés pour qui n'est pas inscrit, et demandent un « j'ai 18 ans » la première fois.
export function TonSheet({
  current,
  member,
  busy,
  onClose,
  onApply,
  onLocked,
}: {
  current: TonId;
  member: boolean;
  busy: boolean;
  onClose: () => void;
  onApply: (ton: Ton) => void;
  onLocked: () => void;
}) {
  const [warning, setWarning] = useState<Ton | null>(null);
  const tons = TONS.filter((t) => !t.dur || TONS_DURS_DISPONIBLES);

  async function pick(ton: Ton) {
    if (busy || ton.id === current) return;
    if (ton.dur && !member) return onLocked();
    if (ton.dur && !(await loadMajeur())) return setWarning(ton);
    onApply(ton);
  }

  async function confirm(ton: Ton) {
    await saveMajeur(true);
    onApply(ton);
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fermer" accessibilityRole="button" />
        <View style={styles.card}>
          {warning ? (
            <>
              <Text style={styles.title}>Attention, ça va secouer</Text>
              <Text style={styles.text}>
                Avec ce ton, Michel devient plus cru : blagues grasses, sous-entendus, histoires de gnôle, vannes plus
                dures. C’est de l’humour, jamais dirigé contre toi personnellement, et c’est toi qui le choisis. Réservé
                aux adultes (18 ans et plus). Tu peux revenir en arrière quand tu veux.
              </Text>
              <Text
                style={styles.link}
                accessibilityRole="link"
                {...(Platform.OS === 'web' ? ({ href: CONDITIONS, target: '_blank', hrefAttrs: { rel: 'noopener' } } as object) : {})}
                onPress={() => {
                  if (Platform.OS !== 'web') Linking.openURL(CONDITIONS).catch(() => undefined);
                }}
              >
                Conditions
              </Text>
              <View style={styles.buttons}>
                <Pressable
                  onPress={() => confirm(warning)}
                  disabled={busy}
                  style={({ pressed }) => [styles.button, styles.go, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.goText}>J’ai 18 ans, j’y vais</Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => [styles.button, styles.stay, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.stayText}>Non, je reste sage</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Le ton de Michel</Text>
              {tons.map((t) => {
                const active = t.id === current;
                const locked = t.dur && !member;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => pick(t)}
                    disabled={busy}
                    style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: busy }}
                    accessibilityLabel={`${t.label}${locked ? ', réservé aux inscrits' : ''}. ${t.description}`}
                  >
                    <Text style={styles.rowLabel}>
                      {t.label}
                      {locked ? ' 🔒' : ''}
                    </Text>
                    <Text style={styles.rowDescription}>{t.description}</Text>
                  </Pressable>
                );
              })}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43, 36, 32, 0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 18,
    gap: 10,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
  },
  title: { color: colors.text, fontFamily: serif, fontSize: 20, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  link: { color: colors.accent, fontSize: 14, textDecorationLine: 'underline' },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    gap: 2,
  },
  rowActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowDescription: { color: colors.secondary, fontSize: 14 },
  buttons: { gap: 8, marginTop: 6 },
  button: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999, alignItems: 'center' },
  go: { backgroundColor: colors.ochre },
  goText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  stay: { backgroundColor: colors.surface },
  stayText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
