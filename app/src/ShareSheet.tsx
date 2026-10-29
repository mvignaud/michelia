import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useShareCard } from './ShareCard';
import type { Card } from './shareCard';
import { colors } from './theme';

// Aperçu de la carte avant de la partager : on voit ce qui part sur les réseaux.
export function ShareSheet({ card, onClose }: { card: Card; onClose: () => void }) {
  const { preview, share, label, ready } = useShareCard(card);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onShare() {
    setBusy(true);
    setError(undefined);
    try {
      await share();
    } catch {
      setError("Miladiou, l'image veut pas partir. Réessaie, con.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.preview}>{preview}</View>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Fermer</Text>
            </Pressable>
            <Pressable
              onPress={onShare}
              disabled={!ready || busy}
              style={({ pressed }) => [
                styles.button,
                styles.share,
                (!ready || busy) && styles.disabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.shareText}>{label}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43, 36, 32, 0.6)' },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 16 },
  preview: { borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)' },
  error: { color: colors.onAccent, fontSize: 14, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999 },
  cancel: { backgroundColor: colors.surface },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  share: { backgroundColor: colors.ochre },
  shareText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
});
