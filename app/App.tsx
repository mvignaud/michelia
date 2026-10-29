import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { askMichel, type ChatMessage } from './src/chat';
import { colors, serif } from './src/theme';

const WELCOME =
  "Adishatz ! C'est Michel. Je sais pas comment, mais je suis coincé dans cette fichue machine. " +
  "Tant que j'y suis, pose-moi ta question, boudu !";

const SUGGESTIONS = [
  'Une recette de garbure',
  'Écris un mot pour mon voisin',
  "Explique-moi l'inflation",
  'Quel temps fait-il ?',
];

// Sur le web les pages légales sont servies par le même site ; dans les applis, par michel.beer.
const SITE = Platform.OS === 'web' ? '' : 'https://michel.beer';
const LEGAL_LINKS = [
  { label: 'Mentions légales', path: '/mentions-legales.html' },
  { label: 'Confidentialité', path: '/confidentialite.html' },
  { label: 'Conditions', path: '/conditions.html' },
];

type Bubble = ChatMessage & { id: string; failed?: boolean };

let nextId = 0;
const newId = () => String(nextId++);

export default function App() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Bubble>>(null);

  async function send(input = draft) {
    const text = input.trim();
    if (!text || busy) return;

    const question: Bubble = { id: newId(), role: 'user', content: text };
    const answerId = newId();
    // Les bulles vont par paires question / réponse ; une paire en échec n'est pas renvoyée à Michel.
    const history = [
      ...bubbles.filter((b, i, all) => !b.failed && !all[i + 1]?.failed),
      question,
    ];
    setBubbles([...bubbles, question, { id: answerId, role: 'assistant', content: '' }]);
    setDraft('');
    setBusy(true);

    const updateAnswer = (change: (b: Bubble) => Bubble) =>
      setBubbles((all) => all.map((b) => (b.id === answerId ? change(b) : b)));

    try {
      await askMichel(
        history.map(({ role, content }) => ({ role, content })),
        (chunk) => updateAnswer((b) => ({ ...b, content: b.content + chunk })),
      );
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Macarel, ça a planté.';
      updateAnswer((b) => ({ ...b, content: message, failed: true }));
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && draft.trim().length > 0;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>M</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Michel</Text>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.status}>Coincé dans la machine</Text>
              </View>
            </View>
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
        </View>

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlatList
            ref={listRef}
            data={bubbles}
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
                  <Text style={styles.michelText}>{WELCOME}</Text>
                </View>
              </View>
            }
            ListFooterComponent={
              bubbles.length === 0 ? (
                <View style={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
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
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.role === 'user' ? styles.user : styles.michel,
                  item.failed && styles.failed,
                ]}
              >
                {item.content ? (
                  <Text
                    style={item.role === 'user' || item.failed ? styles.userText : styles.michelText}
                  >
                    {item.content}
                  </Text>
                ) : (
                  <Text style={styles.thinking}>Michel cherche ses lunettes…</Text>
                )}
              </View>
            )}
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
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
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
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ochre,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.onAccent, fontSize: 19, fontFamily: serif, fontWeight: '700' },
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
