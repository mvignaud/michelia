import { Platform, StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { colors, serif } from './theme';

// Les styles que les écrans plein cadre (comptoir, cotisation, cahier, causette, chat) se partagent.
// Chaque écran les étale dans son StyleSheet.create et garde chez lui ce qui lui est propre.
const styles = <T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(t: T) => t;

export const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;
// Les écrans du compte sont plus étroits.
export const COLUMN_COMPTE = { width: '100%', maxWidth: 480, alignSelf: 'center' } as const;

// La carte sans l'ombre (celle de la cotisation dans les applis).
export const CARTE = { backgroundColor: colors.surface, borderRadius: 16, padding: 18, gap: 10 } as const;

// Barre du haut, contenu en colonne, cartes et textes.
export const ecran = styles({
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
  padded: { margin: 24 },
  pressed: { opacity: 0.6 },
  dimmed: { opacity: 0.4 },
  card: { ...CARTE, boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)' },
  quote: { color: colors.accent, fontSize: 20, lineHeight: 28, fontFamily: serif, fontStyle: 'italic' },
  text: { color: colors.text, fontSize: 16, lineHeight: 23 },
  cardTitle: { color: colors.secondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  thanks: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.ochre },
  thanksText: { color: colors.accent, fontSize: 26, lineHeight: 34, fontFamily: serif, fontWeight: '700', textAlign: 'center' },
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
  refus: { color: colors.failed, fontSize: 15, lineHeight: 21 },
});

// Formulaires de paiement (comptoir et cotisation).
export const ecranPaiement = styles({
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minWidth: 0 },
  payer: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  payerText: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  changed: { color: colors.tertiary, fontSize: 14, textDecorationLine: 'underline', textAlign: 'center' },
});

// Paliers, note du mois et mentions du comptoir.
export const ecranComptoir = styles({
  paliers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  palierName: { color: colors.onAccent, fontSize: 17, fontFamily: serif, fontWeight: '700' },
  palierPrice: { color: colors.ochre, fontSize: 16, fontWeight: '700' },
  track: { height: 12, borderRadius: 6, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.ochre },
  small: { color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 8 },
});

// Choix de la formule et mentions de la cotisation.
export const ecranCotisation = styles({
  small: { color: colors.tertiary, fontSize: 13, lineHeight: 19 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  formule: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  formuleChoisie: { backgroundColor: colors.accent, borderColor: colors.accent },
  formuleNom: { color: colors.text, fontSize: 16, fontFamily: serif, fontWeight: '700' },
  formuleNomChoisi: { color: colors.onAccent },
  formulePrix: { color: colors.secondary, fontSize: 14 },
});

// Barre du haut des écrans du compte (compte, atelier de la bobine).
export const barreCompte = styles({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.bar,
    paddingTop: Platform.OS === 'ios' ? 48 : 0,
  },
  barInner: {
    ...COLUMN_COMPTE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 56,
  },
  title: { color: colors.text, fontSize: 20, fontFamily: serif, fontWeight: '700' },
  close: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});

// Petites cartes qui s'invitent dans le chat (installer l'appli, activer les notifications).
export const carteInvite = styles({
  card: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    boxShadow: '0 2px 10px rgba(60, 40, 20, 0.08)',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', fontFamily: serif },
  text: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  later: { height: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  laterText: { color: colors.secondary, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
