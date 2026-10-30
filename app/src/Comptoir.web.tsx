import { loadStripe, type Appearance, type StripeCheckoutElementsSdk } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { euros, loadComptoir, reloadComptoir, type Comptoir as Data } from './comptoir';
import { isMember, loadProfile } from './auth';
import { getCaptchaToken } from './captcha';
import { formatExpiration, formatNumero, pageSecure } from './carte';
import { getAccessToken, supabase } from './supabase';
import { colors, serif } from './theme';

// Page /comptoir (web seulement) : les pourboires, payés dans notre propre formulaire. Seuls les champs
// de paiement viennent du prestataire : Stripe (Payment Element d'une session Checkout ui_mode elements)
// ou Stancer : notre propre formulaire de carte (envoyé à la fonction, qui le transmet à Stancer sans le
// garder), puis la page de la banque en iframe si elle demande le 3D Secure. Le paiement est relu côté
// serveur avant d'être inscrit.
export function Comptoir(_props: { onClose?: () => void }) {
  // Retour du 3D Secure chargé dans son propre cadre : on prévient la page autour, qui vérifie le
  // paiement auprès du serveur et affiche le résultat.
  if (window.top !== window.self) {
    try {
      window.parent.postMessage({ status: 'retour-3ds' }, window.location.origin);
    } catch {
      // La vérification régulière de la page prendra le relais.
    }
    return <Text style={[styles.text, styles.padded]}>Je vérifie avec ta banque, deux secondes…</Text>;
  }
  // Arrivé ici depuis une page où la mesure d'audience tourne déjà (même document) : on recharge, pour
  // que les champs de carte vivent dans une page sans aucun script tiers.
  if ('gtag' in window) {
    window.location.replace(window.location.href);
    return null;
  }
  return <Page />;
}

function Page() {
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
  // Stancer : le paiement ouvert (payment intent), la carte en cours de saisie (jamais gardée après
  // l'envoi), et la page 3D Secure de la banque quand elle en demande une.
  const [intent, setIntent] = useState<string>();
  const [numero, setNumero] = useState('');
  const [expiration, setExpiration] = useState('');
  const [cvc, setCvc] = useState('');
  const [secure, setSecure] = useState<string>();
  // Paiement carte (API v1 de Stancer) en cours de 3D Secure, relu par le serveur avec l'intent.
  const [paiementCarte, setPaiementCarte] = useState<string>();
  const [hauteur, setHauteur] = useState(480);
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
  const avecStancer = data?.prestataire === 'stancer';
  const essai = avecStancer && !!data?.essai && new URLSearchParams(window.location.search).has('essai');
  const ouvert = !!data?.actif || essai;
  const cle = avecStancer ? undefined : data?.stripe_cle_publique;
  useEffect(() => {
    setCheckout(undefined);
    setIntent(undefined);
    setSecure(undefined);
    setPaiementCarte(undefined);
    setNumero('');
    setExpiration('');
    setCvc('');
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

  const merciRecu = (id: string) => {
    setThanks(id);
    setPaying(null);
    reloadComptoir().then(setData).catch(() => {});
  };

  // Stancer, 3D Secure : la page de la banque prévient par postMessage (taille, statut) ; on vérifie
  // aussi régulièrement côté serveur, au cas où le message n'arrive pas. Le serveur relit chez Stancer.
  useEffect(() => {
    if (!secure || !intent || !paying) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const confirmer = async () => {
      if (stopped) return;
      clearTimeout(timer);
      try {
        const { data: result } = await supabase.functions.invoke('comptoir-paiement', {
          body: { confirmer: intent, ...(paiementCarte ? { carte: paiementCarte } : {}) },
        });
        if (stopped) return;
        if (result?.etat === 'paye') return merciRecu(result.palier ?? paying);
        if (result?.etat === 'refuse') {
          setRefus("La carte n'est pas passée. Tu peux réessayer, ou en prendre une autre.");
          setSecure(undefined);
          setPaiementCarte(undefined);
          setIntent(undefined);
          return;
        }
      } catch {
        // Réseau capricieux : on réessaie au prochain tour.
      }
      if (++tries < 60) timer = setTimeout(confirmer, 4000);
    };
    timer = setTimeout(confirmer, 4000);
    const onMessage = (event: MessageEvent) => {
      // Notre propre page, rechargée dans le cadre au retour de la banque.
      if (event.origin === window.location.origin && event.data?.status === 'retour-3ds') return confirmer();
      if (event.origin !== STANCER_ORIGIN) return;
      let message = event.data;
      if (typeof message === 'string') {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      const height = Number(message?.height);
      if (Number.isFinite(height) && height > 100 && height < 2000) setHauteur(Math.ceil(height));
      if (message?.status === 'finished') confirmer();
      if (message?.status === 'error' || message?.status === 'secure-auth-error') {
        setRefus("La carte n'est pas passée. Tu peux réessayer, ou en prendre une autre.");
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [secure, intent, paying, paiementCarte]);

  const pay = async () => {
    if (!paying || sending || (!checkout && !avecStancer)) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setRefus("Il me faut ton e-mail pour t'envoyer le reçu.");
      return;
    }
    if (avecStancer) return payerCarte();
    if (!checkout) return;
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
      merciRecu(paying);
    } catch (e) {
      console.error('Comptoir : paiement impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  // Stancer : le paiement est créé au prix du palier (côté serveur), puis la carte part à la fonction,
  // qui la transmet à Stancer. Il faut une session (compte anonyme, avec le captcha Turnstile).
  const payerCarte = async () => {
    const date = expiration.replace(/\s/g, '').match(/^(\d{1,2})\/?(\d{2}|\d{4})$/);
    const chiffres = numero.replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(chiffres) || !date || !/^\d{3,4}$/.test(cvc.trim())) {
      setRefus('Vérifie le numéro de carte, la date (MM/AA) et le code au dos.');
      return;
    }
    setSending(true);
    setRefus(null);
    try {
      await getAccessToken();
      let id = intent;
      if (!id) {
        const { data: ouvert, error } = await supabase.functions.invoke('comptoir-paiement', {
          body: { palier: paying, email: email.trim(), prenom: prenom.trim() },
        });
        if (error || typeof ouvert?.id !== 'string') throw new Error('Paiement refusé');
        id = ouvert.id as string;
        setIntent(id);
      }
      const captcha = await getCaptchaToken();
      const { data: result, error } = await supabase.functions.invoke('comptoir-paiement', {
        body: {
          payer: id,
          captcha,
          carte: { numero: chiffres, mois: Number(date[1]), annee: Number(date[2]), cvc: cvc.trim() },
        },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 429) {
        setIntent(undefined);
        return setRefus("Trop d'essais d'un coup. Reviens dans une heure, je bouge pas.");
      }
      if (statut === 400) return setRefus('Vérifie le numéro de carte, la date (MM/AA) et le code au dos.');
      if (error) throw error;
      if (result?.etat === 'paye') return merciRecu(result.palier ?? paying!);
      if (result?.etat === 'authentification' && pageSecure(result.url)) {
        setPaiementCarte(typeof result.paiement === 'string' ? result.paiement : undefined);
        return setSecure(result.url);
      }
      if (result?.etat === 'refuse') {
        // Un payment intent refusé ne resservira pas : le prochain essai en ouvre un neuf.
        setIntent(undefined);
        return setRefus("La carte n'est pas passée. Tu peux réessayer, ou en prendre une autre.");
      }
      // En attente : la vérification régulière prend le relais.
      setSecure(undefined);
      setRefus('Je vérifie le paiement auprès de la banque, deux secondes…');
    } catch (e) {
      console.error('Comptoir : paiement impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      // La carte ne reste jamais dans la page après un envoi, quoi qu'il arrive : il faudra la retaper.
      setNumero('');
      setExpiration('');
      setCvc('');
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
          <Pressable onPress={() => window.location.assign('/chat')} accessibilityRole="link">
            <Text style={styles.back}>Parler à Michel</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
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
                {essai && <Text style={styles.refus}>Mode essai : carte de test seulement, aucun argent réel.</Text>}
                <TextInput
                  value={email}
                  editable={!intent}
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
                  editable={!intent}
                  onChangeText={setPrenom}
                  placeholder="Ton prénom pour le carnet des copains (facultatif)"
                  placeholderTextColor={colors.tertiary}
                  autoComplete="given-name"
                  maxLength={30}
                  style={styles.input}
                />
                {!avecStancer && !checkout && <ActivityIndicator color={colors.accent} style={styles.padded} />}
                {/* Stripe exige un conteneur sans enfant : rien d'autre dedans. */}
                {!avecStancer && <View nativeID={PAYMENT_ID} />}
                {avecStancer && !secure && (
                  <>
                    <TextInput
                      value={numero}
                      onChangeText={(t) => setNumero(formatNumero(t))}
                      placeholder="Numéro de carte"
                      placeholderTextColor={colors.tertiary}
                      keyboardType="number-pad"
                      autoComplete="cc-number"
                      style={styles.input}
                    />
                    <View style={styles.row}>
                      <TextInput
                        value={expiration}
                        onChangeText={(t) => setExpiration(formatExpiration(t))}
                        placeholder="MM/AA"
                        placeholderTextColor={colors.tertiary}
                        keyboardType="number-pad"
                        autoComplete="cc-exp"
                        style={[styles.input, styles.half]}
                      />
                      <TextInput
                        value={cvc}
                        onChangeText={(t) => setCvc(t.replace(/\D/g, '').slice(0, 4))}
                        placeholder="Code au dos"
                        placeholderTextColor={colors.tertiary}
                        keyboardType="number-pad"
                        autoComplete="cc-csc"
                        secureTextEntry
                        style={[styles.input, styles.half]}
                      />
                    </View>
                    <Text style={styles.small}>Paiement sécurisé par Stancer. Ta carte n'est jamais gardée chez Michel.</Text>
                  </>
                )}
                {secure && (
                  <iframe
                    src={secure}
                    title="Vérification de ta banque"
                    allow="payment"
                    style={{ width: '100%', height: hauteur, border: 0, borderRadius: 12, backgroundColor: colors.background }}
                  />
                )}
                {refus && <Text style={styles.refus}>{refus}</Text>}
                {!secure && (
                  <Pressable
                    onPress={pay}
                    disabled={(!avecStancer && !checkout) || sending}
                    style={({ pressed }) => [
                      styles.payer,
                      ((!avecStancer && !checkout) || sending) && styles.dimmed,
                      pressed && styles.pressed,
                    ]}
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
                )}
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

// Les champs de carte Stancer viennent de là, et leurs messages aussi.
const STANCER_ORIGIN = 'https://payment.stancer.com';
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
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minWidth: 0 },
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
