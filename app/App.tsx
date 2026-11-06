import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AccountScreen, type AccountMode } from './src/AccountScreen';
import { AdminScreen } from './src/AdminScreen';
import { AvatarView } from './src/AvatarView';
import { avatarFromSeed, loadAvatar, type Avatar } from './src/avatar';
import { unsubscribeFromNews } from './src/admin';
import { isMember, loadProfile } from './src/auth';
import { CaptchaHost } from './src/captcha';
import { ANALYTICS_ENABLED } from './src/analytics';
import { Causette } from './src/Causette';
import { Carnet } from './src/Carnet';
import { causetteId, copier, plain, type Echange } from './src/causette';
import { Comptoir } from './src/Comptoir';
import { ConversationSheet } from './src/ConversationSheet';
import { Cotisation } from './src/Cotisation';
import { cleAppli, loadComptoir } from './src/comptoir';
import { CookieBanner, type CookieBannerHandle } from './src/CookieBanner';
import { Doleances } from './src/Doleances';
import { InstallCard } from './src/InstallCard';
import { InvitationCard } from './src/InvitationCard';
import { inviter, LIEN_AVIS, type Invitation, type Moment } from './src/invitations';
import { NotifyCard } from './src/NotifyCard';
import { forgetLoginGreeting, loginGreeting } from './src/greeting';
import { askMichel, type ChatMessage } from './src/chat';
import { noterReponse, nouvelleCle } from './src/notes';
import {
  effacerDuCompte,
  lireEffacees,
  loadAccountCarnet,
  loadCarnet,
  nettoyer,
  nouvelId,
  prolonge,
  ranger,
  saveAccountDiscussion,
  saveCarnet,
  titreDe,
  type Discussion,
} from './src/memory';
import { pickPhoto, photoUri, type Photo } from './src/photo';
import { AvatarMichel } from './src/Blocs';
import { bureau, demarrerBureau, notifier, ouvrirDehors } from './src/bureau';
import { COLUMN, ecran } from './src/ecran';
import { useDictee } from './src/dictee';
import { DEFAULT_SUGGESTIONS, MODES, findMode, loadMode, saveMode } from './src/modes';
import { TONS_DURS_DISPONIBLES, findTon, loadTon, saveTon, type Ton, type TonId } from './src/tons';
import { TonSheet } from './src/TonSheet';
import { isOffline, registerServiceWorker } from './src/pwa';
import { syncPush } from './src/push';
import { RichText } from './src/RichText';
import { makeCard, type Card } from './src/shareCardModel';
import { ShareSheet } from './src/ShareSheet';
import { supabase } from './src/supabase';
import { colors, serif } from './src/theme';
import STORES from './store/liens.json';

function welcome(name?: string) {
  return name
    ? `Adishatz ${name} ! Te revoilà, con. Toujours coincé dans cette fichue machine, moi. ` +
        "Qu'est-ce que je peux faire pour toi ?"
    : "Adishatz ! C'est Michel. Je sais pas comment, mais je suis coincé dans cette fichue machine. " +
        "Tant que j'y suis, pose-moi ta question, con !";
}

// Sur le web les pages légales et les nouveautés sont servies par le même site ; dans les applis, par michel.beer.
const SITE = Platform.OS === 'web' ? '' : 'https://michel.beer';
const LEGAL_LINKS = [
  { label: 'Nouveautés', path: '/confit-de-canard' },
  { label: 'Améliore Michel', path: '/cahier-de-doleances' },
  { label: 'Ça mijote', path: '/ca-mijote' },
  { label: 'Mentions légales', path: '/mentions-legales.html' },
  { label: 'Confidentialité', path: '/confidentialite.html' },
  { label: 'Conditions', path: '/conditions.html' },
  // Les réseaux de Michel : adresses complètes, ouvertes telles quelles.
  { label: 'Facebook', path: 'https://www.facebook.com/michel.beer.32' },
  { label: 'Instagram', path: 'https://www.instagram.com/michel.beer.32/' },
  // Les avis sur Michel : page Trustpilot publique, un simple lien (aucun script ni donnée envoyés à Trustpilot).
  { label: 'Donne ton avis', path: 'https://fr.trustpilot.com/review/michel.beer' },
  // Sur le web et le bureau, les applis mobiles une fois en rayon (store/liens.json). Pas dans les applis :
  // Apple refuse qu'une appli iPhone renvoie vers Google Play.
  ...(Platform.OS === 'web'
    ? [STORES.apple, STORES.google].filter((s) => s.publie).map((s) => ({ label: s.nom, path: s.lien }))
    : []),
  // Sur le web, la page /comptoir (Stripe). Dans les applis, le comptoir par achat intégré s'ouvre par-dessus le chat.
  ...(Platform.OS === 'web' ? [{ label: 'Le comptoir', path: '/comptoir' }] : []),
];

// « local » : mot de Michel affiché seulement ici, jamais renvoyé à l'IA ni gardé en mémoire.
// « note » : les étoiles données à une réponse de Michel (cle : son identifiant pour la base).
type Bubble = ChatMessage & { id: string; failed?: boolean; local?: boolean; note?: number; cle?: string };

registerServiceWorker();
demarrerBureau();

let nextId = 0;
const newId = () => String(nextId++);

// Sur le web seulement, les adresses /comptoir (pourboires), /la-cotisation (MichelIA+) et
// /cahier-de-doleances (idées pour Michel) ouvrent leur page à la place du chat. Partout, la bulle
// « Une idée ? » ouvre le cahier par-dessus le chat.
const PAGES = { '/comptoir': Comptoir, '/la-cotisation': Cotisation, '/cahier-de-doleances': Doleances } as const;

export default function App() {
  const path = Platform.OS === 'web' ? window.location.pathname.replace(/\/+$/, '') : '';
  const Page = PAGES[path as keyof typeof PAGES];
  // Une causette partagée (michel.beer/la-causette/<id>) : page publique en lecture seule.
  const causette = causetteId(path);
  if (causette) return <Causette id={causette} />;
  return Page ? (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <Page onClose={() => window.location.assign('/chat')} />
      </SafeAreaView>
    </SafeAreaProvider>
  ) : (
    <Chat />
  );
}

function Chat() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<Photo>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>();
  const nameRef = useRef(name);
  nameRef.current = name;
  const [mode, setMode] = useState<string>();
  const [ton, setTon] = useState<TonId>('normal');
  const [tonOpen, setTonOpen] = useState(false);
  const [sessionKnown, setSessionKnown] = useState(false);
  const [tonLoaded, setTonLoaded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountMode | null>(null);
  const [admin, setAdmin] = useState(false);
  const [sharing, setSharing] = useState<Card | null>(null);
  // Toute la conversation à partager (lien public ou texte), et la réponse qu'on vient de copier.
  const [conversation, setConversation] = useState<Echange[] | null>(null);
  const [copied, setCopied] = useState<string>();
  const [avatar, setAvatar] = useState<Avatar>(() => avatarFromSeed(''));
  // Le carnet des causettes (la plus récente en haut) et celle qui est à l'écran. Une causette nouvelle
  // n'entre dans le carnet qu'au premier échange. Le carnet est aussi tenu dans une réf, à jour tout de suite.
  const [carnet, setCarnet] = useState<Discussion[]>([]);
  const carnetRef = useRef<Discussion[]>([]);
  const [courante, setCourante] = useState(nouvelId);
  // Sur un téléphone (ou une fenêtre étroite), le carnet s'ouvre en tiroir.
  const [tiroir, setTiroir] = useState(false);
  const { width } = useWindowDimensions();
  const large = Platform.OS === 'web' && width >= 900;
  const sentRef = useRef(0);
  // Le comptoir est-il ouvert pour cet appareil ? Sur le web, la page /comptoir ; dans les applis,
  // seulement l'achat intégré, s'il est ouvert pour la boutique de l'appareil (jamais de lien vers le web).
  const [comptoirOuvert, setComptoirOuvert] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [comptoir, setComptoir] = useState(false);
  // MichelIA+ dans les applis : abonnement des boutiques, proposé quand il est ouvert et que la caisse des applis l'est.
  const [cotisationOuverte, setCotisationOuverte] = useState(false);
  const [cotisation, setCotisation] = useState(false);
  // Le cahier de doléances par-dessus le chat : 'idee' depuis la bulle flottante, 'bug' après une mauvaise note.
  const [doleances, setDoleances] = useState<'idee' | 'bug' | null>(null);
  const listRef = useRef<FlatList<Bubble>>(null);
  const cookiesRef = useRef<CookieBannerHandle>(null);
  const member = isMember(session);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => undefined)
      .finally(() => setSessionKnown(true));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setAccount('reset');
      // Déconnexion : la conversation reste sur le compte, on l'efface de l'appareil.
      if (event === 'SIGNED_OUT') {
        setBubbles([]);
        carnetRef.current = [];
        setCarnet([]);
        setCourante(nouvelId());
        setName(undefined);
        forgetLoginGreeting();
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        // Hors du rappel de Supabase, pour ne pas le bloquer pendant la lecture du stockage.
        setTimeout(() => {
          loginGreeting(next).then((line) => {
            if (line) setBubbles((all) => [...all, { id: newId(), role: 'assistant', content: line, local: true }]);
          });
        }, 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadComptoir()
      .then((data) => setComptoirOuvert(Platform.OS === 'web' ? data.actif : !!cleAppli(data)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    Promise.all([loadComptoir(), supabase.rpc('michelia_plus_public')])
      .then(([data, { data: offre }]) => setCotisationOuverte(!!cleAppli(data) && !!(offre as { actif?: boolean } | null)?.actif))
      .catch(() => undefined);
  }, []);

  // Notifications déjà acceptées : l'appareil suit le compte connecté (et son jeton est rafraîchi).
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) syncPush();
  }, [userId]);

  // Membre connecté : Michel prend le prénom du profil ; s'il manque l'âge (Google, Facebook), on le demande.
  const memberId = member ? session?.user.id : undefined;
  useEffect(() => {
    if (!memberId) return;
    loadProfile(memberId).then((profile) => {
      if (profile.firstName) setName(profile.firstName);
      if (!profile.birthYear) setAccount((current) => current ?? 'profile');
    });
  }, [memberId]);

  // La bobine : celle du compte (dessinée à l'inscription, retouchée ou non), sinon celle de l'appareil.
  useEffect(() => {
    setAvatar(avatarFromSeed(userId ?? ''));
    if (!memberId) return;
    // Une réponse arrivée après un changement de compte ne doit pas écraser la nouvelle bobine.
    let current = true;
    loadAvatar(memberId)
      .then((loaded) => current && setAvatar(loaded))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [userId, memberId]);

  // Lien « Me connecter » de la page /la-cotisation : michel.beer/chat?compte=connexion ouvre le compte.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('compte') !== 'connexion') return;
    url.searchParams.delete('compte');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    supabase.auth
      .getSession()
      .then(({ data }) => setAccount(isMember(data.session) ? 'profile' : 'signin'))
      .catch(() => setAccount('signin'));
  }, []);

  // Lien « Ne plus recevoir les nouvelles » des e-mails : michel.beer/?desabonnement=…
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get('desabonnement');
    if (!token) return;
    url.searchParams.delete('desabonnement');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    const say = (content: string) =>
      setBubbles((all) => [...all, { id: newId(), role: 'assistant', content, local: true }]);
    unsubscribeFromNews(token)
      .then(() => say("C'est noté, plus de nouvelles de Michel dans ta boîte aux lettres. Mais tu peux toujours venir causer, hè !"))
      .catch(() => say('Pétard, ce lien de désabonnement ne marche pas. Coupe les nouvelles dans « Compte », ou écris à contact@michel.beer.'));
  }, []);

  useEffect(() => {
    loadMode().then(setMode);
  }, []);

  // Ton enregistré : un ton dur n'est repris que pour un inscrit, là où il est proposé.
  // On attend de connaître la session avant de rétrograder un ton dur.
  useEffect(() => {
    loadTon().then((saved) => {
      if (saved) setTon(saved);
      setTonLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!sessionKnown || !tonLoaded) return;
    if (findTon(ton)?.dur && (!member || !TONS_DURS_DISPONIBLES)) {
      setTon('normal');
      saveTon('normal');
    }
  }, [ton, member, sessionKnown, tonLoaded]);

  function applyTon(next: Ton) {
    setTonOpen(false);
    if (busy) return;
    setTon(next.id);
    saveTon(next.id);
    setBubbles((all) => [...all, { id: newId(), role: 'assistant', content: next.hello, local: true }]);
  }

  function tonLocked() {
    setTonOpen(false);
    setBubbles((all) => [
      ...all,
      {
        id: newId(),
        role: 'assistant',
        content: 'Ça, c’est réservé aux inscrits, con. Crée-toi un compte et je me lâche.',
        local: true,
      },
    ]);
    setAccount(member ? 'profile' : 'signin');
  }

  // Changement de mode : Michel l'annonce d'un mot, affiché seulement.
  function chooseMode(id: string | undefined) {
    if (busy || id === mode) return;
    setMode(id);
    saveMode(id);
    const hello = findMode(id)?.hello ?? "Bon, on reprend la causette normale. Demande-moi ce que tu veux.";
    setBubbles((all) => [...all, { id: newId(), role: 'assistant', content: hello, local: true }]);
  }

  useEffect(() => {
    loadCarnet().then((saved) => {
      setName((current) => current ?? saved.name);
      carnetRef.current = saved.discussions;
      setCarnet(saved.discussions);
      const ouverte = saved.discussions.find((d) => d.id === saved.courante);
      if (ouverte) {
        setCourante(ouverte.id);
        setBubbles((current) => [...ouverte.messages.map((m) => ({ ...m, id: newId() })), ...current]);
      }
      setLoaded(true);
    });
  }, []);

  // Le carnet change : à l'écran, sur l'appareil, et sur le compte pour les causettes retirées.
  function majCarnet(discussions: Discussion[], ouverte = courante) {
    const { gardees, tombees } = ranger(discussions);
    carnetRef.current = gardees;
    setCarnet(gardees);
    saveCarnet({ name: nameRef.current, courante: ouverte, discussions: gardees });
    if (memberId && syncedFor === memberId) {
      tombees.forEach((d) => effacerDuCompte(memberId, d.id, 0).catch(() => undefined));
    }
    return gardees;
  }

  // Membre : on range dans le carnet les causettes gardées sur le compte, et on y envoie celles de
  // l'appareil qui n'y sont pas encore (ou plus récentes). Si l'écran est vide, on rouvre la plus récente.
  const [syncedFor, setSyncedFor] = useState<string>();
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;
  const couranteRef = useRef(courante);
  couranteRef.current = courante;

  // Envoie une causette au compte ; une fois arrivée, elle est notée « en ligne » : si elle disparaît
  // un jour du compte, c'est qu'elle a été effacée depuis un autre appareil.
  // Causettes écrites pendant le chargement du compte, pas encore envoyées.
  const enSuspens = useRef(new Set<string>());
  function envoyer(userId: string, d: Discussion, enCours?: { name?: string }) {
    saveAccountDiscussion(userId, d, enCours)
      .then(() => {
        const liste = carnetRef.current;
        const ici = liste.find((x) => x.id === d.id);
        if (!ici || ici.enLigne) return;
        const next = liste.map((x) => (x.id === d.id ? { ...x, enLigne: true } : x));
        carnetRef.current = next;
        setCarnet(next);
        saveCarnet({ name: nameRef.current, courante: couranteRef.current, discussions: next });
      })
      .catch(() => undefined);
  }
  useEffect(() => {
    setSyncedFor(undefined);
    if (!memberId || !loaded) return;
    let cancelled = false;
    lireEffacees(memberId)
      .then(async (effacees) => {
        // La plus récente effacée en attente : la copie dans conversations, c'est elle (si elle n'a pas
        // été réécrite depuis), on ne la reprend pas.
        const jusqua = Math.max(0, ...effacees.values());
        return [await loadAccountCarnet(memberId, carnetRef.current, jusqua), effacees] as const;
      })
      .then(([remote, effacees]) => {
      if (cancelled) return;
      // Effacées ici avant d'avoir pu l'être sur le compte : on réessaie, et on ne les reprend pas.
      effacees.forEach((jusqua, id) => effacerDuCompte(memberId, id, jusqua).catch(() => undefined));
      if (!remote) {
        // Souci réseau : on garde l'appareil. Les causettes écrites pendant le chargement (envoi alors
        // suspendu) partent quand même : le compte les prendra s'il répond de nouveau.
        carnetRef.current
          .filter((d) => enSuspens.current.has(d.id))
          .forEach((d) => envoyer(memberId, d, d.id === couranteRef.current ? { name: nameRef.current } : undefined));
        enSuspens.current.clear();
        setSyncedFor(memberId);
        return;
      }
      const garder = (d: Discussion) => !effacees.has(d.id);
      const parId = new Map(remote.discussions.filter(garder).map((d) => [d.id, d]));
      const aEnvoyer = new Map(remote.aEnvoyer.filter(garder).map((d) => [d.id, d]));
      // Une causette jamais envoyée mais déjà sur le compte sous un autre identifiant (la même conversation
      // reprise des deux côtés lors du passage au carnet) : on la range sous l'identifiant du compte.
      const memes = new Map<string, string>();
      for (const locale of carnetRef.current) {
        if (locale.enLigne || parId.has(locale.id)) continue;
        const jumelle = [...parId.values()].find(
          (d) => !memes.has(d.id) && (prolonge(locale.messages, d.messages) || prolonge(d.messages, locale.messages)),
        );
        if (jumelle) memes.set(locale.id, jumelle.id);
      }
      for (const brute of carnetRef.current) {
        const autreId = memes.get(brute.id);
        const locale = autreId ? { ...brute, id: autreId, enLigne: true } : brute;
        const distante = parId.get(locale.id);
        // Déjà passée par le compte mais plus dessus : effacée depuis un autre appareil (si la liste a bien été lue).
        if (!distante && locale.enLigne && remote.complet) continue;
        if (distante && autreId && !prolonge(locale.messages, distante.messages)) continue;
        if (!distante || Date.parse(locale.maj) > Date.parse(distante.maj)) {
          parId.set(locale.id, locale);
          aEnvoyer.set(locale.id, locale);
        }
      }
      const ouverteId = memes.get(couranteRef.current);
      if (ouverteId) {
        couranteRef.current = ouverteId;
        setCourante(ouverteId);
      }
      const avant = carnetRef.current;
      // Au-delà de 30, les plus anciennes quittent le carnet, et le compte aussi.
      const { gardees, tombees } = ranger([...parId.values()]);
      tombees.forEach((d) => d.enLigne && effacerDuCompte(memberId, d.id, 0).catch(() => undefined));
      majCarnet(gardees, couranteRef.current);
      aEnvoyer.forEach((d) => {
        if (gardees.some((g) => g.id === d.id)) envoyer(memberId, d);
      });
      if (remote.name) setName((current) => current ?? remote.name);

      // La causette à l'écran : on la remet à la version gagnante, en gardant les échanges pas encore rangés.
      const enCours = bubblesRef.current.filter((b) => !b.local);
      const id = couranteRef.current;
      const ancienne = avant.find((d) => d.id === id) ?? avant.find((d) => memes.get(d.id) === id);
      const gagnante = gardees.find((d) => d.id === id);
      if (!enCours.length) {
        if (gardees[0]) {
          setCourante(gardees[0].id);
          setBubbles((current) => [...gardees[0].messages.map((m) => ({ ...m, id: newId() })), ...current]);
        }
      } else if (ancienne && !gagnante) {
        // Effacée ailleurs : on repart d'une causette neuve, avec les échanges pas encore rangés.
        const pasRangees = new Set(enCours.slice(ancienne.messages.length).map((b) => b.id));
        setCourante(nouvelId());
        setBubbles((current) => current.filter((b) => b.local || pasRangees.has(b.id)));
      } else if (ancienne && gagnante && gagnante !== ancienne && !aEnvoyer.has(id)) {
        // Plus récente sur le compte : on l'affiche, suivie de ce qui n'était pas encore rangé ici.
        const rangees = new Set(enCours.slice(0, ancienne.messages.length).map((b) => b.id));
        setBubbles((current) => [
          ...gagnante.messages.map((m) => ({ ...m, id: newId() })),
          ...current.filter((b) => !rangees.has(b.id)),
        ]);
      }
      enSuspens.current.clear();
      setSyncedFor(memberId);
    });
    return () => {
      cancelled = true;
    };
  }, [memberId, loaded]);

  // On sauvegarde une fois la réponse terminée, sans les échanges en échec.
  useEffect(() => {
    if (!loaded || busy) return;
    const messages = nettoyer(
      bubbles.filter((b) => !b.local).filter((b, i, all) => !b.failed && !all[i + 1]?.failed),
    );
    const avant = carnetRef.current.find((d) => d.id === courante);
    const changee = messages.length > 0 && JSON.stringify(messages) !== JSON.stringify(avant?.messages ?? []);
    if (!changee) {
      saveCarnet({ name, courante, discussions: carnetRef.current });
      return;
    }
    const maintenant = new Date().toISOString();
    const d: Discussion = {
      id: courante,
      titre: avant?.titre ?? titreDe(messages),
      messages,
      maj: maintenant,
      ...(avant?.enLigne && { enLigne: true }),
    };
    majCarnet([d, ...carnetRef.current.filter((x) => x.id !== courante)]);
    if (memberId && syncedFor === memberId) envoyer(memberId, d, { name });
    else if (memberId) enSuspens.current.add(d.id);
    // majCarnet lit courante, name, memberId et syncedFor : déjà dans la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles, name, busy, loaded, memberId, syncedFor, courante]);

  // Changer de causette. Pendant que Michel répond, on reste où on est.
  function ouvrirCausette(id: string) {
    setTiroir(false);
    if (busy || id === courante) return;
    const d = carnetRef.current.find((x) => x.id === id);
    if (!d) return;
    setCourante(id);
    setBubbles(d.messages.map((m) => ({ ...m, id: newId() })));
    setInvitation(null);
  }

  function nouvelleCausette() {
    setTiroir(false);
    if (busy) return;
    setCourante(nouvelId());
    setBubbles([]);
    setInvitation(null);
  }

  function retirerCausette(id: string) {
    const d = carnetRef.current.find((x) => x.id === id);
    if (!d || (busy && id === courante)) return;
    // La plus récente : sa copie dans conversations sera vidée, si personne ne l'a réécrite depuis.
    const copieJusqua = carnetRef.current[0]?.id === id ? Date.parse(d.maj) || 0 : 0;
    const ouverte = id === courante ? nouvelId() : courante;
    majCarnet(carnetRef.current.filter((x) => x.id !== id), ouverte);
    if (id === courante) {
      setCourante(ouverte);
      setBubbles([]);
    }
    if (memberId) effacerDuCompte(memberId, id, copieJusqua).catch(() => undefined);
  }

  // Android : le bouton retour ferme le tiroir.
  useEffect(() => {
    if (!tiroir) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setTiroir(false);
      return true;
    });
    return () => sub.remove();
  }, [tiroir]);

  async function send(input = draft) {
    const text = input.trim();
    const image = attached;
    if ((!text && !image) || busy) return;

    const question: Bubble = { id: newId(), role: 'user', content: text, ...(image && { photo: true, image }) };
    const answerId = newId();
    // Les bulles vont par paires question / réponse ; une paire en échec n'est pas renvoyée à Michel.
    const history = [
      ...bubbles.filter((b) => !b.local).filter((b, i, all) => !b.failed && !all[i + 1]?.failed),
      question,
    ];
    setBubbles([...bubbles, question, { id: answerId, role: 'assistant', content: '' }]);
    sentRef.current += 1;
    dictee.couper();
    setDraft('');
    setAttached(undefined);
    setBusy(true);

    const updateAnswer = (change: (b: Bubble) => Bubble) =>
      setBubbles((all) => all.map((b) => (b.id === answerId ? change(b) : b)));

    let reponse = '';
    try {
      const learned = await askMichel(
        // Seule la dernière photo repart vers Michel ; les précédentes restent une simple mention.
        history.map(({ role, content, photo }, i) => ({
          role,
          content,
          photo,
          image: i === history.length - 1 ? image : undefined,
        })),
        name,
        mode,
        ton,
        (chunk) => {
          reponse += chunk;
          updateAnswer((b) => ({ ...b, content: b.content + chunk }));
        },
      );
      if (learned.name) setName(learned.name);
      // Dans l'appli de bureau, une notification si Michel répond pendant qu'on regarde ailleurs.
      notifier(reponse);
    } catch (e) {
      const message = isOffline()
        ? "Miladiou, ça capte plus ! Sans internet je peux rien te dire, con. Réessaie quand le réseau revient."
        : e instanceof Error && e.message
          ? e.message
          : 'Pétard, ça a planté.';
      updateAnswer((b) => ({ ...b, content: message, failed: true }));
      return;
    } finally {
      setBusy(false);
    }
    proposer('causette');
  }

  // Une invitation de Michel (pourboire ou inscription), au plus une par visite : voir src/invitations.ts.
  function proposer(moment: Moment) {
    inviter({ moment, envoyes: sentRef.current, membre: member, pourboire: comptoirOuvert })
      .then((next) => next && setInvitation(next))
      .catch(() => undefined);
  }

  function accepterInvitation() {
    const genre = invitation?.genre;
    setInvitation(null);
    if (genre === 'inscription') setAccount('signup');
    else if (genre === 'avis') {
      if (bureau) ouvrirDehors(LIEN_AVIS);
      else Linking.openURL(LIEN_AVIS).catch(() => undefined);
    } else ouvrirComptoir();
  }

  // Le comptoir : la page /comptoir sur le web, l'achat intégré dans les applis. Dans l'appli de bureau,
  // la carte se tape sur michel.beer/comptoir dans le navigateur (le 3D Secure revient sur le site).
  function ouvrirComptoir() {
    if (bureau) ouvrirDehors('/comptoir');
    else if (Platform.OS === 'web') window.location.assign('/comptoir');
    else setComptoir(true);
  }

  // Ce qui part quand on partage la conversation : le texte échangé, comme pour la mémoire (sans les
  // mots locaux ni les échanges en échec), mais sans les photos (une photo seule, sans texte, ne part pas).
  function echanges(): Echange[] {
    return bubbles
      .filter((b) => !b.local)
      .filter((b, i, all) => !b.failed && !all[i + 1]?.failed && b.content.trim())
      .map(({ role, content }) => ({ role, content }));
  }

  function copierReponse(item: Bubble) {
    copier(plain(item.content))
      .then(() => {
        setCopied(item.id);
        setTimeout(() => setCopied((id) => (id === item.id ? undefined : id)), 2000);
      })
      .catch(() => {});
  }

  // Les étoiles : affichées tout de suite, remises comme avant si la base refuse.
  function rate(index: number, note: number) {
    const item = bubbles[index];
    if (!item || item.note === note) return;
    const cle = item.cle ?? nouvelleCle();
    const before = item.note;
    const asked = bubbles[index - 1];
    setBubbles((all) => all.map((b) => (b.id === item.id ? { ...b, note, cle } : b)));
    if (note >= 4) proposer('note');
    noterReponse({
      cle,
      note,
      reponse: item.content,
      question: asked?.role === 'user' ? asked.content : undefined,
      mode,
    }).catch(() => setBubbles((all) => all.map((b) => (b.id === item.id ? { ...b, note: before } : b))));
  }

  async function attach() {
    try {
      const photo = await pickPhoto();
      if (photo) setAttached(photo);
    } catch (e) {
      const content = e instanceof Error && e.message ? e.message : 'Hòu, la photo est restée coincée dans le tuyau, con.';
      setBubbles((all) => [...all, { id: newId(), role: 'assistant', content, local: true }]);
    }
  }

  const dictee = useDictee({
    texte: draft,
    setTexte: setDraft,
    signaler: (content) => setBubbles((all) => [...all, { id: newId(), role: 'assistant', content, local: true }]),
  });

  const canSend = !busy && (draft.trim().length > 0 || !!attached);
  const suggestions = findMode(mode)?.suggestions ?? DEFAULT_SUGGESTIONS;
  const modeChips = [{ id: undefined, label: '💬 Tout' }, ...MODES];
  const carnetProps = {
    discussions: carnet,
    courante,
    occupe: busy,
    membre: member,
    onOuvrir: ouvrirCausette,
    onNouvelle: nouvelleCausette,
    onSupprimer: retirerCausette,
    onConnexion: () => {
      setTiroir(false);
      setAccount('signin');
    },
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <View style={styles.cadre}>
        {large && (
          <View style={styles.cote}>
            <Carnet {...carnetProps} />
          </View>
        )}
        <View style={styles.principal}>
        <View style={styles.header}>
          <View style={styles.headerInner}>
            {!large && (
              <Pressable
                onPress={() => setTiroir(true)}
                style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Mes causettes"
                hitSlop={6}
              >
                <Text style={styles.menuText}>☰</Text>
              </Pressable>
            )}
            <AvatarMichel />
            <View style={styles.headerText}>
              <Text style={styles.title}>Michel</Text>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.status}>Coincé dans la machine</Text>
              </View>
            </View>
            <Pressable
              onPress={() => setAccount(member ? 'profile' : 'signin')}
              style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <View style={styles.accountInner}>
                {member && <AvatarView avatar={avatar} size={22} />}
                <Text style={styles.newChatText}>{member ? 'Compte' : 'Connexion'}</Text>
              </View>
            </Pressable>
            {bubbles.length > 0 && !busy && (
              <Pressable
                onPress={nouvelleCausette}
                style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Nouvelle causette"
              >
                <Text style={styles.newChatText}>{large ? 'Nouveau' : '＋'}</Text>
              </Pressable>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.modesScroll}
            contentContainerStyle={styles.modes}
            accessibilityRole="tablist"
          >
            {modeChips.map((m) => {
              const active = m.id === mode;
              return (
                <Pressable
                  key={m.id ?? 'tout'}
                  onPress={() => chooseMode(m.id)}
                  disabled={busy}
                  style={({ pressed }) => [styles.mode, active && styles.modeActive, pressed && styles.pressed]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.modeText, active && styles.modeTextActive]}>{m.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setTonOpen(true)}
              disabled={busy}
              style={({ pressed }) => [styles.mode, ton !== 'normal' && styles.modeActive, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Ton de Michel : ${findTon(ton)?.label ?? ''}`}
            >
              <Text style={[styles.modeText, ton !== 'normal' && styles.modeTextActive]}>{findTon(ton)?.label}</Text>
            </Pressable>
          </ScrollView>
        </View>
        {tonOpen && (
          <TonSheet
            current={ton}
            member={member}
            busy={busy}
            onClose={() => setTonOpen(false)}
            onApply={applyTon}
            onLocked={tonLocked}
          />
        )}

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.body}>
          <FlatList
            ref={listRef}
            data={bubbles}
            extraData={busy}
            keyExtractor={(b) => b.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={styles.intro}>
                <Text style={styles.disclaimer}>
                  Michel est une intelligence artificielle qui joue un papi du Gers. Pas un vrai
                  humain, et il peut se tromper.
                </Text>
                <View style={[styles.bubble, styles.michel]}>
                  <Text style={styles.michelText}>{welcome(name)}</Text>
                </View>
                {bubbles.length === 0 && <InstallCard />}
                {bubbles.length === 0 && <NotifyCard />}
              </View>
            }
            ListFooterComponent={
              bubbles.filter((b) => !b.local).length === 0 ? (
                <View style={styles.suggestions}>
                  {suggestions.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => send(s)}
                      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    >
                      <Text style={styles.chipText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : !busy && echanges().some((e) => e.role === 'assistant') ? (
                <Pressable
                  onPress={() => setConversation(echanges())}
                  style={({ pressed }) => [styles.shareAll, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.shareAllText}>Partager la conversation</Text>
                </Pressable>
              ) : undefined
            }
            renderItem={({ item, index }) => {
              const bubble = (
                <View
                  style={[
                    styles.bubble,
                    item.role === 'user' ? styles.user : styles.michel,
                    item.failed && styles.failed,
                  ]}
                >
                  {item.image ? (
                    <Image
                      source={{ uri: photoUri(item.image) }}
                      style={[styles.photo, { aspectRatio: item.image.width / item.image.height }]}
                      accessibilityLabel="Photo montrée à Michel"
                    />
                  ) : item.photo ? (
                    <Text style={styles.photoNote}>📷 Photo</Text>
                  ) : null}
                  {item.role === 'user' || item.failed ? (
                    !!item.content && (
                      <Text style={styles.userText} selectable>
                        {item.content}
                      </Text>
                    )
                  ) : item.content ? (
                    <RichText text={item.content} style={styles.michelText} selectable />
                  ) : (
                    <Text style={styles.thinking}>Michel cherche ses lunettes…</Text>
                  )}
                </View>
              );
              // Une réponse terminée se partage en carte image, avec la question qui l'a amenée.
              const done = !(busy && index === bubbles.length - 1);
              if (item.role === 'user') {
                return (
                  <View style={styles.userRow}>
                    {bubble}
                    <AvatarView avatar={avatar} size={28} />
                  </View>
                );
              }
              if (item.failed || !item.content || !done) return bubble;
              const asked = bubbles[index - 1];
              return (
                <View>
                  {bubble}
                  <View style={styles.answerTools}>
                    <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Note cette réponse">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Pressable
                          key={n}
                          onPress={() => rate(index, n)}
                          style={({ pressed }) => pressed && styles.pressed}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: item.note === n }}
                          accessibilityLabel={`${n} étoile${n > 1 ? 's' : ''}`}
                          hitSlop={4}
                        >
                          <Text style={[styles.star, (item.note ?? 0) >= n && styles.starOn]}>
                            {(item.note ?? 0) >= n ? '★' : '☆'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      onPress={() => setSharing(makeCard(item.content, asked?.role === 'user' ? asked.content : undefined))}
                      style={({ pressed }) => [styles.shareLink, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Partager cette réponse en image"
                      hitSlop={8}
                    >
                      <Text style={styles.shareLinkText}>Partager</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => copierReponse(item)}
                      style={({ pressed }) => [styles.shareLink, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Copier le texte de cette réponse"
                      hitSlop={8}
                    >
                      <Text style={styles.shareLinkText}>{copied === item.id ? 'Copié !' : 'Copier'}</Text>
                    </Pressable>
                  </View>
                  {!!item.note && (
                    <Text style={styles.rated}>
                      {item.note >= 4 ? (
                        'Merci, ça me fait chaud au cœur, con.'
                      ) : item.note === 3 ? (
                        'Bon, peut mieux faire. Noté.'
                      ) : (
                        <>
                          {'Pétard, je me suis planté ? '}
                          <Text style={styles.ratedLink} onPress={() => setDoleances('bug')} accessibilityRole="link">
                            Dis-moi ce qui coince
                          </Text>
                        </>
                      )}
                    </Text>
                  )}
                </View>
              );
            }}
          />
          <View style={[styles.floating, { pointerEvents: 'box-none' }]}>
            {comptoirOuvert && (
              <Pressable
                onPress={ouvrirComptoir}
                style={({ pressed }) => [styles.idea, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Laisser un pourboire à Michel, au comptoir"
              >
                <Text style={styles.ideaText}>☕ Un pourboire ?</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setDoleances('idee')}
              style={({ pressed }) => [styles.idea, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Améliore Michel : une idée, un truc qui coince"
            >
              <Text style={styles.ideaText}>💡 Une idée ?</Text>
            </Pressable>
          </View>
          </View>

          <SafeAreaView edges={['bottom']} style={styles.bottom}>
            {invitation && !account && (
              <InvitationCard
                invitation={invitation}
                onAccept={accepterInvitation}
                onClose={() => setInvitation(null)}
              />
            )}
            {attached && (
              <View style={styles.preview}>
                <Image
                  source={{ uri: photoUri(attached) }}
                  style={styles.previewImage}
                  accessibilityLabel="Photo à envoyer"
                />
                <Pressable
                  onPress={() => setAttached(undefined)}
                  style={({ pressed }) => [styles.previewRemove, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Retirer la photo"
                >
                  <Text style={styles.previewRemoveText}>✕</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.composer}>
              <Pressable
                style={({ pressed }) => [styles.attach, pressed && styles.pressed]}
                onPress={attach}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Montrer une photo à Michel"
              >
                <Text style={styles.attachText}>📷</Text>
              </Pressable>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={(texte) => {
                  // Corriger à la main pendant la dictée : on coupe le micro pour ne pas écraser la correction.
                  dictee.couper();
                  setDraft(texte);
                }}
                placeholder={
                  dictee.ecoute
                    ? "Vas-y, je t'écoute…"
                    : attached
                      ? 'Un mot sur ta photo ? (facultatif)'
                      : 'Pose ta question à Michel…'
                }
                placeholderTextColor={colors.tertiary}
                multiline
                numberOfLines={1}
                maxLength={2000}
                onSubmitEditing={() => send()}
                submitBehavior="submit"
                onKeyPress={(e) => {
                  // Sur le web, Entrée envoie et Maj+Entrée passe à la ligne.
                  const { key, shiftKey } = e.nativeEvent as { key: string; shiftKey?: boolean };
                  if (Platform.OS === 'web' && key === 'Enter' && !shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                editable={!busy}
              />
              {dictee.disponible && (
                <Pressable
                  style={({ pressed }) => [styles.attach, dictee.ecoute && styles.micOn, pressed && styles.pressed]}
                  onPress={dictee.basculer}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={dictee.ecoute ? 'Arrêter la dictée' : 'Parler à Michel'}
                  accessibilityState={{ selected: dictee.ecoute }}
                >
                  <Text style={dictee.ecoute ? styles.micStop : styles.attachText}>{dictee.ecoute ? '■' : '🎙️'}</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.send,
                  !canSend && styles.sendDisabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => send()}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Envoyer"
              >
                <Text style={styles.sendText}>↑</Text>
              </Pressable>
            </View>
            <View style={styles.legal}>
              {LEGAL_LINKS.map((l, i) => (
                <Text key={l.path} style={styles.legalText}>
                  {i > 0 ? ' · ' : ''}
                  <Text
                    style={styles.legalLink}
                    onPress={() => Linking.openURL(l.path.startsWith('https://') ? l.path : SITE + l.path)}
                    accessibilityRole="link"
                  >
                    {l.label}
                  </Text>
                </Text>
              ))}
              {Platform.OS !== 'web' && comptoirOuvert && (
                <Text style={styles.legalText}>
                  {' · '}
                  <Text style={styles.legalLink} onPress={() => setComptoir(true)} accessibilityRole="link">
                    Le comptoir
                  </Text>
                </Text>
              )}
              {cotisationOuverte && (
                <Text style={styles.legalText}>
                  {' · '}
                  <Text style={styles.legalLink} onPress={() => setCotisation(true)} accessibilityRole="link">
                    MichelIA+
                  </Text>
                </Text>
              )}
              {ANALYTICS_ENABLED && (
                <Text style={styles.legalText}>
                  {' · '}
                  <Text style={styles.legalLink} onPress={() => cookiesRef.current?.reopen()} accessibilityRole="link">
                    Cookies
                  </Text>
                </Text>
              )}
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
        </View>
        </View>
        {tiroir && !large && (
          <View style={styles.tiroirFond}>
            <Pressable
              style={styles.tiroirOmbre}
              onPress={() => setTiroir(false)}
              accessibilityRole="button"
              accessibilityLabel="Fermer le carnet"
            />
            <SafeAreaView edges={['bottom', 'left']} style={styles.tiroir}>
              <Carnet {...carnetProps} onFermer={() => setTiroir(false)} />
            </SafeAreaView>
          </View>
        )}
        {account && (
          <AccountScreen
            session={session}
            initialMode={account}
            onClose={() => setAccount(null)}
            onProfile={(profile) => profile.firstName && setName(profile.firstName)}
            avatar={avatar}
            onAvatar={setAvatar}
            onAdmin={() => {
              setAccount(null);
              setAdmin(true);
            }}
            onCotisation={
              cotisationOuverte
                ? () => {
                    setAccount(null);
                    setCotisation(true);
                  }
                : undefined
            }
          />
        )}
        {admin && member && <AdminScreen onClose={() => setAdmin(false)} />}
        {comptoir && <Comptoir onClose={() => setComptoir(false)} />}
        {cotisation && (
          <Cotisation
            onClose={() => setCotisation(false)}
            onCompte={() => {
              setCotisation(false);
              setAccount('signin');
            }}
          />
        )}
        {doleances && <Doleances initialCategorie={doleances} onClose={() => setDoleances(null)} />}
        {sharing && <ShareSheet card={sharing} onClose={() => setSharing(null)} />}
        {conversation && <ConversationSheet echanges={conversation} onClose={() => setConversation(null)} />}
        <CaptchaHost />
        <CookieBanner ref={cookiesRef} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  cadre: { flex: 1, flexDirection: 'row' },
  cote: { width: 280, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator },
  principal: { flex: 1, minWidth: 0 },
  menu: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  menuText: { color: colors.accent, fontSize: 22, lineHeight: 26 },
  tiroirFond: { ...StyleSheet.absoluteFill, zIndex: 20, flexDirection: 'row' },
  tiroirOmbre: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(43, 36, 32, 0.35)' },
  tiroir: {
    width: '85%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: colors.bar,
    boxShadow: '2px 0 16px rgba(60, 40, 20, 0.2)',
  },
  header: ecran.bar,
  headerInner: ecran.barInner,
  headerText: { flex: 1 },
  title: { color: colors.text, fontSize: 20, fontFamily: serif, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.online },
  status: { color: colors.secondary, fontSize: 13 },
  newChat: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  accountInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newChatText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  modesScroll: { ...COLUMN, flexGrow: 0 },
  modes: { gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  mode: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  modeActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeText: { color: colors.text, fontSize: 14 },
  modeTextActive: { color: colors.onAccent, fontWeight: '600' },
  body: { flex: 1 },
  list: { ...COLUMN, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 60, gap: 10 },
  intro: { gap: 16 },
  disclaimer: {
    color: colors.tertiary,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 17,
  },
  bubble: { maxWidth: '82%', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10 },
  michel: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 6,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 6 },
  user: { flexShrink: 1, alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  failed: { backgroundColor: colors.failed },
  michelText: { color: colors.text, fontSize: 16, lineHeight: 23 },
  userText: { color: colors.onAccent, fontSize: 16, lineHeight: 23 },
  photo: { width: 220, maxWidth: '100%', borderRadius: 12, marginVertical: 2 },
  photoNote: { color: colors.onAccent, fontSize: 14, fontStyle: 'italic', opacity: 0.85 },
  answerTools: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginLeft: 6 },
  stars: { flexDirection: 'row', gap: 2 },
  star: { color: colors.tertiary, fontSize: 18, lineHeight: 22 },
  starOn: { color: colors.ochre },
  rated: { color: colors.secondary, fontSize: 13, marginTop: 2, marginLeft: 6 },
  ratedLink: { color: colors.accent, fontWeight: '600', textDecorationLine: 'underline' },
  floating: { position: 'absolute', right: 14, bottom: 12, zIndex: 5, gap: 8, alignItems: 'flex-end' },
  idea: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    boxShadow: '0 2px 8px rgba(60, 40, 20, 0.16)',
  },
  ideaText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  shareLink: {},
  shareLinkText: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
  shareAll: { alignSelf: 'center', marginTop: 14, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.accentSoft },
  shareAllText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  thinking: { color: colors.secondary, fontSize: 15, fontStyle: 'italic' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.text, fontSize: 14 },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.bar,
  },
  composer: {
    ...COLUMN,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: colors.text,
  },
  attach: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachText: { fontSize: 19 },
  micOn: { backgroundColor: colors.accent },
  micStop: { color: colors.onAccent, fontSize: 16 },
  preview: { ...COLUMN, flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10 },
  previewImage: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.accentSoft },
  previewRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: -12,
    marginTop: -6,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewRemoveText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.disabled },
  sendText: { color: colors.onAccent, fontSize: 20, fontWeight: '700', marginTop: -2 },
  pressed: { opacity: 0.6 },
  legal: { ...COLUMN, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  legalText: { color: colors.tertiary, fontSize: 12 },
  legalLink: { color: colors.tertiary, fontSize: 12, textDecorationLine: 'underline' },
});
