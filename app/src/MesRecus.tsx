import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { euros } from './comptoir';
import { loadRecus, obtenirRecu, type MonRecu } from './recus';
import { colors, serif } from './theme';

const jour = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

// « Mon compte » : la liste des reçus et avoirs, chacun téléchargeable (site) ou renvoyé par e-mail (applis).
// Rien n'est affiché tant que le compte n'a aucun reçu.
export function MesRecus({ userId }: { userId: string }) {
  const [recus, setRecus] = useState<MonRecu[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    loadRecus().then(setRecus).catch(() => setRecus([]));
  }, [userId]);

  if (!recus.length) return null;

  async function obtenir(numero: string) {
    setBusy(numero);
    setError(undefined);
    setNotice(undefined);
    try {
      const email = await obtenirRecu(numero);
      if (email) setNotice(`Reçu ${numero} renvoyé à ${email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ça a planté, réessaie.');
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Mes reçus</Text>
      <View style={styles.card}>
        {recus.map((r, i) => (
          <View key={r.numero} style={[styles.row, i < recus.length - 1 && styles.rowBorder]}>
            <View style={styles.main}>
              <Text style={styles.label}>{r.libelle}</Text>
              <Text style={styles.meta}>
                {jour(r.date)} · n° {r.numero}
                {r.recu && ` · sur le reçu ${r.recu}`}
                {r.rembourse_cents > 0 &&
                  (r.rembourse_cents >= r.montant_cents ? ' · Remboursé' : ` · ${euros(r.rembourse_cents)} remboursés`)}
              </Text>
            </View>
            <View style={styles.side}>
              <Text style={styles.amount}>{r.genre === 'avoir' ? `- ${euros(r.montant_cents)}` : euros(r.montant_cents)}</Text>
              {busy === r.numero ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.link} onPress={() => obtenir(r.numero)} accessibilityRole="link">
                  {Platform.OS === 'web' ? 'PDF' : 'Par e-mail'}
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, marginTop: 8 },
  title: { color: colors.text, fontSize: 17, fontFamily: serif, fontWeight: '700', paddingHorizontal: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  main: { flex: 1, gap: 2 },
  label: { color: colors.text, fontSize: 15 },
  meta: { color: colors.secondary, fontSize: 12 },
  side: { alignItems: 'flex-end', gap: 2 },
  amount: { color: colors.text, fontSize: 15, fontWeight: '600' },
  link: { color: colors.accent, fontSize: 14 },
  error: { color: colors.failed, fontSize: 14, textAlign: 'center' },
  notice: { color: colors.online, fontSize: 14, textAlign: 'center' },
});
