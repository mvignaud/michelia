import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Invitation } from './invitations';
import { colors } from './theme';

// La carte d'une invitation de Michel, au-dessus de la zone de saisie ; ✕ la referme.
export function InvitationCard({
  invitation,
  onAccept,
  onClose,
}: {
  invitation: Invitation;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.card}>
      <Image
        source={require('../assets/brand/michel-portrait.png')}
        style={styles.avatar}
        accessibilityLabel="Michel"
      />
      <View style={styles.texts}>
        <Text style={styles.text}>{invitation.texte}</Text>
        <Pressable
          onPress={onAccept}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{invitation.bouton}</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel="Plus tard"
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
  avatar: { width: 36, height: 36, borderRadius: 18 },
  texts: { flex: 1, gap: 8, alignItems: 'flex-start' },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  button: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  close: { color: colors.secondary, fontSize: 16 },
  pressed: { opacity: 0.6 },
});
