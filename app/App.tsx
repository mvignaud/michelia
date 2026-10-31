import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
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
import { causetteId, copier, plain, type Echange } from './src/causette';
import { Comptoir } from './src/Comptoir';
import { ConversationSheet } from './src/ConversationSheet';
import { Cotisation } from './src/Cotisation';
import { cleAppli, loadComptoir } from './src/comptoir';
import { CookieBanner, type CookieBannerHandle } from './src/CookieBanner';
import { Doleances } from './src/Doleances';
import { InstallCard } from './src/InstallCard';
import { InvitationCard } from './src/InvitationCard';
import { inviter, type Invitation, type Moment } from './src/invitations';
import { NotifyCard } from './src/NotifyCard';
import { forgetLoginGreeting, loginGreeting } from './src/greeting';
import { askMichel, type ChatMessage } from './src/chat';
import { noterReponse, nouvelleCle } from './src/notes';
import { loadAccountMemory, loadMemory, saveAccountMemory, saveMemory } from './src/memory';
import { pickPhoto, photoUri, type Photo } from './src/photo';
import { AvatarMichel } from './src/Blocs';
import { COLUMN, ecran } from './src/ecran';
import { useDictee } from './src/dictee';
import { DEFAULT_SUGGESTIONS, MODES, findMode, loadMode, saveMode } from './src/modes';
import { isOffline, registerServiceWorker } from './src/pwa';
import { syncPush } from './src/push';
import { RichText } from './src/RichText';
import { makeCard, type Card } from './src/shareCardModel';
import { ShareSheet } from './src/ShareSheet';
import { supabase } from './src/supabase';
import { colors, serif } from './src/theme';

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
  // Sur le web, la page /comptoir (Stripe). Dans les applis, le comptoir par achat intégré s'ouvre par-dessus le chat.
  ...(Platform.OS === 'web' ? [{ label: 'Le comptoir', path: '/comptoir' }] : []),
];

// « local » : mot de Michel affiché seulement ici, jamais renvoyé à l'IA ni gardé en mémoire.
// « note » : les étoiles données à une réponse de Michel (cle : son identifiant pour la base).
type Bubble = ChatMessage & { id: string; failed?: boolean; local?: boolean; note?: number; cle?: string };

registerServiceWorker();

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
  const [mode, setMode] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountMode | null>(null);
  const [admin, setAdmin] = useState(false);
  const [sharing, setSharing] = useState<Card | null>(null);
  // Toute la conversation à partager (lien public ou texte), et la réponse qu'on vient de copier.
  const [conversation, setConversation] = useState<Echange[] | null>(null);
  const [copied, setCopied] = useState<string>();
  const [avatar, setAvatar] = useState<Avatar>(() => avatarFromSeed(''));
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
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setAccount('reset');
      // Déconnexion : la conversation reste sur le compte, on l'efface de l'appareil.
      if (event === 'SIGNED_OUT') {
        setBubbles([]);
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

  // Changement de mode : Michel l'annonce d'un mot, affiché seulement.
  function chooseMode(id: string | undefined) {
    if (busy || id === mode) return;
    setMode(id);
    saveMode(id);
    const hello = findMode(id)?.hello ?? "Bon, on reprend la causette normale. Demande-moi ce que tu veux.";
    setBubbles((all) => [...all, { id: newId(), role: 'assistant', content: hello, local: true }]);
  }

  useEffect(() => {
    loadMemory().then((memory) => {
      setName(memory.name);
      setBubbles((current) => [...memory.messages.map((m) => ({ ...m, id: newId() })), ...current]);
      setLoaded(true);
    });
  }, []);

  // Membre : on reprend la conversation gardée sur le compte. S'il n'y en a pas encore,
  // celle de l'appareil y sera envoyée à la prochaine sauvegarde.
  const [syncedFor, setSyncedFor] = useState<string>();
  useEffect(() => {
    setSyncedFor(undefined);
    if (!memberId || !loaded) return;
    let cancelled = false;
    loadAccountMemory(memberId).then((remote) => {
      if (cancelled) return;
      if (remote?.messages.length) {
        setBubbles((current) => [
          ...remote.messages.map((m) => ({ ...m, id: newId() })),
          ...current.filter((b) => b.local),
        ]);
      }
      if (remote?.name) setName((current) => current ?? remote.name);
      setSyncedFor(memberId);
    });
    return () => {
      cancelled = true;
    };
  }, [memberId, loaded]);

  // On sauvegarde une fois la réponse terminée, sans les échanges en échec.
  useEffect(() => {
    if (!loaded || busy) return;
    const messages = bubbles
      .filter((b) => !b.local)
      .filter((b, i, all) => !b.failed && !all[i + 1]?.failed)
      .map(({ role, content, photo }) => ({ role, content, photo }));
    saveMemory({ name, messages });
    if (memberId && syncedFor === memberId) saveAccountMemory(memberId, { name, messages });
  }, [bubbles, name, busy, loaded, memberId, syncedFor]);

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
        (chunk) => updateAnswer((b) => ({ ...b, content: b.content + chunk })),
      );
      if (learned.name) setName(learned.name);
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
    else ouvrirComptoir();
  }

  // Le comptoir : la page /comptoir sur le web, l'achat intégré dans les applis.
  function ouvrirComptoir() {
    if (Platform.OS === 'web') window.location.assign('/comptoir');
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <View style={styles.headerInner}>
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
                onPress={() => setBubbles([])}
                style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Nouvelle discussion"
              >
                <Text style={styles.newChatText}>Nouveau</Text>
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
          </ScrollView>
        </View>

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
                    onPress={() => Linking.openURL(SITE + l.path)}
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
