import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Discussion } from './memory';
import { colors, serif } from './theme';

// Le carnet des causettes : à gauche du chat sur un grand écran, en tiroir sur un téléphone.
type Props = {
  discussions: Discussion[];
  courante?: string;
  // Pendant que Michel répond, on ne change pas de causette.
  occupe: boolean;
  membre: boolean;
  onOuvrir: (id: string) => void;
  onNouvelle: () => void;
  onSupprimer: (id: string) => void;
  onConnexion: () => void;
  onFermer?: () => void;
};

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function quand(iso: string, maintenant = new Date()): string {
  const d = new Date(iso);
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  if (ecart <= 0) return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
  if (ecart === 1) return 'Hier';
  return `${d.getDate()} ${MOIS[d.getMonth()]}${d.getFullYear() === maintenant.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

export function Carnet({ discussions, courante, occupe, membre, onOuvrir, onNouvelle, onSupprimer, onConnexion, onFermer }: Props) {
  // Retirer une causette se fait en deux appuis : la croix, puis « Sûr ? ».
  const [aRetirer, setARetirer] = useState<string>();

  return (
    <View style={styles.panneau}>
      <View style={styles.haut}>
        <Text style={styles.titre}>Mes causettes</Text>
        {onFermer && (
          <Pressable
            onPress={onFermer}
            style={({ pressed }) => pressed && styles.pressed}
            accessibilityRole="button"
            accessibilityLabel="Fermer le carnet"
            hitSlop={10}
          >
            <Text style={styles.fermer}>✕</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={onNouvelle}
        disabled={occupe}
        style={({ pressed }) => [styles.nouvelle, occupe && styles.dimmed, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.nouvelleText}>＋ Nouvelle causette</Text>
      </Pressable>
      <ScrollView style={styles.liste} contentContainerStyle={styles.listeContenu}>
        {discussions.length === 0 && (
          <Text style={styles.vide}>Rien encore, con. Pose-moi une question et la causette se range ici.</Text>
        )}
        {discussions.map((d) => {
          const active = d.id === courante;
          const confirmer = aRetirer === d.id;
          return (
            <View key={d.id} style={[styles.ligne, active && styles.ligneActive]}>
              <Pressable
                onPress={() => {
                  setARetirer(undefined);
                  onOuvrir(d.id);
                }}
                disabled={occupe && !active}
                style={({ pressed }) => [styles.ouvrir, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.ligneTitre, active && styles.ligneTitreActive]} numberOfLines={1}>
                  {d.titre}
                </Text>
                <Text style={styles.date}>{quand(d.maj)}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!confirmer) return setARetirer(d.id);
                  setARetirer(undefined);
                  onSupprimer(d.id);
                }}
                disabled={occupe && active}
                style={({ pressed }) => [styles.retirer, confirmer && styles.retirerSur, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={confirmer ? 'Confirmer : effacer cette causette' : `Effacer la causette « ${d.titre} »`}
                hitSlop={6}
              >
                <Text style={[styles.retirerText, confirmer && styles.retirerSurText]}>{confirmer ? 'Sûr ?' : '✕'}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {!membre && (
        <Text style={styles.pied}>
          Tes causettes restent sur cet appareil.{' '}
          <Text style={styles.lien} onPress={onConnexion} accessibilityRole="link">
            Connecte-toi
          </Text>{' '}
          pour les retrouver partout.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panneau: { flex: 1, backgroundColor: colors.bar, paddingTop: 12 },
  haut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  titre: { color: colors.text, fontSize: 18, fontFamily: serif, fontWeight: '700' },
  fermer: { color: colors.secondary, fontSize: 18 },
  nouvelle: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  nouvelleText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  liste: { flex: 1 },
  listeContenu: { paddingHorizontal: 8, paddingBottom: 16, gap: 2 },
  vide: { color: colors.tertiary, fontSize: 14, lineHeight: 20, padding: 10 },
  ligne: { flexDirection: 'row', alignItems: 'center', borderRadius: 10 },
  ligneActive: { backgroundColor: colors.accentSoft },
  ouvrir: { flex: 1, minWidth: 0, paddingVertical: 9, paddingLeft: 10, gap: 1 },
  ligneTitre: { color: colors.text, fontSize: 15 },
  ligneTitreActive: { color: colors.accent, fontWeight: '600' },
  date: { color: colors.tertiary, fontSize: 12 },
  retirer: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  retirerSur: { backgroundColor: colors.failed },
  retirerText: { color: colors.tertiary, fontSize: 13 },
  retirerSurText: { color: colors.onAccent, fontWeight: '700' },
  pied: {
    color: colors.secondary,
    fontSize: 12,
    lineHeight: 17,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  lien: { color: colors.accent, fontWeight: '600', textDecorationLine: 'underline' },
  pressed: { opacity: 0.6 },
  dimmed: { opacity: 0.4 },
});
