import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Purchases, { type PurchasesStoreProduct } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadProfile } from './auth';
import { BarreMichel, CarnetDesCopains, CarteMerci, ComptoirBientot, NoteDuMois } from './Blocs';
import { cleAppli, loadComptoir, reloadComptoir, type Comptoir as Data } from './comptoir';
import { ecran, ecranComptoir } from './ecran';
import { supabase } from './supabase';
import { colors } from './theme';

// Applis iOS et Android : le comptoir par achat intégré (Apple, Google), géré par RevenueCat.
// Jamais Stripe ici (règle Apple 3.1.1). Chaque palier est un produit « consommable » des boutiques,
// nommé pourboire_<id du palier>, ou pourboire_<id>2 quand une boutique a dû le recréer (Apple ne
// réutilise jamais un identifiant supprimé : le café iOS est pourboire_cafe2). Le prix affiché est celui de la boutique. Le webhook
// revenuecat-webhook enregistre l'achat dans la même table que le web (note du mois, carnet).
const produits = (palier: string) => [`pourboire_${palier}`, `pourboire_${palier}2`];
const palierDe = (produit: string) => produit.replace(/^pourboire_/, '').replace(/\d+$/, '');
// Une image par palier sur son bouton (un palier inconnu garde la chope).
const ICONES: Record<string, string> = { cafe: '☕', croustade: '🥧', garbure: '🍲', fete: '🎉' };

let configured = false;

// Partagé avec l'écran MichelIA+ (Cotisation.tsx), qui y rattache ensuite le compte Michel.
export async function configure(cle: string) {
  if (configured) return;
  // Même identifiant que Supabase (membre ou visiteur anonyme) : utile pour retrouver un achat.
  const { data } = await supabase.auth.getSession();
  // StoreKit 1 sur iOS : en TestFlight, StoreKit 2 donnait des prix en dollars à un compte français
  // (la fenêtre d'achat d'Apple, elle, affichait bien des euros).
  Purchases.configure({
    apiKey: cle,
    appUserID: data.session?.user.id,
    ...(Platform.OS === 'ios' && { storeKitVersion: Purchases.STOREKIT_VERSION.STOREKIT_1 }),
  });
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
      <BarreMichel titre="Le comptoir de Michel" retour="Fermer" onPress={onClose} accessibilityRole="button" hitSlop={8} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!data && !failed && <ActivityIndicator color={colors.accent} style={styles.padded} />}
        {(failed || (data && !ouvert)) && (
          <ComptoirBientot />
        )}
        {data && ouvert && (
          <>
            {merci && <CarteMerci textStyle={MERCI}>{merci}</CarteMerci>}
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
                      <Text style={styles.palierIcone} accessibilityElementsHidden importantForAccessibility="no">
                        {ICONES[p.id] ?? '🍺'}
                      </Text>
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

            <NoteDuMois note={data.note_du_mois} />

            <CarnetDesCopains carnet={data.carnet} />
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

// Le merci des applis est un peu moins grand que celui du site.
const MERCI = { fontSize: 24, lineHeight: 32 } as const;

const styles = StyleSheet.create({
  ...ecran,
  ...ecranComptoir,
  screen: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 20 },
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
  palierIcone: { fontSize: 28, marginBottom: 4 },
});
