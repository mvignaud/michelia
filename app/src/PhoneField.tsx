import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from './theme';

// Pays proposés pour le numéro de portable (France en premier, puis outre-mer et voisins).
export const COUNTRIES = [
  { code: 'FR', name: 'France', dial: '+33' },
  { code: 'RE', name: 'La Réunion', dial: '+262' },
  { code: 'GP', name: 'Guadeloupe', dial: '+590' },
  { code: 'MQ', name: 'Martinique', dial: '+596' },
  { code: 'GF', name: 'Guyane', dial: '+594' },
  { code: 'NC', name: 'Nouvelle-Calédonie', dial: '+687' },
  { code: 'PF', name: 'Polynésie française', dial: '+689' },
  { code: 'BE', name: 'Belgique', dial: '+32' },
  { code: 'CH', name: 'Suisse', dial: '+41' },
  { code: 'LU', name: 'Luxembourg', dial: '+352' },
  { code: 'MC', name: 'Monaco', dial: '+377' },
  { code: 'AD', name: 'Andorre', dial: '+376' },
  { code: 'ES', name: 'Espagne', dial: '+34' },
  { code: 'PT', name: 'Portugal', dial: '+351' },
  { code: 'IT', name: 'Italie', dial: '+39' },
  { code: 'DE', name: 'Allemagne', dial: '+49' },
  { code: 'GB', name: 'Royaume-Uni', dial: '+44' },
  { code: 'IE', name: 'Irlande', dial: '+353' },
  { code: 'NL', name: 'Pays-Bas', dial: '+31' },
  { code: 'CA', name: 'Canada', dial: '+1' },
  { code: 'US', name: 'États-Unis', dial: '+1' },
  { code: 'MA', name: 'Maroc', dial: '+212' },
  { code: 'DZ', name: 'Algérie', dial: '+213' },
  { code: 'TN', name: 'Tunisie', dial: '+216' },
  { code: 'SN', name: 'Sénégal', dial: '+221' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '+225' },
];

type Country = (typeof COUNTRIES)[number];

const flag = (code: string) =>
  String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

// Numéro complet : indicatif du pays + numéro sans son 0 de tête (sauf s'il commence déjà par + ou 00).
export function fullPhone(country: Country, local: string) {
  const value = local.trim();
  if (value.startsWith('+') || value.startsWith('00')) return value;
  return country.dial + value.replace(/[\s.\-()]/g, '').replace(/^0/, '');
}

type Props = {
  country: Country;
  onCountry: (country: Country) => void;
  value: string;
  onChangeText: (value: string) => void;
  last?: boolean;
};

export function PhoneField({ country, onCountry, value, onChangeText, last }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.field, !last && styles.border]}>
      <Text style={styles.label}>Numéro de portable</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityLabel={`Pays : ${country.name}`}
          style={({ pressed }) => [styles.prefix, pressed && styles.pressed]}
        >
          <Text style={styles.prefixText}>
            {flag(country.code)} {country.dial} ▾
          </Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="6 12 34 56 78"
          placeholderTextColor={colors.tertiary}
        />
      </View>
      {open && (
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {COUNTRIES.map((c) => (
            <Pressable
              key={c.code}
              onPress={() => {
                onCountry(c);
                setOpen(false);
              }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, c.code === country.code && styles.selected]}>
                {flag(c.code)} {c.name} {c.dial}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { paddingVertical: 8 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  label: { color: colors.secondary, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
  },
  prefixText: { color: colors.text, fontSize: 16 },
  input: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: 4 },
  list: { maxHeight: 220, marginTop: 8 },
  option: { paddingVertical: 8 },
  optionText: { color: colors.text, fontSize: 15 },
  selected: { color: colors.accent, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
