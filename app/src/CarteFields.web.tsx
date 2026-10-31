import { type ComponentType } from 'react';
import { Text, TextInput, View } from 'react-native';
import { formatExpiration, formatNumero } from './carte';
import { ecran, ecranPaiement } from './ecran';
import { colors } from './theme';

// Ce que le comptoir et la cotisation (web) partagent pour taper sa carte : l'enveloppe de la page,
// les champs de la carte, et le cadre de la banque pour le 3D Secure.

// Le champ de saisie sur le web (contour aux couleurs de la page).
export const champ = { ...ecran.input, outlineColor: colors.accent };

// La page qui reçoit la carte. Dans le cadre du 3D Secure, on prévient la page autour, qui vérifie le
// paiement auprès du serveur. Pas de mesure d'audience là où l'on tape sa carte : si elle tourne déjà
// dans ce document, on recharge pour que les champs vivent dans une page sans aucun script tiers.
export function PageCarte({ Page }: { Page: ComponentType }) {
  if (window.top !== window.self) {
    try {
      window.parent.postMessage({ status: 'retour-3ds' }, window.location.origin);
    } catch {
      // La vérification régulière de la page prendra le relais.
    }
    return <Text style={[ecran.text, ecran.padded]}>Je vérifie avec ta banque, deux secondes…</Text>;
  }
  if ('gtag' in window) {
    window.location.replace(window.location.href);
    return null;
  }
  return <Page />;
}

type Champs = {
  numero: string;
  setNumero: (v: string) => void;
  expiration: string;
  setExpiration: (v: string) => void;
  cvc: string;
  setCvc: (v: string) => void;
};

export function ChampsCarte({ numero, setNumero, expiration, setExpiration, cvc, setCvc }: Champs) {
  return (
    <>
      <TextInput
        value={numero}
        onChangeText={(t) => setNumero(formatNumero(t))}
        placeholder="Numéro de carte"
        placeholderTextColor={colors.tertiary}
        keyboardType="number-pad"
        autoComplete="cc-number"
        style={champ}
      />
      <View style={ecranPaiement.row}>
        <TextInput
          value={expiration}
          onChangeText={(t) => setExpiration(formatExpiration(t))}
          placeholder="MM/AA"
          placeholderTextColor={colors.tertiary}
          keyboardType="number-pad"
          autoComplete="cc-exp"
          style={[champ, ecranPaiement.half]}
        />
        <TextInput
          value={cvc}
          onChangeText={(t) => setCvc(t.replace(/\D/g, '').slice(0, 4))}
          placeholder="Code au dos"
          placeholderTextColor={colors.tertiary}
          keyboardType="number-pad"
          autoComplete="cc-csc"
          secureTextEntry
          style={[champ, ecranPaiement.half]}
        />
      </View>
    </>
  );
}

// La page 3D Secure de la banque, à sa hauteur.
export function CadreBanque({ src, hauteur }: { src: string; hauteur: number }) {
  return (
    <iframe
      src={src}
      title="Vérification de ta banque"
      allow="payment"
      style={{ width: '100%', height: hauteur, border: 0, borderRadius: 12, backgroundColor: colors.background }}
    />
  );
}
