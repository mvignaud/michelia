import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { euros } from './comptoir';
import { supabase } from './supabase';
import { colors, serif } from './theme';

const SITE = 'https://michel.beer';

type Abonnement = {
  source: 'web' | 'apple' | 'google';
  formule: 'mois' | 'an';
  statut: 'actif' | 'impaye' | 'resilie';
  prix_cents: number;
  fin_periode: string | null;
};

const jour = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : '';

// « Mon compte » : MichelIA+ à sa place, sur le site comme dans les applis. Abonné : formule, échéance
// et où la gérer ; sinon un bouton qui ouvre la cotisation (écran natif dans les applis, /la-cotisation
// sur le site). Rien tant que MichelIA+ est fermé, ou dans une appli dont la caisse est fermée (onOuvrir absent).
export function MonAbonnement({ userId, onOuvrir }: { userId: string; onOuvrir?: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [abonnement, setAbonnement] = useState<Abonnement | null>(null);

  useEffect(() => {
    Promise.all([supabase.rpc('michelia_plus_public'), supabase.rpc('mon_abonnement')])
      .then(([offre, mien]) => {
        setOuvert(!!(offre.data as { actif?: boolean } | null)?.actif);
        setAbonnement(mien.error ? null : ((mien.data as Abonnement | null) ?? null));
      })
      .catch(() => setOuvert(false));
  }, [userId]);

  const ouvrir = Platform.OS === 'web' ? () => Linking.openURL(`${SITE}/la-cotisation`) : onOuvrir;
  if (!ouvert || (!abonnement && !ouvrir)) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>MichelIA+</Text>
      <View style={styles.card}>
        {abonnement ? (
          <>
            <Text style={styles.label}>
              Cotisation {abonnement.formule === 'an' ? "à l'année" : 'au mois'} · {euros(abonnement.prix_cents)}
            </Text>
            <Text style={styles.meta}>
              {abonnement.statut === 'actif' && `Prochaine échéance le ${jour(abonnement.fin_periode)}.`}
              {abonnement.statut === 'impaye' && "Le dernier paiement n'est pas passé : vérifie ton moyen de paiement."}
              {abonnement.statut === 'resilie' && `Résiliée : MichelIA+ reste jusqu'au ${jour(abonnement.fin_periode)}.`}
            </Text>
            {abonnement.source === 'web' ? (
              <Text style={styles.link} onPress={() => Linking.openURL(`${SITE}/la-cotisation`)} accessibilityRole="link">
                Gérer sur michel.beer
              </Text>
            ) : (
              <Text
                style={styles.link}
                onPress={() =>
                  Linking.openURL(
                    abonnement.source === 'apple'
                      ? 'https://apps.apple.com/account/subscriptions'
                      : 'https://play.google.com/store/account/subscriptions?package=beer.michel.app',
                  )
                }
                accessibilityRole="link"
              >
                Gérer dans {abonnement.source === 'apple' ? "l'App Store" : 'Google Play'}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.meta}>Michel gratuit reste gratuit. MichelIA+, c'est bien plus de messages par jour, et plus de photos.</Text>
            <Pressable onPress={ouvrir} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.buttonText}>Prendre MichelIA+</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, marginTop: 8 },
  title: { color: colors.text, fontSize: 17, fontFamily: serif, fontWeight: '700', paddingHorizontal: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 14 },
  button: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
