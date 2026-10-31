import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AvatarView } from './AvatarView';
import {
  AVATAR_PARTS,
  PART_LABELS,
  avatarFromSeed,
  randomAvatar,
  saveAvatar,
  type Avatar,
  type AvatarPart,
} from './avatar';
import { COLUMN_COMPTE, barreCompte } from './ecran';
import { colors } from './theme';

type Props = {
  userId: string;
  avatar: Avatar;
  onSaved: (avatar: Avatar) => void;
  onClose: () => void;
};

// L'atelier : on retouche la bobine que Michel a dessinée, trait par trait.
export function AvatarEditor({ userId, avatar: initial, onSaved, onClose }: Props) {
  const [avatar, setAvatar] = useState<Avatar>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function choose<K extends AvatarPart>(part: K, id: Avatar[K]) {
    setAvatar((current) => ({ ...current, [part]: id }));
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await saveAvatar(userId, avatar);
      onSaved(avatar);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ça a planté, réessaie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <Text style={styles.title}>Ta bobine</Text>
          <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.close}>Annuler</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.preview}>
        <AvatarView avatar={avatar} size={120} />
        <Text style={styles.hint}>J'ai fait ta bobine comme j'ai pu. Retouche ce que tu veux, con.</Text>
        <View style={styles.quick}>
          <Pressable onPress={() => setAvatar(randomAvatar())} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.chipText}>🎲 Au pif</Text>
          </Pressable>
          <Pressable onPress={() => setAvatar(avatarFromSeed(userId))} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.chipText}>Celle de Michel</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {(Object.keys(AVATAR_PARTS) as AvatarPart[]).map((part) => (
          <View key={part} style={styles.section}>
            <Text style={styles.label}>{PART_LABELS[part]}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
              {AVATAR_PARTS[part].map((option) => {
                const selected = avatar[part] === option.id;
                const color = 'color' in option ? option.color : undefined;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => choose(part, option.id as Avatar[typeof part])}
                    style={({ pressed }) => [
                      color ? styles.swatch : styles.chip,
                      color && { backgroundColor: color },
                      selected && (color ? styles.swatchSelected : styles.chipSelected),
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${PART_LABELS[part]} : ${option.label}`}
                  >
                    {!color && <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ))}

        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          onPress={save}
          disabled={busy}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>Garder cette bobine</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 20 },
  ...barreCompte,
  content: { ...COLUMN_COMPTE, padding: 16, paddingBottom: 48, gap: 14 },
  // L'aperçu reste en haut pendant qu'on fait défiler les traits.
  preview: {
    ...COLUMN_COMPTE,
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  hint: { color: colors.secondary, fontSize: 14, textAlign: 'center' },
  quick: { flexDirection: 'row', gap: 8 },
  section: { gap: 6 },
  label: { color: colors.secondary, fontSize: 12, marginLeft: 4 },
  options: { gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextSelected: { color: colors.onAccent, fontWeight: '600' },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: colors.surface },
  swatchSelected: { borderColor: colors.accent, borderWidth: 3 },
  error: { color: colors.failed, fontSize: 14, textAlign: 'center' },
  primary: {
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
