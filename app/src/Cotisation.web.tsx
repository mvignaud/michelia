import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { isMember } from './auth';
import { getCaptchaToken } from './captcha';
import { carteSaisie, formatExpiration, formatNumero, pageSecure } from './carte';
import { euros } from './comptoir';
import { supabase } from './supabase';
import { colors, serif } from './theme';

// Page /la-cotisation (web seulement) : l'abonnement MichelIA+ par carte ou prélèvement SEPA. Comme au
// comptoir, la carte est tapée dans notre formulaire et part à la fonction michelia-plus, qui la
// transmet à Stancer sans la garder ; la banque demande ensuite son 3D Secure dans un cadre. Le
// prélèvement, lui, se signe sur la page Stancer (IBAN et code SMS), qui revient ici
// (?retour=sepa). Il faut un compte Michel.
export function Cotisation(_props: { onClose?: () => void }) {
  // Retour du 3D Secure chargé dans son propre cadre : on prévient la page autour.
  if (window.top !== window.self) {
    try {
      window.parent.postMessage({ status: 'retour-3ds' }, window.location.origin);
    } catch {
      // La vérification régulière de la page prendra le relais.
    }
    return <Text style={[styles.text, styles.padded]}>Je vérifie avec ta banque, deux secondes…</Text>;
  }
  // Pas de mesure d'audience là où l'on tape sa carte : on recharge la page si elle tourne déjà.
  if ('gtag' in window) {
    window.location.replace(window.location.href);
    return null;
  }
  return <Page />;
}

type Offre = { actif: boolean; mois_cents: number | null; an_cents: number | null };
type Abonnement = {
  actif: boolean;
  source: 'web' | 'apple' | 'google';
  formule: 'mois' | 'an';
  moyen: 'carte' | 'sepa' | null;
  statut: 'actif' | 'impaye' | 'resilie';
  prix_cents: number;
  fin_periode: string | null;
  derniers_chiffres: string | null;
};

// Le premier prélèvement SEPA parti sur la page Stancer, relu au retour (onglet seulement).
const CLE_SEPA = 'michelia-plus-sepa';
const lireSepa = () => {
  try {
    return sessionStorage.getItem(CLE_SEPA) ?? undefined;
  } catch {
    return undefined;
  }
};

const jour = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

function Page() {
  const [offre, setOffre] = useState<Offre>();
  const [membre, setMembre] = useState<boolean>();
  const [abonnement, setAbonnement] = useState<Abonnement | null>();
  const [failed, setFailed] = useState(false);
  const [formule, setFormule] = useState<'mois' | 'an'>('mois');
  const [moyen, setMoyen] = useState<'carte' | 'sepa'>('carte');
  const [numero, setNumero] = useState('');
  const [expiration, setExpiration] = useState('');
  const [cvc, setCvc] = useState('');
  const [accepte, setAccepte] = useState(false);
  const [sending, setSending] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  // Le premier paiement en cours de 3D Secure, et la page de la banque.
  // Ou le premier prélèvement SEPA, de retour de la page Stancer.
  const [paiement, setPaiement] = useState<string | undefined>(() =>
    new URLSearchParams(window.location.search).get('retour') === 'sepa' ? lireSepa() : undefined,
  );
  const [secure, setSecure] = useState<string>();
  const [hauteur, setHauteur] = useState(480);
  const [bienvenue, setBienvenue] = useState(false);
  const [resiliation, setResiliation] = useState(false);

  const recharger = async () => {
    const { data: auth } = await supabase.auth.getSession();
    const estMembre = isMember(auth.session);
    setMembre(estMembre);
    const [{ data: o, error }, mien] = await Promise.all([
      supabase.rpc('michelia_plus_public'),
      estMembre ? supabase.rpc('mon_abonnement') : Promise.resolve({ data: null }),
    ]);
    if (error) throw error;
    setOffre(o as Offre);
    setAbonnement((mien.data as Abonnement | null) ?? null);
  };

  useEffect(() => {
    recharger().catch(() => setFailed(true));
  }, []);

  // 3D Secure : la page de la banque revient dans le cadre (message « retour-3ds ») ; on vérifie aussi
  // régulièrement côté serveur, au cas où le message n'arrive pas. Le serveur relit chez Stancer.
  useEffect(() => {
    if (!paiement) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const confirmer = async () => {
      if (stopped) return;
      clearTimeout(timer);
      try {
        const { data: result } = await supabase.functions.invoke('michelia-plus', { body: { confirmer: paiement } });
        if (stopped) return;
        if (result?.etat === 'paye') return bienvenu();
        if (result?.etat === 'refuse') {
          setRefus(
            paiement.startsWith('pi_')
              ? "Le mandat n'est pas signé, rien n'est prélevé. Tu peux réessayer, ou payer par carte."
              : "La carte n'est pas passée. Tu peux réessayer, ou en prendre une autre.",
          );
          oublierSepa();
          setSecure(undefined);
          setPaiement(undefined);
          return;
        }
      } catch {
        // Réseau capricieux : on réessaie au prochain tour.
      }
      if (++tries < 60) timer = setTimeout(confirmer, 4000);
      else if (paiement.startsWith('pi_')) {
        // La banque prend son temps : Michel relit le prélèvement de son côté, toutes les heures.
        setRefus("Stancer n'a pas encore confirmé ton mandat. Je vérifie de mon côté, reviens dans un moment.");
        setPaiement(undefined);
      }
    };
    timer = setTimeout(confirmer, 4000);
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.status === 'retour-3ds') return confirmer();
      const height = Number(event.data?.height);
      if (Number.isFinite(height) && height > 100 && height < 2000) setHauteur(Math.ceil(height));
    };
    window.addEventListener('message', onMessage);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [paiement]);

  const oublierSepa = () => {
    try {
      sessionStorage.removeItem(CLE_SEPA);
    } catch {
      // Rien à oublier.
    }
  };

  const bienvenu = () => {
    oublierSepa();
    setSecure(undefined);
    setPaiement(undefined);
    setRefus(null);
    setBienvenue(true);
    recharger().catch(() => {});
  };

  // Prélèvement : on part signer le mandat sur la page Stancer, qui revient ici.
  const signerMandat = async () => {
    if (sending) return;
    if (!accepte) return setRefus("Coche la case des conditions, c'est la loi, con.");
    setSending(true);
    setRefus(null);
    try {
      const captcha = await getCaptchaToken();
      const { data: result, error } = await supabase.functions.invoke('michelia-plus', {
        body: { souscrire: formule, moyen: 'sepa', captcha },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 429) return setRefus("Trop d'essais d'un coup. Reviens dans une heure, je bouge pas.");
      if (statut === 409) return recharger();
      if (error) throw error;
      if (result?.etat === 'mandat' && pageSecure(result.url) && typeof result.paiement === 'string') {
        try {
          sessionStorage.setItem(CLE_SEPA, result.paiement);
        } catch {
          // Sans stockage, le serveur relit quand même le prélèvement toutes les heures.
        }
        return window.location.assign(result.url);
      }
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } catch (e) {
      console.error('MichelIA+ : prélèvement impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  const souscrire = async () => {
    if (sending) return;
    const carte = carteSaisie(numero, expiration, cvc);
    if (!carte) return setRefus('Vérifie le numéro de carte, la date (MM/AA) et le code au dos.');
    if (!accepte) return setRefus("Coche la case des conditions, c'est la loi, con.");
    setSending(true);
    setRefus(null);
    try {
      const captcha = await getCaptchaToken();
      const { data: result, error } = await supabase.functions.invoke('michelia-plus', {
        body: { souscrire: formule, carte, captcha },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 429) return setRefus("Trop d'essais d'un coup. Reviens dans une heure, je bouge pas.");
      if (statut === 400) return setRefus('Vérifie le numéro de carte, la date (MM/AA) et le code au dos.');
      if (statut === 409) return recharger();
      if (error) throw error;
      if (result?.etat === 'paye') return bienvenu();
      if (result?.etat === 'authentification' && pageSecure(result.url) && typeof result.paiement === 'string') {
        setPaiement(result.paiement);
        return setSecure(result.url);
      }
      if (result?.etat === 'refuse') return setRefus("La carte n'est pas passée. Tu peux réessayer, ou en prendre une autre.");
      setRefus('Je vérifie le paiement auprès de la banque, deux secondes…');
    } catch (e) {
      console.error('MichelIA+ : souscription impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      // La carte ne reste jamais dans la page après un envoi.
      setNumero('');
      setExpiration('');
      setCvc('');
      setSending(false);
    }
  };

  const resilier = async () => {
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('michelia-plus', { body: { resilier: true } });
      if (error) throw error;
      setResiliation(false);
      await recharger();
    } catch (e) {
      console.error('MichelIA+ : résiliation impossible', e);
      setRefus("La résiliation n'est pas passée. Réessaie, ou écris à contact@michel.beer.");
    } finally {
      setSending(false);
    }
  };

  const reprendre = async () => {
    setSending(true);
    setRefus(null);
    try {
      const { error } = await supabase.functions.invoke('michelia-plus', { body: { reprendre: true } });
      if (error) throw error;
      await recharger();
    } catch (e) {
      console.error('MichelIA+ : reprise impossible', e);
      setRefus("La reprise n'est pas passée. Réessaie, ou écris à contact@michel.beer.");
    } finally {
      setSending(false);
    }
  };

  const prix = formule === 'mois' ? offre?.mois_cents : offre?.an_cents;
  const retourSepa = !!paiement?.startsWith('pi_');
  const essai = new URLSearchParams(window.location.search).has('essai');

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <View style={styles.avatar}>
            <Image source={require('../assets/brand/michel-portrait.png')} style={styles.avatarImage} accessibilityLabel="Michel" />
          </View>
          <Text style={styles.title}>MichelIA+</Text>
          <Pressable onPress={() => window.location.assign('/chat')} accessibilityRole="link">
            <Text style={styles.back}>Retour au chat</Text>
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
        {!offre && !failed && <ActivityIndicator color={colors.accent} />}

        {bienvenue && (
          <View style={[styles.card, styles.thanks]}>
            <Text style={styles.thanksText}>Bienvenue au club ! Té, tu es des nôtres.</Text>
          </View>
        )}

        {offre && abonnement && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ta cotisation</Text>
            <Text style={styles.text}>
              MichelIA+ {abonnement.formule === 'mois' ? 'au mois' : "à l'année"}, {euros(abonnement.prix_cents)}
              {abonnement.moyen === 'carte' && abonnement.derniers_chiffres ? `, carte •••• ${abonnement.derniers_chiffres}` : ''}
              {abonnement.moyen === 'sepa' ? `, prélèvement${abonnement.derniers_chiffres ? ` sur le compte •••• ${abonnement.derniers_chiffres}` : ''}` : ''}.
            </Text>
            {abonnement.statut === 'actif' && (
              <Text style={styles.text}>
                Prochaine échéance le {jour(abonnement.fin_periode)}
                {abonnement.moyen === 'sepa' ? `, ${euros(abonnement.prix_cents)} prélevés sur ton compte` : ''}.
              </Text>
            )}
            {abonnement.statut === 'impaye' && (
              <Text style={styles.refus}>
                La dernière échéance n'est pas passée. Je réessaie dans quelques jours ; vérifie{' '}
                {abonnement.moyen === 'sepa' ? 'ton compte' : 'ta carte'} en attendant.
              </Text>
            )}
            {abonnement.statut === 'resilie' && (
              <Text style={styles.text}>Résiliée : MichelIA+ reste jusqu'au {jour(abonnement.fin_periode)}, puis plus rien n'est prélevé.</Text>
            )}
            {abonnement.source === 'web' && abonnement.statut === 'resilie' && (
              <>
                <Text style={styles.small}>
                  Tu regrettes déjà ? Reprends ta cotisation : rien n'est prélevé aujourd'hui, elle repart le {jour(abonnement.fin_periode)}, {abonnement.moyen === 'sepa' ? 'sur le même compte' : 'sur la même carte'}.
                </Text>
                <Pressable onPress={reprendre} disabled={sending} style={({ pressed }) => [styles.payer, pressed && styles.pressed]} accessibilityRole="button">
                  {sending ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.payerText}>Reprendre ma cotisation</Text>}
                </Pressable>
              </>
            )}
            {abonnement.source !== 'web' && (
              <Text style={styles.small}>
                Prise dans l'appli : elle se gère dans {abonnement.source === 'apple' ? "l'App Store" : 'Google Play'}.
              </Text>
            )}
            {abonnement.source === 'web' && abonnement.statut !== 'resilie' && !resiliation && (
              <Pressable onPress={() => setResiliation(true)} accessibilityRole="button">
                <Text style={styles.changed}>Résilier</Text>
              </Pressable>
            )}
            {refus && <Text style={styles.refus}>{refus}</Text>}
            {resiliation && (
              <>
                <Text style={styles.text}>
                  Tu arrêtes ? Rien ne sera plus prélevé, et MichelIA+ reste jusqu'au {jour(abonnement.fin_periode)}.
                </Text>
                <Pressable onPress={resilier} disabled={sending} style={({ pressed }) => [styles.payer, pressed && styles.pressed]} accessibilityRole="button">
                  {sending ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.payerText}>Confirmer la résiliation</Text>}
                </Pressable>
                <Pressable onPress={() => setResiliation(false)} accessibilityRole="button">
                  <Text style={styles.changed}>Je reste</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {offre && abonnement === null && !offre.actif && !essai && (
          <Text style={styles.text}>La cotisation n'est pas encore ouverte. Ça mijote, reviens bientôt !</Text>
        )}

        {offre && abonnement === null && (offre.actif || essai) && membre === false && (
          <View style={styles.card}>
            <Text style={styles.text}>Pour cotiser, il te faut un compte Michel : c'est là que je range ta cotisation et tes reçus.</Text>
            <Pressable onPress={() => window.location.assign('/chat?compte=connexion')} style={({ pressed }) => [styles.payer, pressed && styles.pressed]} accessibilityRole="link">
              <Text style={styles.payerText}>Me connecter ou créer un compte</Text>
            </Pressable>
          </View>
        )}

        {offre && abonnement === null && (offre.actif || essai) && membre && !bienvenue && (
          <View style={styles.card}>
            <View style={styles.row}>
              {(['mois', 'an'] as const).map((f) => {
                const p = f === 'mois' ? offre.mois_cents : offre.an_cents;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFormule(f)}
                    disabled={!!secure || retourSepa}
                    style={[styles.formule, formule === f && styles.formuleChoisie]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: formule === f }}
                  >
                    <Text style={[styles.formuleNom, formule === f && styles.formuleNomChoisi]}>{f === 'mois' ? 'Au mois' : "À l'année"}</Text>
                    <Text style={[styles.formulePrix, formule === f && styles.formuleNomChoisi]}>
                      {p ? `${euros(p)} / ${f}` : '—'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!secure && !retourSepa && (
              <View style={styles.row}>
                {(['carte', 'sepa'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMoyen(m);
                      setRefus(null);
                    }}
                    style={[styles.formule, moyen === m && styles.formuleChoisie]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: moyen === m }}
                  >
                    <Text style={[styles.formuleNom, moyen === m && styles.formuleNomChoisi]}>{m === 'carte' ? 'Par carte' : 'Par prélèvement'}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {retourSepa && <Text style={styles.text}>Je relis ton mandat chez Stancer, deux secondes…</Text>}
            {!secure && !retourSepa && moyen === 'sepa' && (
              <>
                <Text style={styles.small}>
                  Tu tapes ton IBAN sur la page de Stancer, jamais chez Michel, et tu signes le mandat avec le code reçu par SMS. Le
                  premier prélèvement part tout de suite, puis à la même date {formule === 'mois' ? 'chaque mois' : 'chaque année'}.
                </Text>
                <Pressable onPress={() => setAccepte((a) => !a)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: accepte }}>
                  <Text style={styles.case}>{accepte ? '☑' : '☐'}</Text>
                  <Text style={[styles.small, styles.half]}>
                    J'accepte les{' '}
                    <Text style={styles.link} onPress={() => window.open('/conditions.html', '_blank')}>
                      conditions
                    </Text>{' '}
                    et je demande que MichelIA+ commence tout de suite : je renonce à mon délai de rétractation de 14 jours.
                    J'autorise GOLDEN PRINT à prélever {prix ? euros(prix) : 'le prix affiché'} {formule === 'mois' ? 'chaque mois' : 'chaque année'} à
                    la date anniversaire : ce rappel vaut avis de prélèvement. Résiliable ici en deux clics.
                  </Text>
                </Pressable>
              </>
            )}
            {!secure && !retourSepa && moyen === 'carte' && (
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
                <Pressable onPress={() => setAccepte((a) => !a)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: accepte }}>
                  <Text style={styles.case}>{accepte ? '☑' : '☐'}</Text>
                  <Text style={[styles.small, styles.half]}>
                    J'accepte les{' '}
                    <Text style={styles.link} onPress={() => window.open('/conditions.html', '_blank')}>
                      conditions
                    </Text>{' '}
                    et je demande que MichelIA+ commence tout de suite : je renonce à mon délai de rétractation de 14 jours.
                    Renouvelé {formule === 'mois' ? 'chaque mois' : 'chaque année'}, résiliable ici en deux clics.
                  </Text>
                </Pressable>
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
            {!secure && !retourSepa && (
              <Pressable
                onPress={moyen === 'sepa' ? signerMandat : souscrire}
                disabled={sending || !prix}
                style={({ pressed }) => [styles.payer, (sending || !prix) && styles.dimmed, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {sending ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.payerText}>
                    {moyen === 'sepa' ? 'Signer le mandat' : 'Cotiser'} {prix ? euros(prix) : ''}
                  </Text>
                )}
              </Pressable>
            )}
            <Text style={styles.small}>
              Paiement sécurisé par Stancer. {moyen === 'sepa' ? "Ton IBAN n'est jamais gardé chez Michel." : "Ta carte n'est jamais gardée chez Michel."}
            </Text>
          </View>
        )}

        <Text style={styles.small}>
          Abonnement encaissé par GOLDEN PRINT SAS.{' '}
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
  small: { color: colors.tertiary, fontSize: 13, lineHeight: 19 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  case: { color: colors.accent, fontSize: 20, lineHeight: 22 },
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
