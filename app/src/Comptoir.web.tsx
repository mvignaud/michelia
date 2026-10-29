import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { euros, loadComptoir, type Comptoir as Data } from './comptoir';
import { colors, serif } from './theme';

// Page /comptoir (web seulement) : les pourboires, par Stripe Payment Links.
export function Comptoir() {
  const [data, setData] = useState<Data>();
  const [failed, setFailed] = useState(false);
  // Retour de Stripe : /comptoir?merci=<id du palier>.
  const [thanks] = useState(() => new URLSearchParams(window.location.search).get('merci'));

  useEffect(() => {
    loadComptoir()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const merci = data?.paliers.find((p) => p.id === thanks)?.merci;
  const paliers = data?.paliers.filter((p) => p.url) ?? [];
  const open = (url: string) => Linking.openURL(url);

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <View style={styles.avatar}>
            <Image source={require('../assets/brand/michel-portrait.png')} style={styles.avatarImage} accessibilityLabel="Michel" />
          </View>
          <Text style={styles.title}>Le comptoir de Michel</Text>
          <Pressable onPress={() => window.location.assign('/')} accessibilityRole="link">
            <Text style={styles.back}>Parler à Michel</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!data && !failed && <ActivityIndicator color={colors.accent} style={styles.padded} />}
        {(failed || (data && !data.actif)) && (
          <View style={styles.card}>
            <Text style={styles.quote}>Le comptoir ouvre bientôt, con.</Text>
            <Text style={styles.text}>Je finis de ranger les verres. Repasse dans pas longtemps.</Text>
          </View>
        )}
        {data?.actif && (
          <>
            {merci && (
              <View style={[styles.card, styles.thanks]}>
                <Text style={styles.thanksText}>{merci}</Text>
              </View>
            )}
            <View style={styles.card}>
              <Text style={styles.quote}>
                « Moi je suis gratuit, pardi. Par contre l'électricité du cerveau, elle se paie. »
              </Text>
              <Text style={styles.text}>
                Michel reste gratuit et sans pub, pour tout le monde. Si tu veux, tu peux lui payer quelque chose au comptoir.
                C'est un pourboire, rien de plus.
              </Text>
            </View>

            {paliers.length > 0 && (
              <View style={styles.paliers}>
                {paliers.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => open(p.url)}
                    style={({ pressed }) => [styles.palier, pressed && styles.pressed]}
                    accessibilityRole="link"
                  >
                    <Text style={styles.palierName}>{p.nom}</Text>
                    <Text style={styles.palierPrice}>{euros(p.prix_cents)}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>La note du mois</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, data.note_du_mois.pourcent)}%` }]} />
              </View>
              <Text style={styles.text}>
                {data.note_du_mois.pourcent} % de l'électricité du mois est couverte
                {data.note_du_mois.cout_eur > 0
                  ? ` (${euros(Math.round(data.note_du_mois.recu_eur * 100))} sur ${euros(Math.round(data.note_du_mois.cout_eur * 100))}).`
                  : '.'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Le carnet des copains</Text>
              {data.carnet.length ? (
                <Text style={styles.text}>{data.carnet.join(' · ')}</Text>
              ) : (
                <Text style={styles.text}>Le carnet est vide. Tu veux être le premier, hè ?</Text>
              )}
            </View>
          </>
        )}

        <Text style={styles.small}>
          Pourboire sans contrepartie, encaissé par GOLDEN PRINT SAS. Il ne débloque rien : Michel reste le même pour tout le
          monde.{' '}
          <Text style={styles.link} onPress={() => window.location.assign('/conditions.html')} accessibilityRole="link">
            Conditions
          </Text>
        </Text>
      </ScrollView>
    </View>
  );
}

const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.bar },
  barInner: { ...COLUMN, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ochre,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 50, height: 50, marginTop: 4 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontFamily: serif, fontWeight: '700' },
  back: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  content: { ...COLUMN, padding: 16, paddingBottom: 48, gap: 14 },
  padded: { margin: 24 },
  pressed: { opacity: 0.6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    gap: 10,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  quote: { color: colors.accent, fontSize: 20, lineHeight: 28, fontFamily: serif, fontStyle: 'italic' },
  text: { color: colors.text, fontSize: 16, lineHeight: 23 },
  cardTitle: { color: colors.secondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  thanks: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.ochre },
  thanksText: { color: colors.accent, fontSize: 26, lineHeight: 34, fontFamily: serif, fontWeight: '700', textAlign: 'center' },
  paliers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  palier: {
    flexGrow: 1,
    flexBasis: 200,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    gap: 2,
  },
  palierName: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  palierPrice: { color: colors.ochre, fontSize: 16, fontWeight: '700' },
  track: { height: 12, borderRadius: 6, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.ochre },
  small: { color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 8 },
  link: { color: colors.tertiary, fontSize: 12, textDecorationLine: 'underline' },
});
