import { loadStripe, type Appearance, type StripeCheckoutElementsSdk } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { euros, loadComptoir, reloadComptoir, type Comptoir as Data } from './comptoir';
import { isMember, loadProfile } from './auth';
import { supabase } from './supabase';
import { colors, serif } from './theme';

// Page /comptoir (web seulement) : les pourboires, payés dans notre propre formulaire. Seuls les champs
// de paiement viennent de Stripe (Payment Element d'une session Checkout ui_mode elements).
export function Comptoir(_props: { onClose?: () => void }) {
  const [data, setData] = useState<Data>();
  const [failed, setFailed] = useState(false);
  // Palier en cours de paiement (le formulaire est affiché dessous) et message d'erreur.
  const [paying, setPaying] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [checkout, setCheckout] = useState<{ sdk: StripeCheckoutElementsSdk; session: string }>();
  const [email, setEmail] = useState('');
  const [prenom, setPrenom] = useState('');
  const [sending, setSending] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  // Merci à afficher : au retour d'un moyen de paiement à redirection (/comptoir?merci=<id du palier>)
  // ou à la fin du paiement dans la page.
  const [thanks, setThanks] = useState<string | null>(() => new URLSearchParams(window.location.search).get('merci'));

  useEffect(() => {
    loadComptoir()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  // Un membre connecté n'a rien à retaper : e-mail et prénom viennent de son compte (modifiables).
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getSession();
      const user = auth.session?.user;
      if (!user || !isMember(auth.session)) return;
      if (user.email) setEmail((e) => e || user.email!);
      const { firstName } = await loadProfile(user.id);
      if (firstName) setPrenom((p) => p || firstName);
    })().catch(() => {});
  }, []);

  // Les champs de paiement : session créée par la fonction comptoir-paiement (prix lu côté serveur),
  // puis Payment Element monté dans le conteneur PAYMENT_ID. Le nettoyage le détruit (Changer d'avis, merci).
  const cle = data?.stripe_cle_publique;
  useEffect(() => {
    setCheckout(undefined);
    setRefus(null);
    if (!paying || !cle) return;
    let cancelled = false;
    let element: ReturnType<StripeCheckoutElementsSdk['createPaymentElement']> | undefined;
    (async () => {
      try {
        const { data: session, error } = await supabase.functions.invoke('comptoir-paiement', { body: { palier: paying } });
        const clientSecret = session?.clientSecret;
        if (error || typeof clientSecret !== 'string') throw new Error('Session refusée');
        const stripe = await loadStripe(cle);
        if (!stripe || cancelled) return;
        const sdk = stripe.initCheckoutElementsSdk({ clientSecret, elementsOptions: { appearance: APPEARANCE } });
        element = sdk.createPaymentElement({ layout: 'tabs' });
        element.mount(`#${PAYMENT_ID}`);
        setCheckout({ sdk, session: clientSecret.split('_secret_')[0] });
      } catch (e) {
        // Le détail reste dans la console du navigateur, pour le diagnostic.
        console.error('Comptoir : paiement impossible', e);
        if (!cancelled) {
          setProblem(true);
          setPaying(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      element?.destroy();
    };
  }, [paying, cle]);

  const choose = (id: string) => {
    setProblem(false);
    setThanks(null);
    setPaying(id);
  };

  const pay = async () => {
    if (!checkout || !paying || sending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setRefus("Il me faut ton e-mail pour t'envoyer le reçu.");
      return;
    }
    setSending(true);
    setRefus(null);
    try {
      // Le prénom part d'abord dans la session, pour que le webhook l'inscrive au carnet.
      if (prenom.trim()) {
        await supabase.functions.invoke('comptoir-paiement', { body: { session: checkout.session, prenom: prenom.trim() } });
      }
      const loaded = await checkout.sdk.loadActions();
      if (loaded.type === 'error') throw new Error(loaded.error.message);
      const result = await loaded.actions.confirm({
        email: email.trim(),
        redirect: 'if_required',
        returnUrl: `${window.location.origin}/comptoir?merci=${encodeURIComponent(paying)}`,
      });
      if (result.type === 'error') {
        // Carte refusée, champ manquant… : Stripe donne un message clair en français.
        setRefus(result.error.message);
        return;
      }
      setThanks(paying);
      setPaying(null);
      reloadComptoir().then(setData).catch(() => {});
    } catch (e) {
      console.error('Comptoir : paiement impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  const merci = data?.paliers.find((p) => p.id === thanks)?.merci;
  const paliers = data?.paliers ?? [];
  const choisi = paliers.find((p) => p.id === paying);

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
                    onPress={() => choose(p.id)}
                    disabled={paying !== null}
                    style={({ pressed }) => [
                      styles.palier,
                      paying !== null && paying !== p.id && styles.dimmed,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.palierName}>{p.nom}</Text>
                    <Text style={styles.palierPrice}>{euros(p.prix_cents)}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {problem && (
              <View style={styles.card}>
                <Text style={styles.text}>Ça a coincé à la caisse, réessaie dans un moment.</Text>
              </View>
            )}

            {paying && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {choisi?.nom} · {euros(choisi?.prix_cents ?? 0)}
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Ton e-mail, pour le reçu"
                  placeholderTextColor={colors.tertiary}
                  keyboardType="email-address"
                  autoComplete="email"
                  autoCapitalize="none"
                  style={styles.input}
                />
                <TextInput
                  value={prenom}
                  onChangeText={setPrenom}
                  placeholder="Ton prénom pour le carnet des copains (facultatif)"
                  placeholderTextColor={colors.tertiary}
                  autoComplete="given-name"
                  maxLength={30}
                  style={styles.input}
                />
                {!checkout && <ActivityIndicator color={colors.accent} style={styles.padded} />}
                {/* Stripe exige un conteneur sans enfant : rien d'autre dedans. */}
                <View nativeID={PAYMENT_ID} />
                {refus && <Text style={styles.refus}>{refus}</Text>}
                <Pressable
                  onPress={pay}
                  disabled={!checkout || sending}
                  style={({ pressed }) => [styles.payer, (!checkout || sending) && styles.dimmed, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  {sending ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.payerText}>
                      Payer {euros(choisi?.prix_cents ?? 0)}
                    </Text>
                  )}
                </Pressable>
                <Pressable onPress={() => setPaying(null)} disabled={sending} accessibilityRole="button">
                  <Text style={styles.changed}>Changer d'avis</Text>
                </Pressable>
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

const PAYMENT_ID = 'comptoir-paiement';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Les champs Stripe aux couleurs de la page (lin, bois, armagnac).
const APPEARANCE: Appearance = {
  theme: 'flat',
  variables: {
    colorPrimary: colors.accent,
    colorBackground: colors.background,
    colorText: colors.text,
    colorTextSecondary: colors.secondary,
    colorTextPlaceholder: colors.tertiary,
    colorDanger: colors.failed,
    fontFamily: FONT,
    fontSizeBase: '16px',
    borderRadius: '12px',
  },
  rules: {
    '.Input': { border: `1px solid ${colors.separator}`, padding: '13px 14px' },
    '.Input:focus': { borderColor: colors.accent, boxShadow: 'none' },
    '.Tab': { border: `1px solid ${colors.separator}`, backgroundColor: colors.background },
    '.Tab--selected': { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    '.Label': { color: colors.secondary, fontWeight: '500' },
  },
};
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
  dimmed: { opacity: 0.4 },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
    outlineColor: colors.accent,
  },
  refus: { color: colors.failed, fontSize: 15, lineHeight: 21 },
  payer: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  payerText: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  changed: { color: colors.tertiary, fontSize: 14, textDecorationLine: 'underline', textAlign: 'center' },
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
