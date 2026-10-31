import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  MAX_ECHANGES,
  MES_CAUSETTES_PAGE,
  causetteTexte,
  causetteUrl,
  copier,
  mesCausettes,
  partagerCausette,
  partagerLien,
  plain,
  retirerCausette,
  type Echange,
  type MaCausette,
} from './causette';
import { colors, serif } from './theme';

const ERREURS: Record<string, string> = {
  quota: "T'as assez partagé pour aujourd'hui, con. Reviens demain.",
  invalide: 'Pétard, cette causette passe pas. Garde au moins une réponse de Michel.',
};

// Partager toute la conversation : on choisit les messages, puis on copie le texte ou on crée
// un lien public en lecture seule (michel.beer/la-causette/…). Les photos ne partent jamais.
export function ConversationSheet({ echanges, onClose }: { echanges: Echange[]; onClose: () => void }) {
  // Au-delà de la limite, on propose les derniers messages.
  const [choisis, setChoisis] = useState(() => new Set(echanges.map((_, i) => i).slice(-MAX_ECHANGES)));
  const [lien, setLien] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string>();
  const [error, setError] = useState<string>();
  const [anciens, setAnciens] = useState<MaCausette[]>([]);
  const [encore, setEncore] = useState(false);

  useEffect(() => {
    mesCausettes().then((list) => {
      setAnciens(list);
      setEncore(list.length === MES_CAUSETTES_PAGE);
    }, () => {});
  }, []);

  const selection = echanges.filter((_, i) => choisis.has(i));
  const valide = selection.length > 0 && selection.length <= MAX_ECHANGES && selection.some((e) => e.role === 'assistant');

  function basculer(i: number) {
    const next = new Set(choisis);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setChoisis(next);
    setInfo(undefined);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      await action();
    } catch (e) {
      setError(ERREURS[(e as Error).message] ?? "Miladiou, ça a coincé. Réessaie, con.");
    } finally {
      setBusy(false);
    }
  }

  const copierTexte = () =>
    run(async () => {
      await copier(causetteTexte(selection));
      setInfo('Texte copié, tu peux le coller où tu veux.');
    });

  const creerLien = () =>
    run(async () => {
      const id = await partagerCausette(selection);
      setLien(causetteUrl(id));
      setAnciens((list) => [{ id, created_at: new Date().toISOString(), apercu: selection[0].content.slice(0, 80) }, ...list]);
    });

  const partager = (url: string) =>
    run(async () => {
      if ((await partagerLien(url)) === 'copie') setInfo('Lien copié.');
    });

  const copierLien = (url: string) =>
    run(async () => {
      await copier(url);
      setInfo('Lien copié.');
    });

  const plusAnciens = () =>
    run(async () => {
      const suite = await mesCausettes(anciens[anciens.length - 1]?.created_at);
      setAnciens((list) => [...list, ...suite.filter((c) => !list.some((d) => d.id === c.id))]);
      setEncore(suite.length === MES_CAUSETTES_PAGE);
    });

  const retirer = (id: string) =>
    run(async () => {
      await retirerCausette(id);
      setAnciens((list) => list.filter((c) => c.id !== id));
      if (lien === causetteUrl(id)) setLien(undefined);
      setInfo('Lien retiré : plus personne ne peut lire cette causette.');
    });

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Partager la conversation</Text>
            {lien ? (
              <>
                <Text style={styles.text}>Voilà ton lien. Tous ceux qui l'ont pourront lire la causette.</Text>
                <Text style={styles.url} selectable>
                  {lien}
                </Text>
                <View style={styles.buttons}>
                  <Button label="Partager" onPress={() => partager(lien)} disabled={busy} primary />
                  <Button label="Copier le lien" onPress={() => copierLien(lien)} disabled={busy} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.text}>
                  Coche les messages à garder. Les photos ne partent jamais.
                  {echanges.length > MAX_ECHANGES ? ` ${MAX_ECHANGES} messages au plus par lien.` : ''}
                </Text>
                <View style={styles.list}>
                  {echanges.map((e, i) => (
                    <Pressable
                      key={i}
                      onPress={() => basculer(i)}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: choisis.has(i) }}
                    >
                      <Text style={[styles.box, choisis.has(i) && styles.boxOn]}>{choisis.has(i) ? '☑' : '☐'}</Text>
                      <Text style={[styles.rowText, !choisis.has(i) && styles.rowOff]} numberOfLines={2}>
                        <Text style={styles.who}>{e.role === 'user' ? 'Moi' : 'Michel'} : </Text>
                        {plain(e.content)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.buttons}>
                  <Button label="Copier le texte" onPress={copierTexte} disabled={busy || !valide} />
                  <Button label="Créer un lien" onPress={creerLien} disabled={busy || !valide} primary />
                </View>
                <Text style={styles.note}>
                  Le lien est public : tous ceux qui l'ont pourront lire ces messages. Tu peux le retirer quand tu veux.
                </Text>
              </>
            )}
            {info && <Text style={styles.info}>{info}</Text>}
            {error && <Text style={styles.error}>{error}</Text>}
            {anciens.length > 0 && (
              <View style={styles.anciens}>
                <Text style={styles.subtitle}>Tes liens partagés</Text>
                {anciens.map((c) => (
                  <View key={c.id} style={styles.ancien}>
                    <Text style={styles.ancienText} numberOfLines={1}>
                      {new Date(c.created_at).toLocaleDateString('fr-FR')} · {c.apercu ? plain(c.apercu) : c.id}
                    </Text>
                    <Pressable onPress={() => retirer(c.id)} disabled={busy} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.retirer}>Retirer</Text>
                    </Pressable>
                  </View>
                ))}
                {encore && (
                  <Pressable onPress={plusAnciens} disabled={busy} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.plus}>Voir les plus anciens</Text>
                  </Pressable>
                )}
              </View>
            )}
            <Button label="Fermer" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Button({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, primary && styles.primary, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43, 36, 32, 0.6)', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '90%', alignSelf: 'center', borderRadius: 18, backgroundColor: colors.background, overflow: 'hidden' },
  content: { padding: 18, gap: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', fontFamily: serif },
  subtitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  text: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  url: { color: colors.accent, fontSize: 15, fontWeight: '600', padding: 12, borderRadius: 12, backgroundColor: colors.surface },
  list: { borderRadius: 12, backgroundColor: colors.surface, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  box: { color: colors.tertiary, fontSize: 18, lineHeight: 20 },
  boxOn: { color: colors.accent },
  rowText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  rowOff: { color: colors.tertiary },
  who: { fontWeight: '700' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.surface, alignSelf: 'flex-start' },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  primary: { backgroundColor: colors.ochre },
  primaryText: { fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
  note: { color: colors.tertiary, fontSize: 12, lineHeight: 17 },
  info: { color: colors.online, fontSize: 14, fontWeight: '600' },
  error: { color: colors.failed, fontSize: 14, fontWeight: '600' },
  anciens: { gap: 6, paddingTop: 4 },
  ancien: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ancienText: { flex: 1, color: colors.secondary, fontSize: 13 },
  retirer: { color: colors.failed, fontSize: 13, fontWeight: '600' },
  plus: { color: colors.accent, fontSize: 13, fontWeight: '600', paddingTop: 4 },
});
