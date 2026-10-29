import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { askMichel, type ChatMessage } from './src/chat';

const WELCOME =
  "Adishatz ! C'est Michel. Je sais pas comment, mais je suis coincé dans cette fichue machine. " +
  "Tant que j'y suis, pose-moi ta question, boudu !";

type Bubble = ChatMessage & { id: string; failed?: boolean };

let nextId = 0;
const newId = () => String(nextId++);

export default function App() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Bubble>>(null);

  async function send() {
    const text = draft.trim();
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.title}>MichelIA</Text>
          <Text style={styles.subtitle}>Une IA qui joue Michel, un papi du Gers. Pas un vrai humain.</Text>
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
            ListHeaderComponent={
              <View style={[styles.bubble, styles.michel]}>
                <Text style={styles.michelText}>{WELCOME}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.role === 'user' ? styles.user : styles.michel]}>
                {item.content ? (
                  <Text style={item.role === 'user' ? styles.userText : styles.michelText}>
                    {item.content}
                  </Text>
                ) : (
                  <ActivityIndicator color="#7a2e1d" />
                )}
              </View>
            )}
          />

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Pose ta question à Michel…"
              placeholderTextColor="#8a7f72"
              multiline
              maxLength={2000}
              onSubmitEditing={send}
              submitBehavior="submit"
              editable={!busy}
            />
            <Pressable
              style={[styles.send, (busy || !draft.trim()) && styles.sendDisabled]}
              onPress={send}
              disabled={busy || !draft.trim()}
              accessibilityLabel="Envoyer"
            >
              <Text style={styles.sendText}>Envoyer</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#7a2e1d' },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: '#fff4e0', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#f3d9b8', fontSize: 13, marginTop: 2 },
  body: { flex: 1, backgroundColor: '#fbf4e8' },
  list: { padding: 16, gap: 10, width: '100%', maxWidth: 720, alignSelf: 'center' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  michel: { alignSelf: 'flex-start', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#eadfcd' },
  user: { alignSelf: 'flex-end', backgroundColor: '#7a2e1d' },
  michelText: { color: '#2b2420', fontSize: 16, lineHeight: 22 },
  userText: { color: '#fff4e0', fontSize: 16, lineHeight: 22 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#eadfcd',
    backgroundColor: '#fbf4e8',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9ccb6',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#2b2420',
  },
  send: { height: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#7a2e1d', justifyContent: 'center' },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff4e0', fontWeight: '700', fontSize: 16 },
});
