import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { lireCausette, type Echange } from './causette';
import { RichText } from './RichText';
import { colors, serif } from './theme';

// Page publique d'une causette partagée (michel.beer/la-causette/<id>), en lecture seule.
// Le web seulement : les applis ouvrent ces liens dans le navigateur.
export function Causette({ id }: { id: string }) {
  const [state, setState] = useState<{ messages: Echange[]; date: string } | 'chargement' | 'absente' | 'erreur'>(
    'chargement',
  );

  useEffect(() => {
    // Pas de référencement : une causette se partage, elle ne se cherche pas.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    document.title = 'Une causette avec Michel';
    lireCausette(id).then(
      (data) =>
        setState(data ? { messages: data.messages, date: new Date(data.created_at).toLocaleDateString('fr-FR') } : 'absente'),
      () => setState('erreur'),
    );
    return () => robots.remove();
  }, [id]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.avatar}>
            <Image source={require('../assets/brand/michel-portrait.png')} style={styles.avatarImage} accessibilityLabel="Michel" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Une causette avec Michel</Text>
            <Text style={styles.status}>
              {typeof state === 'object' ? `Partagée par un visiteur le ${state.date}` : 'Le papi du Gers coincé dans la machine'}
            </Text>
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {state === 'chargement' && <ActivityIndicator color={colors.accent} style={styles.loader} />}
        {(state === 'absente' || state === 'erreur') && (
          <View style={[styles.bubble, styles.michel]}>
            <Text style={styles.michelText}>
              {state === 'absente'
                ? "Pétard, cette causette a disparu : celui qui l'a partagée l'a retirée, ou le lien est faux."
                : "Miladiou, j'arrive pas à retrouver cette causette. Réessaie dans un moment, con."}
            </Text>
          </View>
        )}
        {typeof state === 'object' &&
          state.messages.map((m, i) =>
            m.role === 'user' ? (
              <View key={i} style={[styles.bubble, styles.user]}>
                <Text style={styles.userText} selectable>
                  {m.content}
                </Text>
              </View>
            ) : (
              <View key={i} style={[styles.bubble, styles.michel]}>
                <RichText text={m.content} style={styles.michelText} selectable />
              </View>
            ),
          )}
        <View style={styles.footer}>
          <Pressable
            onPress={() => window.location.assign('/chat')}
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            accessibilityRole="link"
          >
            <Text style={styles.ctaText}>Discuter avec Michel</Text>
          </Pressable>
          <Text style={styles.disclaimer}>
            Michel est une intelligence artificielle qui joue un papi du Gers. Il peut se tromper, et cette page a
            été partagée par un visiteur : michel.beer ne vérifie pas ce qu'elle contient.{' '}
            <Text style={styles.link} onPress={() => window.location.assign('/cahier-de-doleances')} accessibilityRole="link">
              Signaler cette causette
            </Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.bar },
  headerInner: { ...COLUMN, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
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
  status: { color: colors.secondary, fontSize: 13, marginTop: 1 },
  list: { ...COLUMN, paddingHorizontal: 16, paddingVertical: 20, gap: 10 },
  loader: { marginTop: 40 },
  bubble: { maxWidth: '82%', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10 },
  michel: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 6,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  user: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  michelText: { color: colors.text, fontSize: 16, lineHeight: 23 },
  userText: { color: colors.onAccent, fontSize: 16, lineHeight: 23 },
  footer: { alignItems: 'center', gap: 14, marginTop: 20 },
  cta: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, backgroundColor: colors.accent },
  ctaText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  disclaimer: { color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 12 },
  link: { color: colors.secondary, textDecorationLine: 'underline' },
  pressed: { opacity: 0.6 },
});
