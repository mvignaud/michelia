import { loadStripe, type Appearance, type StripeCheckoutElementsSdk } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { euros, loadComptoir, reloadComptoir, type Comptoir as Data } from './comptoir';
import { isMember, loadProfile } from './auth';
import { getCaptchaToken } from './captcha';
import { BarreMichel, CarnetDesCopains, CarteMerci, ComptoirBientot, NoteDuMois } from './Blocs';
import { pageSecure } from './carte';
import { CadreBanque, ChampsCarte, champ, PageCarte } from './CarteFields.web';
import { ecran, ecranComptoir, ecranPaiement } from './ecran';
import { getAccessToken, supabase } from './supabase';
import { colors } from './theme';

// Page /comptoir (web seulement) : les pourboires, payés dans notre propre formulaire. Seuls les champs
// de paiement viennent du prestataire : Stripe (Payment Element d'une session Checkout ui_mode elements)
// ou Stancer : notre propre formulaire de carte (envoyé à la fonction, qui le transmet à Stancer sans le
// garder), puis la page de la banque en iframe si elle demande le 3D Secure. Le paiement est relu côté
// serveur avant d'être inscrit.
export function Comptoir(_props: { onClose?: () => void }) {
  return <PageCarte Page={Page} />;
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
      <BarreMichel
        titre="Le comptoir de Michel"
        retour="Parler à Michel"
        onPress={() => window.location.assign('/chat')}
        accessibilityRole="link"
      />
      <ScrollView contentContainerStyle={styles.content}>
        {!data && !failed && <ActivityIndicator color={colors.accent} style={styles.padded} />}
        {(failed || (data && !ouvert)) && (
          <ComptoirBientot />
        )}
        {data && ouvert && (
          <>
            {merci && <CarteMerci>{merci}</CarteMerci>}
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
                    <ChampsCarte {...{ numero, setNumero, expiration, setExpiration, cvc, setCvc }} />
                    <Text style={styles.small}>Paiement sécurisé par Stancer. Ta carte n'est jamais gardée chez Michel.</Text>
                  </>
                )}
                {secure && <CadreBanque src={secure} hauteur={hauteur} />}
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

            <NoteDuMois note={data.note_du_mois} />

            <CarnetDesCopains carnet={data.carnet} />
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

const styles = StyleSheet.create({
  ...ecran,
  ...ecranPaiement,
  ...ecranComptoir,
  screen: { flex: 1, backgroundColor: colors.background },
  input: champ,
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
  link: { color: colors.tertiary, fontSize: 12, textDecorationLine: 'underline' },
});
