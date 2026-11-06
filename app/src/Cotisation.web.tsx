import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { isMember } from './auth';
import { getCaptchaToken } from './captcha';
import { BarreMichel, CarteMerci, PitchCotisation } from './Blocs';
import { carteSaisie, pageSecure } from './carte';
import { CadreBanque, ChampsCarte, champ, PageCarte } from './CarteFields.web';
import { euros } from './comptoir';
import { ecran, ecranCotisation, ecranPaiement } from './ecran';
import { COUNTRIES, type Country, flag, fullPhone } from './PhoneField';
import { supabase } from './supabase';
import { colors } from './theme';

// Page /la-cotisation (web seulement) : l'abonnement MichelIA+ par carte ou prélèvement SEPA. Comme au
// comptoir, la carte est tapée dans notre formulaire et part à la fonction michelia-plus, qui la
// transmet à Stancer sans la garder ; la banque demande ensuite son 3D Secure dans un cadre. Le
// prélèvement se signe ici aussi : IBAN, titulaire et mobile, puis le code que Michel envoie par SMS.
// Les anciens retours de la page Stancer (?retour=sepa) sont encore relus. Il faut un compte Michel.
export function Cotisation(_props: { onClose?: () => void }) {
  return <PageCarte Page={Page} />;
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
  // Code promo en cours : prix normal, et échéances remisées qui restent (null : toutes).
  remise_pct?: number | null;
  prix_plein_cents?: number | null;
  remise_restante?: number | null;
};
// Code promo vérifié par code_promo_verifier : prix remisés des formules qu'il vise.
type Promo = { code: string; remise_pct: number; formule: 'mois' | 'an' | null; periodes: number | null; mois_cents: number | null; an_cents: number | null };

const REFUS_PROMO: Record<string, string> = {
  inconnu: "Connais pas ce code. Vérifie l'orthographe, con.",
  perime: "Ce code n'est plus bon (ou pas encore).",
  deja: 'Tu as déjà profité de ce code.',
  epuise: 'Trop tard, ce code a déjà tout servi.',
  formule: "Ce code ne marche pas sur cette formule.",
  compte: 'Connecte-toi pour utiliser un code promo.',
  moyen: 'Avec ce code, il me faut une carte ou un compte pour la suite.',
};
// « les 3 premiers mois », « la première année », ou rien si la remise dure tout l'abonnement.
export const dureeRemise = (formule: 'mois' | 'an', periodes: number | null | undefined) =>
  !periodes
    ? ''
    : formule === 'mois'
      ? periodes === 1 ? 'le premier mois' : `les ${periodes} premiers mois`
      : periodes === 1 ? 'la première année' : `les ${periodes} premières années`;

// Ancien parcours : le premier prélèvement SEPA parti sur la page Stancer, relu au retour (onglet seulement).
const CLE_SEPA = 'michelia-plus-sepa';
const lireSepa = () => {
  try {
    return sessionStorage.getItem(CLE_SEPA) ?? undefined;
  } catch {
    return undefined;
  }
};

// Saisie du prélèvement : contrôles rapides avant envoi, le serveur revérifie tout (clé de l'IBAN comprise).
const formatIban = (t: string) =>
  t.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 34).replace(/(.{4})/g, '$1 ').trim();
const ibanSaisi = (t: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t.replace(/\s/g, ''));
// Mobile : le pays (drapeau et indicatif) se choisit à part, ou se devine quand on colle un +33… ou 0033….
// En France et outre-mer, le numéro s'affiche par paires et doit avoir ses 9 chiffres (06 / 07 ou 6 / 7).
const PAIRES = new Set(['+33', '+262', '+590', '+596', '+594']);
const paysDevine = (t: string) => {
  const chiffres = t.replace(/^00/, '+').replace(/[^\d+]/g, '');
  if (!chiffres.startsWith('+')) return null;
  // L'indicatif le plus long qui colle (+262 avant +2…), la France d'abord pour +33.
  const pays = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => chiffres.startsWith(c.dial));
  return pays ? { pays, reste: chiffres.slice(pays.dial.length) } : null;
};
const formatMobile = (pays: Country, t: string) => {
  const chiffres = t.replace(/\D/g, '');
  if (!PAIRES.has(pays.dial)) return chiffres.slice(0, 14).replace(/(\d{3})(?=\d)/g, '$1 ');
  const local = chiffres.slice(0, chiffres.startsWith('0') ? 10 : 9);
  if (!local || local.startsWith('0')) return local.replace(/(\d{2})(?=\d)/g, '$1 ');
  return `${local[0]} ${local.slice(1).replace(/(\d{2})(?=\d)/g, '$1 ')}`.trim();
};
const mobileSaisi = (pays: Country, t: string) => {
  const numero = fullPhone(pays, t);
  if (pays.dial === '+33') return /^\+33[67]\d{8}$/.test(numero);
  if (PAIRES.has(pays.dial)) return new RegExp(`^\\${pays.dial}\\d{9}$`).test(numero);
  return /^\+[1-9]\d{7,14}$/.test(numero);
};

// Le corps d'une réponse d'erreur de la fonction (champ fautif, essais restants).
const corpsErreur = async (error: unknown): Promise<Record<string, unknown> | null> => {
  try {
    const res = (error as { context?: Response } | null)?.context;
    return res && typeof res.json === 'function' ? await res.clone().json() : null;
  } catch {
    return null;
  }
};
const champEnErreur = async (error: unknown) => {
  const champ = (await corpsErreur(error))?.champ;
  return typeof champ === 'string' ? champ : null;
};
const essaisRestants = async (error: unknown) => {
  const n = (await corpsErreur(error))?.essais_restants;
  return typeof n === 'number' ? n : null;
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
  // Prélèvement : IBAN, titulaire et mobile, puis le code reçu par SMS qui signe le mandat.
  const [iban, setIban] = useState('');
  const [titulaire, setTitulaire] = useState('');
  const [mobile, setMobile] = useState('');
  const [pays, setPays] = useState<Country>(COUNTRIES[0]);
  const [code, setCode] = useState('');
  const [codeEnvoye, setCodeEnvoye] = useState<string | null>(null);
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
  // Changer de carte ou de compte, sur une cotisation déjà prise sur le site.
  const [changement, setChangement] = useState(false);
  const [change, setChange] = useState(false);
  // Code promo : tapé (ou venu de l'adresse, ?code=…), puis vérifié.
  const [codePromo, setCodePromo] = useState(() => (new URLSearchParams(window.location.search).get('code') ?? '').slice(0, 30));
  const [promoOuvert, setPromoOuvert] = useState(() => new URLSearchParams(window.location.search).has('code'));
  const [promo, setPromo] = useState<Promo | null>(null);
  const [promoRefus, setPromoRefus] = useState<string | null>(null);

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
        const { data: result } = await supabase.functions.invoke('michelia-plus', {
          body: changement ? { confirmer_changement: paiement } : { confirmer: paiement },
        });
        if (stopped) return;
        if (result?.etat === 'paye') return bienvenu();
        if (result?.etat === 'change') return changeFait();
        if (result?.etat === 'refuse') {
          setRefus(
            changement
              ? "La banque n'a pas validé cette carte. Rien n'a changé : essaies-en une autre."
              : paiement.startsWith('pi_')
              ? "Le mandat n'est pas signé, rien n'est prélevé. Tu peux réessayer, ou payer par carte."
              : moyen === 'sepa'
                ? "Le premier prélèvement n'est pas passé, rien n'est pris. Tu peux réessayer, ou payer par carte."
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
      else if (paiement.startsWith('pi_') || moyen === 'sepa') {
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
  }, [paiement]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Nouvelle carte ou nouveau compte enregistrés : les prochaines échéances partent dessus.
  const changeFait = () => {
    setSecure(undefined);
    setPaiement(undefined);
    setRefus(null);
    setIban('');
    setCode('');
    setCodeEnvoye(null);
    setChangement(false);
    setChange(true);
    recharger().catch(() => {});
  };

  const oublierMandat = () => {
    setIban('');
    setCode('');
    setCodeEnvoye(null);
  };

  const verifierCode = async (texte = codePromo) => {
    const saisi = texte.trim().toUpperCase();
    setPromoRefus(null);
    if (!saisi) return setPromo(null);
    try {
      const { data, error } = await supabase.rpc('code_promo_verifier', { p_code: saisi });
      if (error) throw error;
      if (!data?.valide) {
        setPromo(null);
        return setPromoRefus(REFUS_PROMO[data?.raison] ?? REFUS_PROMO.inconnu);
      }
      const p = data as Promo;
      setPromo(p);
      if (p.formule) setFormule(p.formule);
    } catch (e) {
      console.error('MichelIA+ : code promo illisible', e);
      setPromoRefus('Je ne peux pas vérifier le code pour l’instant, réessaie dans un moment.');
    }
  };

  // Code venu de l'adresse : vérifié dès que l'on sait que la personne a un compte.
  useEffect(() => {
    if (membre && codePromo && !promo && !promoRefus) verifierCode().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membre]);

  // Le code part avec la souscription seulement s'il vise la formule choisie.
  const avecCode = promo && (!promo.formule || promo.formule === formule) ? { code_promo: promo.code } : {};

  // Prélèvement, étape 1 : Michel vérifie l'IBAN et envoie le code de signature par SMS.
  const demanderCode = async () => {
    if (sending) return;
    if (!ibanSaisi(iban)) return setRefus("Vérifie l'IBAN : il commence par FR76 pour un compte français.");
    if (titulaire.trim().length < 3) return setRefus('Mets le nom du titulaire du compte, comme sur ton RIB.');
    if (!mobileSaisi(pays, mobile)) return setRefus(`Vérifie ton numéro de mobile ${flag(pays.code)} ${pays.dial} : il me faut le bon, pour t'envoyer le code.`);
    if (!accepte) return setRefus("Coche la case des conditions, c'est la loi, con.");
    setSending(true);
    setRefus(null);
    try {
      const captcha = await getCaptchaToken();
      const { data: result, error } = await supabase.functions.invoke('michelia-plus', {
        body: changement
          ? { changer: { moyen: 'sepa', iban, titulaire, telephone: fullPhone(pays, mobile), captcha } }
          : { souscrire: formule, moyen: 'sepa', iban, titulaire, telephone: fullPhone(pays, mobile), captcha, ...avecCode },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 429) return setRefus("Trop d'essais d'un coup. Reviens dans une heure, je bouge pas.");
      if (statut === 503) return setRefus("Mes SMS sont en panne pour l'instant. Réessaie plus tard, ou paie par carte.");
      if (statut === 409) {
        if ((await corpsErreur(error))?.error === 'Signature déjà en cours')
          return setRefus('Une signature est déjà en route dans un autre onglet. Attends deux minutes, puis recharge la page.');
        return recharger();
      }
      if (statut === 400 || statut === 502) {
        const champ = await champEnErreur(error);
        if (champ === 'code_promo') return refusPromo(error);
        if (champ === 'iban') return setRefus("Cet IBAN ne passe pas. Vérifie-le sur ton RIB (zone SEPA seulement).");
        if (champ === 'titulaire') return setRefus('Mets le nom du titulaire du compte, comme sur ton RIB.');
        if (champ === 'telephone') return setRefus("Je n'arrive pas à envoyer de SMS à ce numéro. Vérifie-le, ou paie par carte.");
      }
      if (error) throw error;
      if (result?.etat === 'code' && typeof result.telephone === 'string') {
        setCode('');
        return setCodeEnvoye(result.telephone);
      }
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } catch (e) {
      console.error('MichelIA+ : code de mandat impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  // Prélèvement, étape 2 : le code recopié signe le mandat, et le premier prélèvement part.
  const signerMandat = async () => {
    if (sending) return;
    const saisi = code.replace(/\D/g, '');
    if (saisi.length !== 6) return setRefus('Le code fait 6 chiffres, regarde ton SMS.');
    setSending(true);
    setRefus(null);
    try {
      const { data: result, error } = await supabase.functions.invoke('michelia-plus', {
        body: { signer: { code: saisi, iban, titulaire } },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 400) {
        const restants = await essaisRestants(error);
        setCode('');
        return setRefus(
          restants === 0
            ? 'Code faux, et plus aucun essai. Demande un nouveau code.'
            : `Code faux.${restants ? ` Encore ${restants} essai${restants > 1 ? 's' : ''}.` : ''}`,
        );
      }
      if (statut === 410) {
        setCodeEnvoye(null);
        setCode('');
        return setRefus('Ce code a expiré. Demande-moi un nouveau code.');
      }
      if (statut === 429) return setRefus("Trop d'essais d'un coup. Reviens dans une heure, je bouge pas.");
      if (error) throw error;
      if (result?.etat === 'paye') {
        oublierMandat();
        return bienvenu();
      }
      if (result?.etat === 'change') return changeFait();
      if (result?.etat === 'refuse') {
        oublierMandat();
        return setRefus(
          result.raison === 'iban'
            ? "Stancer refuse ce compte, rien n'est prélevé. Vérifie l'IBAN, ou paie par carte."
            : "Le premier prélèvement n'est pas passé, rien n'est pris. Tu peux réessayer, ou payer par carte.",
        );
      }
      // Mandat signé, prélèvement en route : on le relit jusqu'à ce que Stancer réponde.
      oublierMandat();
      if (typeof result?.paiement === 'string') setPaiement(result.paiement);
      setRefus("Mandat signé. J'attends la réponse de Stancer pour le premier prélèvement, deux secondes…");
    } catch (e) {
      console.error('MichelIA+ : signature du mandat impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  // Code refusé au moment de payer (épuisé entre-temps…) : rien n'est prélevé, on l'enlève.
  const refusPromo = async (error: unknown) => {
    const raison = (await corpsErreur(error))?.raison;
    setPromo(null);
    setPromoRefus(REFUS_PROMO[typeof raison === 'string' ? raison : ''] ?? REFUS_PROMO.inconnu);
    setRefus("Rien n'est prélevé : le code promo ne passe plus. Retire-le ou essaie-en un autre.");
  };

  // Code à 100 % pour toujours : MichelIA+ part tout de suite, sans carte ni compte.
  const activerOffert = async () => {
    if (sending || !promo) return;
    if (!accepte) return setRefus("Coche la case des conditions, c'est la loi, con.");
    setSending(true);
    setRefus(null);
    try {
      const captcha = await getCaptchaToken();
      const { data: result, error } = await supabase.functions.invoke('michelia-plus', {
        body: { souscrire: formule, moyen: 'offert', captcha, ...avecCode },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 400 && (await champEnErreur(error)) === 'code_promo') return refusPromo(error);
      if (statut === 409) return recharger();
      if (error) throw error;
      if (result?.etat === 'paye') return bienvenu();
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } catch (e) {
      console.error('MichelIA+ : activation offerte impossible', e);
      setRefus('Ça a coincé à la caisse, réessaie dans un moment.');
    } finally {
      setSending(false);
    }
  };

  const souscrire = async () => {
    if (sending) return;
    const carte = carteSaisie(numero, expiration, cvc);
    if (!carte) return setRefus('Vérifie le numéro de carte, la date (MM/AA) et le code au dos.');
    if (!accepte && !changement) return setRefus("Coche la case des conditions, c'est la loi, con.");
    setSending(true);
    setRefus(null);
    try {
      const captcha = await getCaptchaToken();
      const { data: result, error } = await supabase.functions.invoke('michelia-plus', {
        body: changement ? { changer: { moyen: 'carte', carte, captcha } } : { souscrire: formule, carte, captcha, ...avecCode },
      });
      const statut = (error as { context?: { status?: number } } | null)?.context?.status;
      if (statut === 429) return setRefus("Trop d'essais d'un coup. Reviens dans une heure, je bouge pas.");
      if (statut === 400 && (await champEnErreur(error)) === 'code_promo') return refusPromo(error);
      if (statut === 400) return setRefus('Vérifie le numéro de carte, la date (MM/AA) et le code au dos.');
      if (statut === 409) return recharger();
      if (error) throw error;
      if (result?.etat === 'paye') return bienvenu();
      if (result?.etat === 'change') return changeFait();
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

  // Prix d'une formule, code promo compris s'il la vise.
  const prixDe = (f: 'mois' | 'an') => {
    const remise = f === 'mois' ? promo?.mois_cents : promo?.an_cents;
    return remise ?? (f === 'mois' ? offre?.mois_cents : offre?.an_cents);
  };
  const remiseSur = (f: 'mois' | 'an') => (f === 'mois' ? promo?.mois_cents : promo?.an_cents) != null;
  const prix = changement && abonnement ? abonnement.prix_cents : prixDe(formule);
  const prixNormal = formule === 'mois' ? offre?.mois_cents : offre?.an_cents;
  // Code à 100 % : rien à payer aujourd'hui. Pour toujours : ni carte ni compte.
  const gratuit = !changement && prix === 0;
  const offertPourDeBon = gratuit && !promo?.periodes;
  const suiteRemise = !changement && remiseSur(formule) && promo?.periodes && prixNormal
    ? ` ${dureeRemise(formule, promo.periodes)}, puis ${euros(prixNormal)}`
    : '';
  const rythme = (changement && abonnement ? abonnement.formule : formule) === 'mois' ? 'chaque mois' : 'chaque année';
  const retourSepa = !!paiement?.startsWith('pi_');
  const essai = new URLSearchParams(window.location.search).has('essai');

  return (
    <View style={styles.screen}>
      <BarreMichel
        titre="MichelIA+"
        retour="Retour au chat"
        onPress={() => window.location.assign('/chat')}
        accessibilityRole="link"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <PitchCotisation />

        {failed && <Text style={styles.refus}>La caisse ne répond pas. Réessaie dans un moment.</Text>}
        {!offre && !failed && <ActivityIndicator color={colors.accent} />}

        {bienvenue && (
          <CarteMerci>Bienvenue au club ! Té, tu es des nôtres.</CarteMerci>
        )}

        {offre && abonnement && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ta cotisation</Text>
            <Text style={styles.text}>
              MichelIA+ {abonnement.formule === 'mois' ? 'au mois' : "à l'année"}, {abonnement.prix_cents === 0 ? 'offert' : euros(abonnement.prix_cents)}
              {abonnement.moyen === 'carte' && abonnement.derniers_chiffres ? `, carte •••• ${abonnement.derniers_chiffres}` : ''}
              {abonnement.moyen === 'sepa' ? `, prélèvement${abonnement.derniers_chiffres ? ` sur le compte •••• ${abonnement.derniers_chiffres}` : ''}` : ''}.
            </Text>
            {!!abonnement.remise_pct && !!abonnement.prix_plein_cents && (
              <Text style={styles.small}>
                Code promo : -{abonnement.remise_pct} %
                {abonnement.remise_restante == null
                  ? ', tant que tu restes.'
                  : abonnement.remise_restante > 0
                    ? `, encore ${abonnement.remise_restante} échéance${abonnement.remise_restante > 1 ? 's' : ''}, puis ${euros(abonnement.prix_plein_cents)}.`
                    : `, terminé : la prochaine échéance repasse à ${euros(abonnement.prix_plein_cents)}.`}
              </Text>
            )}
            {abonnement.statut === 'actif' && (
              <Text style={styles.text}>
                Prochaine échéance le {jour(abonnement.fin_periode)}
                {abonnement.moyen === 'sepa' && abonnement.prix_cents > 0 ? `, ${euros(abonnement.prix_cents)} prélevés sur ton compte` : ''}.
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
            {change && <Text style={styles.text}>C'est noté : les prochaines échéances partent sur ce moyen de paiement.</Text>}
            {abonnement.source === 'web' && !changement && !resiliation && (
              <Pressable
                onPress={() => {
                  setChangement(true);
                  setChange(false);
                  setMoyen(abonnement.moyen ?? 'carte');
                  setRefus(null);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.changed}>Changer de carte ou de compte</Text>
              </Pressable>
            )}
            {abonnement.source === 'web' && abonnement.statut !== 'resilie' && !resiliation && !changement && (
              <Pressable onPress={() => setResiliation(true)} accessibilityRole="button">
                <Text style={styles.changed}>Résilier</Text>
              </Pressable>
            )}
            {refus && !changement && <Text style={styles.refus}>{refus}</Text>}
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

        {offre && ((abonnement === null && (offre.actif || essai) && membre && !bienvenue) || (abonnement && changement)) && (
          <View style={styles.card}>
            {changement && <Text style={styles.cardTitle}>Nouveau moyen de paiement</Text>}
            {!changement && (
            <View style={styles.row}>
              {(['mois', 'an'] as const).map((f) => {
                const p = prixDe(f);
                const barre = remiseSur(f) ? (f === 'mois' ? offre.mois_cents : offre.an_cents) : null;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFormule(f)}
                    disabled={!!secure || !!paiement || !!codeEnvoye}
                    style={[styles.formule, formule === f && styles.formuleChoisie]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: formule === f }}
                  >
                    <Text style={[styles.formuleNom, formule === f && styles.formuleNomChoisi]}>{f === 'mois' ? 'Au mois' : "À l'année"}</Text>
                    <Text style={[styles.formulePrix, formule === f && styles.formuleNomChoisi]}>
                      {p === 0 ? 'Offert' : p ? `${euros(p)} / ${f}` : '—'}
                    </Text>
                    {!!barre && <Text style={[styles.small, styles.barre]}>{euros(barre)}</Text>}
                  </Pressable>
                );
              })}
            </View>
            )}
            {!changement && !secure && !paiement && !codeEnvoye && (
              <View>
                {promo && (
                  <Text style={styles.text}>
                    Code {promo.code} : -{promo.remise_pct} %{promo.formule ? (promo.formule === 'mois' ? ' sur la formule au mois' : " sur la formule à l'année") : ''}
                    {promo.periodes ? `, ${dureeRemise(promo.formule ?? formule, promo.periodes)}` : ', tant que tu restes'}.{' '}
                    <Text style={styles.link} onPress={() => { setPromo(null); setCodePromo(''); }}>Retirer</Text>
                  </Text>
                )}
                {!promo && !promoOuvert && (
                  <Pressable onPress={() => setPromoOuvert(true)} accessibilityRole="button">
                    <Text style={styles.changed}>J'ai un code promo</Text>
                  </Pressable>
                )}
                {!promo && promoOuvert && (
                  <View style={styles.row}>
                    <TextInput
                      value={codePromo}
                      onChangeText={(t) => setCodePromo(t.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 30))}
                      onSubmitEditing={() => verifierCode()}
                      placeholder="Code promo"
                      placeholderTextColor={colors.tertiary}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      autoComplete="off"
                      style={[styles.input, styles.half]}
                    />
                    <Pressable onPress={() => verifierCode()} style={({ pressed }) => [styles.formule, styles.promoBouton, pressed && styles.pressed]} accessibilityRole="button">
                      <Text style={styles.formuleNom}>Appliquer</Text>
                    </Pressable>
                  </View>
                )}
                {promoRefus && <Text style={styles.refus}>{promoRefus}</Text>}
              </View>
            )}
            {offertPourDeBon && (
              <>
                <Text style={styles.text}>MichelIA+ offert, tant que tu restes : ni carte ni compte à donner.</Text>
                <Pressable onPress={() => setAccepte((a) => !a)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: accepte }}>
                  <Text style={styles.case}>{accepte ? '☑' : '☐'}</Text>
                  <Text style={[styles.small, styles.half]}>
                    J'accepte les{' '}
                    <Text style={styles.link} onPress={() => window.open('/conditions.html', '_blank')}>
                      conditions
                    </Text>
                    . Résiliable ici en deux clics.
                  </Text>
                </Pressable>
              </>
            )}
            {!secure && !paiement && !offertPourDeBon && (
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
            {!secure && !paiement && !offertPourDeBon && moyen === 'sepa' && !codeEnvoye && (
              <>
                <TextInput
                  value={iban}
                  onChangeText={(t) => setIban(formatIban(t))}
                  placeholder="IBAN (FR76 …)"
                  placeholderTextColor={colors.tertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  style={styles.input}
                />
                <TextInput
                  value={titulaire}
                  onChangeText={(t) => setTitulaire(t.slice(0, 64))}
                  placeholder="Titulaire du compte"
                  placeholderTextColor={colors.tertiary}
                  autoComplete="name"
                  style={styles.input}
                />
                <ChampMobile
                  pays={pays}
                  valeur={mobile}
                  onChange={(p, v) => {
                    setPays(p);
                    setMobile(v);
                  }}
                />
                <Text style={styles.small}>
                  {changement
                    ? `Je t'envoie un code par SMS : en le recopiant, tu signes le mandat sur ce compte. Rien n'est prélevé aujourd'hui ; les prochaines échéances partent dessus, à la même date ${rythme}.`
                    : gratuit
                      ? `Je t'envoie un code par SMS : en le recopiant, tu signes le mandat. Rien n'est prélevé aujourd'hui : les premiers prélèvements partiront à la fin de la période offerte.`
                      : `Je t'envoie un code par SMS : en le recopiant, tu signes le mandat. Le premier prélèvement part tout de suite, puis à la même date ${rythme}.`}
                </Text>
                <Pressable onPress={() => setAccepte((a) => !a)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: accepte }}>
                  <Text style={styles.case}>{accepte ? '☑' : '☐'}</Text>
                  <Text style={[styles.small, styles.half]}>
                    J'accepte les{' '}
                    <Text style={styles.link} onPress={() => window.open('/conditions.html', '_blank')}>
                      conditions
                    </Text>{' '}
                    {changement ? '' : 'et je demande que MichelIA+ commence tout de suite : je renonce à mon délai de rétractation de 14 jours. '}
                    J'autorise GOLDEN PRINT à prélever {gratuit ? `${euros(prixNormal ?? 0)} ${rythme}, après la période offerte (${dureeRemise(formule, promo?.periodes)}),` : prix ? `${euros(prix)} ${rythme}${suiteRemise}` : `le prix affiché ${rythme}`} à
                    la date anniversaire : ce rappel vaut avis de prélèvement. Résiliable ici en deux clics.
                  </Text>
                </Pressable>
              </>
            )}
            {!secure && !paiement && moyen === 'sepa' && codeEnvoye && (
              <>
                <Text style={styles.text}>
                  Je t'ai envoyé un code au {codeEnvoye}. Recopie-le pour signer le mandat sur le compte •••• {iban.replace(/\s/g, '').slice(-4)}.
                </Text>
                <TextInput
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Code à 6 chiffres"
                  placeholderTextColor={colors.tertiary}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  style={styles.input}
                />
                <Text style={styles.small}>
                  <Text style={styles.link} onPress={() => { setCodeEnvoye(null); setCode(''); setRefus(null); }}>
                    Modifier mes informations ou recevoir un nouveau code
                  </Text>
                </Text>
              </>
            )}
            {!secure && !retourSepa && !offertPourDeBon && moyen === 'carte' && (
              <>
                <ChampsCarte {...{ numero, setNumero, expiration, setExpiration, cvc, setCvc }} />
                {gratuit && (
                  <Text style={styles.small}>
                    Rien n'est débité aujourd'hui : ta banque valide la carte avec une autorisation de 0,50 €, levée tout de suite.
                    Elle servira à la fin de la période offerte.
                  </Text>
                )}
                {changement && (
                  <Text style={styles.small}>
                    Ta banque valide la carte avec une autorisation de 0,50 € : rien n'est débité, elle disparaît d'elle-même.
                    Les prochaines échéances partent sur cette carte.
                  </Text>
                )}
                {!changement && (
                <Pressable onPress={() => setAccepte((a) => !a)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: accepte }}>
                  <Text style={styles.case}>{accepte ? '☑' : '☐'}</Text>
                  <Text style={[styles.small, styles.half]}>
                    J'accepte les{' '}
                    <Text style={styles.link} onPress={() => window.open('/conditions.html', '_blank')}>
                      conditions
                    </Text>{' '}
                    et je demande que MichelIA+ commence tout de suite : je renonce à mon délai de rétractation de 14 jours.
                    {gratuit ? `Offert ${dureeRemise(formule, promo?.periodes)}, puis ${euros(prixNormal ?? 0)} ${rythme}` : `Renouvelé ${rythme}${suiteRemise}`}, résiliable ici en deux clics.
                  </Text>
                </Pressable>
                )}
              </>
            )}
            {secure && <CadreBanque src={secure} hauteur={hauteur} />}
            {refus && <Text style={styles.refus}>{refus}</Text>}
            {!secure && !paiement && (
              <Pressable
                onPress={offertPourDeBon ? activerOffert : moyen === 'carte' ? souscrire : codeEnvoye ? signerMandat : demanderCode}
                disabled={sending || prix == null}
                style={({ pressed }) => [styles.payer, (sending || prix == null) && styles.dimmed, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {sending ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.payerText}>
                    {offertPourDeBon
                      ? 'Activer MichelIA+'
                      : moyen === 'carte'
                      ? changement
                        ? 'Enregistrer cette carte'
                        : gratuit
                          ? 'Activer MichelIA+'
                          : `Cotiser ${prix ? euros(prix) : ''}`
                      : codeEnvoye
                        ? 'Signer le mandat'
                        : 'Recevoir mon code'}
                  </Text>
                )}
              </Pressable>
            )}
            {changement && !secure && !paiement && (
              <Pressable
                onPress={() => {
                  setChangement(false);
                  oublierMandat();
                  setRefus(null);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.changed}>Laisser comme c'est</Text>
              </Pressable>
            )}
            <Text style={styles.small}>
              {offertPourDeBon ? 'Rien à payer.' : 'Paiement sécurisé par Stancer.'} {offertPourDeBon ? '' : moyen === 'sepa' ? 'Ton IBAN part chez Stancer ; Michel range ton mandat signé dans un coffre privé.' : "Ta carte n'est jamais gardée chez Michel."}
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

// Le mobile : drapeau et indicatif à gauche (liste des pays au toucher), numéro à droite.
function ChampMobile({ pays, valeur, onChange }: { pays: Country; valeur: string; onChange: (pays: Country, valeur: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <View>
      <View style={styles.ligneMobile}>
        <Pressable
          onPress={() => setOuvert((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={`Pays du mobile : ${pays.name}`}
          style={[styles.input, styles.indicatif]}
        >
          <Text style={styles.indicatifTexte}>
            {flag(pays.code)} {pays.dial} ▾
          </Text>
        </Pressable>
        <TextInput
          value={valeur}
          onChangeText={(t) => {
            const devine = paysDevine(t);
            if (devine) return onChange(devine.pays, formatMobile(devine.pays, devine.reste));
            // Un indicatif pas encore complet (+3…) : on le laisse tel quel le temps de finir.
            if (/^\s*(\+|00)/.test(t)) return onChange(pays, t.replace(/[^\d+]/g, '').slice(0, 16));
            onChange(pays, formatMobile(pays, t));
          }}
          placeholder={PAIRES.has(pays.dial) ? '06 12 34 56 78' : 'Mobile'}
          placeholderTextColor={colors.tertiary}
          keyboardType="phone-pad"
          autoComplete="tel-national"
          accessibilityLabel="Mobile, pour le code de signature"
          style={[styles.input, styles.numeroMobile]}
        />
      </View>
      {ouvert && (
        <ScrollView style={styles.listePays} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {COUNTRIES.map((c) => (
            <Pressable
              key={c.code}
              onPress={() => {
                onChange(c, formatMobile(c, valeur));
                setOuvert(false);
              }}
              style={styles.optionPays}
              accessibilityRole="button"
            >
              <Text style={[styles.text, c.code === pays.code && styles.paysChoisi]}>
                {flag(c.code)} {c.name} {c.dial}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ...ecran,
  ...ecranPaiement,
  ...ecranCotisation,
  screen: { flex: 1, backgroundColor: colors.background },
  input: champ,
  ligneMobile: { flexDirection: 'row', gap: 8 },
  indicatif: { justifyContent: 'center' },
  indicatifTexte: { color: colors.text, fontSize: 16 },
  numeroMobile: { flex: 1, minWidth: 0 },
  listePays: { maxHeight: 240, marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.background },
  optionPays: { paddingVertical: 8, paddingHorizontal: 12 },
  paysChoisi: { color: colors.accent, fontWeight: '700' },
  case: { color: colors.accent, fontSize: 20, lineHeight: 22 },
  barre: { textDecorationLine: 'line-through', marginTop: 2 },
  promoBouton: { flexGrow: 0, flexBasis: 'auto', paddingHorizontal: 16, justifyContent: 'center' },
});
