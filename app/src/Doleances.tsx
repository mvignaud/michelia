import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAccessToken, supabase } from './supabase';
import { colors, serif } from './theme';

// Le cahier de doléances (michel.beer/cahier-de-doleances) : une idée, un bug, une râlerie pour améliorer Michel.
// Le dépôt passe par deposer_doleance(), qui applique les quotas ; le compte anonyme vient du captcha Turnstile.
// Page à part sur le web, et par-dessus le chat partout (bulle « Une idée ? », mauvaise note d'une réponse).
const CATEGORIES = [
  { id: 'idee', label: 'Une idée' },
  { id: 'bug', label: 'Un truc qui coince' },
  { id: 'autre', label: 'Autre chose' },
] as const;
type Categorie = (typeof CATEGORIES)[number]['id'];

// Sur le web les pages sont servies par le même site ; dans les applis, par michel.beer.
const ouvrir = (path: string) => Linking.openURL((Platform.OS === 'web' ? '' : 'https://michel.beer') + path);

const REPONSES: Record<string, string> = {
  trop_court: "C'est un peu court, ça. Explique-moi un peu mieux, en dix lettres au moins.",
  trop_long: "Oh là, c'est un roman ! Mille caractères au plus, et 120 pour le contact.",
  quota: "Trois doléances par jour, ça suffit, con. Reviens demain avec les autres.",
  plein: "Le cahier est plein pour aujourd'hui. Repasse demain, je tourne la page.",
  doublon: "Celle-là, tu me l'as déjà dite. Je suis vieux, pas sourd.",
  connexion: 'Je te reconnais pas. Recharge la page et réessaie.',
};

export function Doleances({ onClose, initialCategorie = 'idee' }: { onClose: () => void; initialCategorie?: Categorie }) {
  const [categorie, setCategorie] = useState<Categorie>(initialCategorie);
  const [texte, setTexte] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [merci, setMerci] = useState(false);

  // Un membre connecté retrouve son e-mail (modifiable, facultatif).
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        const user = data.session?.user;
        if (user && !user.is_anonymous && user.email) setContact((c) => c || user.email!);
      })
      .catch(() => {});
  }, []);

  const envoyer = async () => {
    if (busy) return;
    setBusy(true);
    setRefus(null);
    try {
      await getAccessToken();
      const { data, error } = await supabase.rpc('deposer_doleance', {
        p_texte: texte,
        p_categorie: categorie,
        p_contact: contact,
      });
      if (error) throw error;
      if (data === 'ok') {
        setMerci(true);
        setTexte('');
      } else setRefus(REPONSES[data as string] ?? REPONSES.connexion);
    } catch {
      setRefus("Pétard, ça n'est pas parti. Réessaie dans un moment, ou écris à contact@michel.beer.");
    } finally {
      setBusy(false);
    }
  };

  const pret = texte.trim().length >= 10 && !busy;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <View style={styles.avatar}>
            <Image source={require('../assets/brand/michel-portrait.png')} style={styles.avatarImage} accessibilityLabel="Michel" />
          </View>
          <Text style={styles.title}>Le cahier de doléances</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.back}>Fermer</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.quote}>
            « Tu veux que je change ? À mon âge ? Bon… dis toujours, je note. »
          </Text>
          <Text style={styles.text}>
            Une idée pour améliorer Michel, un truc qui coince, une râlerie : c'est ici. On lit tout, on garde ce qui est
            bon, et ce qu'on retient part mijoter sur la page{' '}
            <Text style={styles.link} onPress={() => ouvrir('/ca-mijote')} accessibilityRole="link">
              Ça mijote
            </Text>
            .
          </Text>
        </View>

        {merci && (
          <View style={[styles.card, styles.thanks]}>
            <Text style={styles.thanksText}>C'est noté dans le cahier. Merci, hè !</Text>
            <Text style={[styles.text, styles.center]}>Une autre ? Vas-y, je suis lancé.</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>C'est quoi ?</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategorie(c.id)}
                style={[styles.chip, categorie === c.id && styles.chipActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: categorie === c.id }}
              >
                <Text style={[styles.chipText, categorie === c.id && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.cardTitle}>Ta doléance</Text>
          <TextInput
            value={texte}
            onChangeText={(t) => {
              setTexte(t);
              setMerci(false);
            }}
            placeholder="Dis-moi tout. Michel devrait…"
            placeholderTextColor={colors.tertiary}
            multiline
            maxLength={1000}
            style={[styles.input, styles.area]}
          />
          <Text style={styles.count}>{texte.length} / 1000</Text>
          <Text style={styles.cardTitle}>Pour te répondre (facultatif)</Text>
          <TextInput
            value={contact}
            onChangeText={setContact}
            placeholder="Ton e-mail, si tu veux une réponse"
            placeholderTextColor={colors.tertiary}
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={120}
            style={styles.input}
          />
          {refus && <Text style={styles.refus}>{refus}</Text>}
          <Pressable
            onPress={envoyer}
            disabled={!pret}
            style={({ pressed }) => [styles.send, !pret && styles.sendDisabled, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.sendText}>Mettre au cahier</Text>}
          </Pressable>
        </View>

        <Text style={styles.small}>
          Ne mets rien de sensible. Ta doléance et ton e-mail éventuel ne servent qu'à améliorer Michel et à te répondre, puis
          sont effacés au bout de deux ans au plus.{' '}
          <Text style={styles.smallLink} onPress={() => ouvrir('/confidentialite.html')}>
            Confidentialité
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 20 },
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
  pressed: { opacity: 0.6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    gap: 10,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  quote: { color: colors.accent, fontSize: 20, lineHeight: 28, fontFamily: serif, fontStyle: 'italic' },
  text: { color: colors.text, fontSize: 16, lineHeight: 23 },
  center: { textAlign: 'center' },
  link: { color: colors.accent, fontWeight: '600', textDecorationLine: 'underline' },
  cardTitle: { color: colors.secondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: colors.onAccent, fontWeight: '600' },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
  },
  area: { minHeight: 140, textAlignVertical: 'top' },
  count: { color: colors.tertiary, fontSize: 12, textAlign: 'right', marginTop: -4 },
  refus: { color: colors.failed, fontSize: 15, lineHeight: 21 },
  send: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  sendDisabled: { backgroundColor: colors.disabled },
  sendText: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  thanks: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.ochre },
  thanksText: { color: colors.accent, fontSize: 22, lineHeight: 30, fontFamily: serif, fontWeight: '700', textAlign: 'center' },
  small: { color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 8 },
  smallLink: { color: colors.tertiary, textDecorationLine: 'underline' },
});
