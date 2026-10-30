import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Purchases, { type PurchasesStoreProduct } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isMember } from './auth';
import { configure } from './Comptoir';
import { cleAppli, euros, loadComptoir } from './comptoir';
import { supabase } from './supabase';
import { colors, serif } from './theme';

// Applis iOS et Android : MichelIA+ par abonnement auto-renouvelable des boutiques (Apple, Google), géré
// par RevenueCat (règle Apple 3.1.1 : jamais la carte du site ici). Produits michelia_plus_mois et
// michelia_plus_an (chez Google : michelia_plus_mois:mois). RevenueCat est rattaché au compte Michel
// (logIn) : c'est ce qui permet à revenuecat-webhook de donner le droit au bon compte. Le site garde
// sa page /la-cotisation (Cotisation.web.tsx).
const PRODUITS = ['michelia_plus_mois', 'michelia_plus_an'];
const formuleDe = (produit: string) => (/^michelia_plus_an/.test(produit) ? 'an' : 'mois');
const SITE = 'https://michel.beer';

type Abonnement = {
  actif: boolean;
  source: 'web' | 'apple' | 'google';
  formule: 'mois' | 'an';
  statut: 'actif' | 'impaye' | 'resilie';
  prix_cents: number;
  fin_periode: string | null;
};

const jour = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export function Cotisation({ onClose, onCompte }: { onClose?: () => void; onCompte?: () => void }) {
  const [membre, setMembre] = useState<boolean>();
  const [abonnement, setAbonnement] = useState<Abonnement | null>();
  const [produits, setProduits] = useState<Record<'mois' | 'an', PurchasesStoreProduct | undefined>>({ mois: undefined, an: undefined });
  const [charges, setCharges] = useState(false);
  const [failed, setFailed] = useState(false);
  const [formule, setFormule] = useState<'mois' | 'an'>('mois');
  const [sending, setSending] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [bienvenue, setBienvenue] = useState(false);

  const recharger = async () => {
    const { data: auth } = await supabase.auth.getSession();
    const estMembre = isMember(auth.session);
    setMembre(estMembre);
    if (!estMembre) return setAbonnement(null);
    // Sans réponse sûre, on ne propose pas d'acheter : la boutique encaisserait un second abonnement
    // que la base refuserait (un seul abonnement vivant par compte).
    const { data, error } = await supabase.rpc('mon_abonnement');
    if (error) throw error;
    setAbonnement((data as Abonnement | null) ?? null);
  };

  // Bouton retour d'Android : ferme l'écran au lieu de quitter l'appli.
  useEffect(() => {
    const abonne = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose?.();
      return true;
    });
    return () => abonne.remove();
  }, [onClose]);

  useEffect(() => {
    (async () => {
      const comptoir = await loadComptoir();
      const cle = cleAppli(comptoir);
      if (!cle) throw new Error('caisse des applis fermée');
      await configure(cle);
      const { data: auth } = await supabase.auth.getSession();
      // L'abonnement suit le compte Michel, pas l'appareil.
      if (isMember(auth.session)) await Purchases.logIn(auth.session!.user.id);
      await recharger();
      const found = await Purchases.getProducts(PRODUITS, Purchases.PRODUCT_CATEGORY.SUBSCRIPTION);
      const parFormule = { mois: undefined, an: undefined } as Record<'mois' | 'an', PurchasesStoreProduct | undefined>;
      for (const p of found) parFormule[formuleDe(p.identifier)] ??= p;
      setProduits(parFormule);
      setCharges(true);
    })().catch(() => setFailed(true));
  }, []);

  const souscrire = async () => {
    const produit = produits[formule];
    if (!produit || sending) return;
    setSending(true);
    setRefus(null);
    try {
      const { data: auth } = await supabase.auth.getSession();
      if (!isMember(auth.session)) return setMembre(false);
      await Purchases.logIn(auth.session!.user.id);
      await Purchases.purchaseStoreProduct(produit);
      setBienvenue(true);
      // Le webhook arrive quelques secondes après la boutique : on relit un peu plus tard.
      setTimeout(() => recharger().catch(() => {}), 5000);
    } catch (e) {
      if (!(e as { userCancelled?: boolean | null }).userCancelled) {
        setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
      }
    } finally {
      setSending(false);
    }
  };

  // Exigé par Apple : retrouver un abonnement pris sur un autre appareil.
  const restaurer = async () => {
    setSending(true);
    setRefus(null);
    try {
      const { data: auth } = await supabase.auth.getSession();
      if (isMember(auth.session)) await Purchases.logIn(auth.session!.user.id);
      const info = await Purchases.restorePurchases();
      if (!info.entitlements.active.michelia_plus) setRefus("Je ne trouve pas d'abonnement sur ce compte de la boutique.");
      setTimeout(() => recharger().catch(() => {}), 3000);
    } catch {
      setRefus('La boutique ne répond pas. Réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  // La boutique qui a vendu l'abonnement, pas forcément celle de cet appareil.
  const gerer = (source: 'apple' | 'google') =>
    Linking.openURL(
      source === 'apple'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions?package=beer.michel.app',
    );

  const produit = produits[formule];
  const enVente = !!(produits.mois || produits.an);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <View style={styles.avatar}>
            <Image source={require('../assets/brand/michel-portrait.png')} style={styles.avatarImage} accessibilityLabel="Michel" />
          </View>
          <Text style={styles.title}>MichelIA+</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.back}>Fermer</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.quote}>
          « Michel gratuit reste gratuit. La cotisation, c'est pour ceux qui causent beaucoup, et qui veulent me donner un coup de
          main. »
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ce que ça change</Text>
          <Text style={styles.text}>• Bien plus de messages par jour, et plus de photos.</Text>
          <Text style={styles.text}>• Ma voix, quand j'aurai trouvé le bon Gascon pour me la prêter.</Text>
          <Text style={styles.text}>• Et tu fais tourner la boutique, sans pub, pour tout le monde.</Text>
        </View>

        {failed && <Text style={styles.refus}>La caisse ne répond pas. Réessaie dans un moment.</Text>}
        {!charges && !failed && <ActivityIndicator color={colors.accent} />}

        {bienvenue && (
          <View style={[styles.card, styles.thanks]}>
            <Text style={styles.thanksText}>Bienvenue au club ! Té, tu es des nôtres.</Text>
          </View>
        )}

        {abonnement && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ta cotisation</Text>
            <Text style={styles.text}>
              MichelIA+ {abonnement.formule === 'mois' ? 'au mois' : "à l'année"}, {euros(abonnement.prix_cents)}.
            </Text>
            {abonnement.statut === 'actif' && <Text style={styles.text}>Prochaine échéance le {jour(abonnement.fin_periode)}.</Text>}
            {abonnement.statut === 'impaye' && (
              <Text style={styles.refus}>La dernière échéance n'est pas passée. Vérifie ton moyen de paiement dans la boutique.</Text>
            )}
            {abonnement.statut === 'resilie' && (
              <Text style={styles.text}>Résiliée : MichelIA+ reste jusqu'au {jour(abonnement.fin_periode)}.</Text>
            )}
            {abonnement.source === 'web' ? (
              <Text style={styles.small}>Prise sur michel.beer : elle se gère sur le site, page « La cotisation ».</Text>
            ) : (
              <Pressable onPress={() => gerer(abonnement.source as 'apple' | 'google')} accessibilityRole="link">
                <Text style={styles.changed}>Gérer dans {abonnement.source === 'apple' ? "l'App Store" : 'Google Play'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {charges && abonnement === null && membre === false && (
          <View style={styles.card}>
            <Text style={styles.text}>Pour cotiser, il te faut un compte Michel : c'est là que je range ta cotisation.</Text>
            {onCompte && (
              <Pressable onPress={onCompte} style={({ pressed }) => [styles.payer, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.payerText}>Me connecter ou créer un compte</Text>
              </Pressable>
            )}
          </View>
        )}

        {charges && abonnement === null && membre && !bienvenue && !enVente && (
          <View style={styles.card}>
            <Text style={styles.text}>La caisse de la boutique est encore fermée. Repasse un peu plus tard, con.</Text>
          </View>
        )}

        {charges && abonnement === null && membre && !bienvenue && enVente && (
          <View style={styles.card}>
            <View style={styles.row}>
              {(['mois', 'an'] as const)
                .filter((f) => produits[f])
                .map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => setFormule(f)}
                    style={[styles.formule, formule === f && styles.formuleChoisie]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: formule === f }}
                  >
                    <Text style={[styles.formuleNom, formule === f && styles.formuleNomChoisi]}>{f === 'mois' ? 'Au mois' : "À l'année"}</Text>
                    <Text style={[styles.formulePrix, formule === f && styles.formuleNomChoisi]}>
                      {produits[f]!.priceString} / {f}
                    </Text>
                  </Pressable>
                ))}
            </View>
            {refus && <Text style={styles.refus}>{refus}</Text>}
            <Pressable
              onPress={souscrire}
              disabled={sending || !produit}
              style={({ pressed }) => [styles.payer, (sending || !produit) && styles.dimmed, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              {sending ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.payerText}>Cotiser {produit ? produit.priceString : ''}</Text>
              )}
            </Pressable>
            <Text style={styles.small}>
              Abonnement {formule === 'mois' ? 'mensuel' : 'annuel'} renouvelé automatiquement au même prix, sauf résiliation au moins
              24 h avant la fin de la période. Payé par ton compte {Platform.OS === 'ios' ? 'Apple' : 'Google'}, résiliable à tout
              moment dans les réglages de la boutique.
            </Text>
          </View>
        )}

        {charges && abonnement === null && membre && (
          <Pressable onPress={restaurer} disabled={sending} accessibilityRole="button">
            <Text style={styles.changed}>Restaurer mes achats</Text>
          </Pressable>
        )}
        {charges && abonnement === null && membre && refus && !enVente && <Text style={styles.refus}>{refus}</Text>}

        <Text style={styles.small}>
          Abonnement encaissé par GOLDEN PRINT SAS.{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(`${SITE}/conditions.html`)} accessibilityRole="link">
            Conditions
          </Text>
          {' · '}
          <Text style={styles.link} onPress={() => Linking.openURL(`${SITE}/confidentialite.html`)} accessibilityRole="link">
            Confidentialité
          </Text>
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
  pressed: { opacity: 0.6 },
  dimmed: { opacity: 0.4 },
  row: { flexDirection: 'row', gap: 10 },
  refus: { color: colors.failed, fontSize: 15, lineHeight: 21 },
  payer: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  payerText: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  changed: { color: colors.tertiary, fontSize: 14, textDecorationLine: 'underline', textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  quote: { color: colors.accent, fontSize: 20, lineHeight: 28, fontFamily: serif, fontStyle: 'italic' },
  text: { color: colors.text, fontSize: 16, lineHeight: 23 },
  small: { color: colors.tertiary, fontSize: 13, lineHeight: 19 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  cardTitle: { color: colors.secondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  thanks: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.ochre },
  thanksText: { color: colors.accent, fontSize: 26, lineHeight: 34, fontFamily: serif, fontWeight: '700', textAlign: 'center' },
  formule: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  formuleChoisie: { backgroundColor: colors.accent, borderColor: colors.accent },
  formuleNom: { color: colors.text, fontSize: 16, fontFamily: serif, fontWeight: '700' },
  formuleNomChoisi: { color: colors.onAccent },
  formulePrix: { color: colors.secondary, fontSize: 14 },
});
