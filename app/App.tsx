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
import { unsubscribeFromNews } from './src/admin';
import { isMember, loadProfile } from './src/auth';
import { CaptchaHost } from './src/captcha';
import { ANALYTICS_ENABLED } from './src/analytics';
import { CookieBanner, type CookieBannerHandle } from './src/CookieBanner';
import { InstallCard } from './src/InstallCard';
import { NotifyCard } from './src/NotifyCard';
import { loginGreeting } from './src/greeting';
import { askMichel, type ChatMessage } from './src/chat';
import { loadAccountMemory, loadMemory, saveAccountMemory, saveMemory } from './src/memory';
import { DEFAULT_SUGGESTIONS, MODES, findMode, loadMode, saveMode } from './src/modes';
import { isOffline, registerServiceWorker } from './src/pwa';
import { syncPush } from './src/push';
import { RichText } from './src/RichText';
import { makeCard, type Card } from './src/shareCard';
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
  { label: 'Nouveautés', path: '/nouveautes' },
  { label: 'Mentions légales', path: '/mentions-legales.html' },
  { label: 'Confidentialité', path: '/confidentialite.html' },
  { label: 'Conditions', path: '/conditions.html' },
];

// « local » : mot de Michel affiché seulement ici, jamais renvoyé à l'IA ni gardé en mémoire.
type Bubble = ChatMessage & { id: string; failed?: boolean; local?: boolean };

registerServiceWorker();

let nextId = 0;
const newId = () => String(nextId++);

export default function App() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>();
  const [mode, setMode] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountMode | null>(null);
  const [admin, setAdmin] = useState(false);
  const [sharing, setSharing] = useState<Card | null>(null);
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
      .map(({ role, content }) => ({ role, content }));
    saveMemory({ name, messages });
    if (memberId && syncedFor === memberId) saveAccountMemory(memberId, { name, messages });
  }, [bubbles, name, busy, loaded, memberId, syncedFor]);

  async function send(input = draft) {
    const text = input.trim();
    if (!text || busy) return;

    const question: Bubble = { id: newId(), role: 'user', content: text };
    const answerId = newId();
    // Les bulles vont par paires question / réponse ; une paire en échec n'est pas renvoyée à Michel.
    const history = [
      ...bubbles.filter((b) => !b.local).filter((b, i, all) => !b.failed && !all[i + 1]?.failed),
      question,
    ];
    setBubbles([...bubbles, question, { id: answerId, role: 'assistant', content: '' }]);
    setDraft('');
    setBusy(true);

    const updateAnswer = (change: (b: Bubble) => Bubble) =>
      setBubbles((all) => all.map((b) => (b.id === answerId ? change(b) : b)));

    try {
      const learned = await askMichel(
        history.map(({ role, content }) => ({ role, content })),
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
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && draft.trim().length > 0;
  const suggestions = findMode(mode)?.suggestions ?? DEFAULT_SUGGESTIONS;
  const modeChips = [{ id: undefined, label: '💬 Tout' }, ...MODES];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <View style={styles.avatar}>
              <Image
                source={require('./assets/brand/michel-portrait.png')}
                style={styles.avatarImage}
                accessibilityLabel="Michel"
              />
            </View>
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
              <Text style={styles.newChatText}>{member ? 'Compte' : 'Connexion'}</Text>
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
                  {item.role === 'user' || item.failed ? (
                    <Text style={styles.userText}>{item.content}</Text>
                  ) : item.content ? (
                    <RichText text={item.content} style={styles.michelText} />
                  ) : (
                    <Text style={styles.thinking}>Michel cherche ses lunettes…</Text>
                  )}
                </View>
              );
              // Une réponse terminée se partage en carte image, avec la question qui l'a amenée.
              const done = !(busy && index === bubbles.length - 1);
              if (item.role === 'user' || item.failed || !item.content || !done) return bubble;
              const asked = bubbles[index - 1];
              return (
                <View>
                  {bubble}
                  <Pressable
                    onPress={() => setSharing(makeCard(item.content, asked?.role === 'user' ? asked.content : undefined))}
                    style={({ pressed }) => [styles.shareLink, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Partager cette réponse en image"
                    hitSlop={8}
                  >
                    <Text style={styles.shareLinkText}>Partager</Text>
                  </Pressable>
                </View>
              );
            }}
          />

          <SafeAreaView edges={['bottom']} style={styles.bottom}>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Pose ta question à Michel…"
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
            onAdmin={() => {
              setAccount(null);
              setAdmin(true);
            }}
          />
        )}
        {admin && member && <AdminScreen onClose={() => setAdmin(false)} />}
        {sharing && <ShareSheet card={sharing} onClose={() => setSharing(null)} />}
        <CaptchaHost />
        <CookieBanner ref={cookiesRef} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.bar,
  },
  headerInner: {
    ...COLUMN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
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
  list: { ...COLUMN, paddingHorizontal: 16, paddingVertical: 20, gap: 10 },
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
  user: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  failed: { backgroundColor: colors.failed },
  michelText: { color: colors.text, fontSize: 16, lineHeight: 23 },
  userText: { color: colors.onAccent, fontSize: 16, lineHeight: 23 },
  shareLink: { alignSelf: 'flex-start', marginTop: 4, marginLeft: 6 },
  shareLinkText: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
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
  legal: { ...COLUMN, flexDirection: 'row', justifyContent: 'center', paddingVertical: 8 },
  legalText: { color: colors.tertiary, fontSize: 12 },
  legalLink: { color: colors.tertiary, fontSize: 12, textDecorationLine: 'underline' },
});
