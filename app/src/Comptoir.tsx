import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Purchases, { type PurchasesStoreProduct } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadProfile } from './auth';
import { cleAppli, euros, loadComptoir, reloadComptoir, type Comptoir as Data } from './comptoir';
import { supabase } from './supabase';
import { colors, serif } from './theme';

// Applis iOS et Android : le comptoir par achat intégré (Apple, Google), géré par RevenueCat.
// Jamais Stripe ici (règle Apple 3.1.1). Chaque palier est un produit « consommable » des boutiques,
// nommé pourboire_<id du palier>, ou pourboire_<id>2 quand une boutique a dû le recréer (Apple ne
// réutilise jamais un identifiant supprimé : le café iOS est pourboire_cafe2). Le prix affiché est celui de la boutique. Le webhook
// revenuecat-webhook enregistre l'achat dans la même table que le web (note du mois, carnet).
const produits = (palier: string) => [`pourboire_${palier}`, `pourboire_${palier}2`];
const palierDe = (produit: string) => produit.replace(/^pourboire_/, '').replace(/\d+$/, '');

let configured = false;

// Partagé avec l'écran MichelIA+ (Cotisation.tsx), qui y rattache ensuite le compte Michel.
export async function configure(cle: string) {
  if (configured) return;
  // Même identifiant que Supabase (membre ou visiteur anonyme) : utile pour retrouver un achat.
  const { data } = await supabase.auth.getSession();
  Purchases.configure({ apiKey: cle, appUserID: data.session?.user.id });
  configured = true;
}

export function Comptoir({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Data>();
  const [products, setProducts] = useState<Record<string, PurchasesStoreProduct>>({}); // par id de palier
  const [failed, setFailed] = useState(false);
  // La boutique a répondu (avec ou sans produits) : plus de roue qui tourne dans le vide.
  const [charges, setCharges] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [prenom, setPrenom] = useState('');

  useEffect(() => {
    (async () => {
      const comptoir = await loadComptoir();
      setData(comptoir);
      const cle = cleAppli(comptoir);
      if (!cle) return;
      await configure(cle);
      const found = await Purchases.getProducts(
        comptoir.paliers.flatMap((p) => produits(p.id)),
        Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION,
      );
      setProducts(Object.fromEntries(found.map((p) => [palierDe(p.identifier), p])));
      setCharges(true);
    })().catch(() => setFailed(true));

    // Un membre connecté retrouve son prénom pour le carnet (modifiable, facultatif).
    supabase.auth.getSession().then(async ({ data: auth }) => {
      const user = auth.session?.user;
      if (!user || user.is_anonymous) return;
      const { firstName } = await loadProfile(user.id);
      if (firstName) setPrenom((p) => p || firstName);
    }).catch(() => {});
  }, []);

  const pay = async (palier: string) => {
    const product = products[palier];
    if (!product || paying) return;
    setPaying(palier);
    setRefus(null);
    setThanks(null);
    try {
      // Le prénom voyage avec l'achat jusqu'au webhook ; vide, rien n'est inscrit au carnet.
      Purchases.setAttributes({ prenom: prenom.trim() || null });
      await Purchases.purchaseStoreProduct(product);
      setThanks(palier);
      // Le webhook arrive quelques secondes après la boutique : on relit un peu plus tard.
      setTimeout(() => reloadComptoir().then(setData).catch(() => {}), 4000);
    } catch (e) {
      if (!(e as { userCancelled?: boolean | null }).userCancelled) {
        setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
      }
    } finally {
      setPaying(null);
    }
  };

  const ouvert = !!cleAppli(data);
  const merci = data?.paliers.find((p) => p.id === thanks)?.merci;
  // Seuls les paliers trouvés dans la boutique de l'appareil sont proposés.
  const paliers = (data?.paliers ?? []).filter((p) => products[p.id]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <View style={styles.avatar}>
            <Image source={require('../assets/brand/michel-portrait.png')} style={styles.avatarImage} accessibilityLabel="Michel" />
          </View>
          <Text style={styles.title}>Le comptoir de Michel</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.back}>Fermer</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!data && !failed && <ActivityIndicator color={colors.accent} style={styles.padded} />}
        {(failed || (data && !ouvert)) && (
          <View style={styles.card}>
            <Text style={styles.quote}>Le comptoir ouvre bientôt, con.</Text>
            <Text style={styles.text}>Je finis de ranger les verres. Repasse dans pas longtemps.</Text>
          </View>
        )}
        {data && ouvert && (
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
              <TextInput
                value={prenom}
                onChangeText={setPrenom}
                placeholder="Ton prénom pour le carnet des copains (facultatif)"
                placeholderTextColor={colors.tertiary}
                autoComplete="given-name"
                maxLength={30}
                style={styles.input}
              />
            </View>

            {paliers.length === 0 && !failed && !charges && <ActivityIndicator color={colors.accent} style={styles.padded} />}
            {paliers.length === 0 && charges && (
              <View style={styles.card}>
                <Text style={styles.text}>La caisse de la boutique est encore fermée. Repasse un peu plus tard, con.</Text>
              </View>
            )}
            <View style={styles.paliers}>
              {paliers.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => pay(p.id)}
                  disabled={paying !== null}
                  style={({ pressed }) => [
                    styles.palier,
                    paying !== null && paying !== p.id && styles.dimmed,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                >
                  {paying === p.id ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <>
                      <Text style={styles.palierName}>{p.nom}</Text>
                      <Text style={styles.palierPrice}>{products[p.id].priceString}</Text>
                    </>
                  )}
                </Pressable>
              ))}
            </View>

            {refus && (
              <View style={styles.card}>
                <Text style={styles.text}>{refus}</Text>
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
          monde.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 20 },
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
  dimmed: { opacity: 0.4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    gap: 10,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  quote: { color: colors.accent, fontSize: 20, lineHeight: 28, fontFamily: serif, fontStyle: 'italic' },
  text: { color: colors.text, fontSize: 16, lineHeight: 23 },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
  },
  cardTitle: { color: colors.secondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  thanks: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.ochre },
  thanksText: { color: colors.accent, fontSize: 24, lineHeight: 32, fontFamily: serif, fontWeight: '700', textAlign: 'center' },
  paliers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  palier: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: 72,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  palierName: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  palierPrice: { color: colors.ochre, fontSize: 16, fontWeight: '700' },
  track: { height: 12, borderRadius: 6, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.ochre },
  small: { color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 8 },
});
