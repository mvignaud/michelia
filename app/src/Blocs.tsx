import { Image, Pressable, Text, View, type PressableProps, type TextStyle, type ViewStyle } from 'react-native';
import { euros, type Comptoir as Data } from './comptoir';
import { ecran, ecranComptoir } from './ecran';

// Les pièces que se partagent les écrans de Michel : barre du haut, textes de la cotisation, cartes du comptoir.

export function AvatarMichel() {
  return (
    <View style={ecran.avatar}>
      <Image source={require('../assets/brand/michel-portrait.png')} style={ecran.avatarImage} accessibilityLabel="Michel" />
    </View>
  );
}

// Barre du haut d'un écran plein cadre : la bobine de Michel, le titre, et le lien pour en sortir.
export function BarreMichel({
  titre,
  retour,
  ...lien
}: { titre: string; retour: string } & Pick<PressableProps, 'onPress' | 'accessibilityRole' | 'hitSlop'>) {
  return (
    <View style={ecran.bar}>
      <View style={ecran.barInner}>
        <AvatarMichel />
        <Text style={ecran.title}>{titre}</Text>
        <Pressable {...lien}>
          <Text style={ecran.back}>{retour}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Ce que MichelIA+ apporte, en tête de la page cotisation (web et applis, où la carte n'a pas d'ombre).
export function PitchCotisation({ carte = ecran.card }: { carte?: ViewStyle }) {
  return (
    <>
      <Text style={ecran.quote}>
        « Michel gratuit reste gratuit. La cotisation, c'est pour ceux qui causent beaucoup, et qui veulent me donner un coup de
        main. »
      </Text>
      <View style={carte}>
        <Text style={ecran.cardTitle}>Ce que ça change</Text>
        <Text style={ecran.text}>• Bien plus de messages par jour, et plus de photos.</Text>
        <Text style={ecran.text}>• Ma voix, quand j'aurai trouvé le bon Gascon pour me la prêter.</Text>
        <Text style={ecran.text}>• Et tu fais tourner la boutique, sans pub, pour tout le monde.</Text>
      </View>
    </>
  );
}

// Le grand merci (pourboire reçu, bienvenue au club).
export function CarteMerci({ children, textStyle, carte = ecran.card }: { children: string; textStyle?: TextStyle; carte?: ViewStyle }) {
  return (
    <View style={[carte, ecran.thanks]}>
      <Text style={[ecran.thanksText, textStyle]}>{children}</Text>
    </View>
  );
}

export function ComptoirBientot() {
  return (
    <View style={ecran.card}>
      <Text style={ecran.quote}>Le comptoir ouvre bientôt, con.</Text>
      <Text style={ecran.text}>Je finis de ranger les verres. Repasse dans pas longtemps.</Text>
    </View>
  );
}

export function NoteDuMois({ note }: { note: Data['note_du_mois'] }) {
  return (
    <View style={ecran.card}>
      <Text style={ecran.cardTitle}>La note du mois</Text>
      <View style={ecranComptoir.track}>
        <View style={[ecranComptoir.fill, { width: `${Math.min(100, note.pourcent)}%` }]} />
      </View>
      <Text style={ecran.text}>
        {note.pourcent} % de l'électricité du mois est couverte
        {note.cout_eur > 0 ? ` (${euros(Math.round(note.recu_eur * 100))} sur ${euros(Math.round(note.cout_eur * 100))}).` : '.'}
      </Text>
    </View>
  );
}

export function CarnetDesCopains({ carnet }: { carnet: string[] }) {
  return (
    <View style={ecran.card}>
      <Text style={ecran.cardTitle}>Le carnet des copains</Text>
      {carnet.length ? (
        <Text style={ecran.text}>{carnet.join(' · ')}</Text>
      ) : (
        <Text style={ecran.text}>Le carnet est vide. Tu veux être le premier, hè ?</Text>
      )}
    </View>
  );
}
