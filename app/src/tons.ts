import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Le ton de Michel : l'appli n'envoie que l'identifiant ; la consigne vit côté serveur.
export type TonId = 'soft' | 'normal' | 'hard' | 'ultra';

export type Ton = {
  id: TonId;
  label: string;
  // Une ligne pour la liste de choix.
  description: string;
  // Ton réservé aux inscrits majeurs.
  dur: boolean;
  // Ce que Michel dit quand on passe à ce ton (affiché seulement, jamais envoyé à l'IA).
  hello: string;
};

export const TONS: Ton[] = [
  {
    id: 'soft',
    label: '🕊️ Soft',
    description: 'Michel poli, presque gendre idéal',
    dur: false,
    hello: "Bon, d'accord, je file doux. Pas un mot de travers, promis, même si ça me démange.",
  },
  {
    id: 'normal',
    label: '💬 Normal',
    description: 'Michel comme d’habitude',
    dur: false,
    hello: "Retour au Michel de tous les jours, ni trop ni trop peu. Vas-y, je t'écoute, con.",
  },
  {
    id: 'hard',
    label: '🌶️ Hard',
    description: 'Vannes plus salées, apéro, sous-entendus',
    dur: true,
    hello: "Ah, tu veux du piquant ! Accroche-toi, on va se lâcher un peu, con.",
  },
  {
    id: 'ultra',
    label: '🔥 Ultra-hard',
    description: 'Michel sans filtre, humour de troisième mi-temps',
    dur: true,
    hello: "Michel sans filtre, troisième mi-temps ! Accroche-toi au comptoir, ça va chauffer, con.",
  },
];

export const findTon = (id: string | undefined) => TONS.find((t) => t.id === id);

// Ton « dur » (hard, ultra) : proposé seulement sur le web (le site, l'appli de bureau et l'extension
// Chrome utilisent la version web), le temps de relever la classification d'âge de l'App Store et de
// Google Play. Le serveur applique la même règle.
export const TONS_DURS_DISPONIBLES = Platform.OS === 'web';

const KEY = 'michelia:ton:v1';
const KEY_MAJEUR = 'michelia:ton:majeur:v1';

export async function loadTon(): Promise<TonId | undefined> {
  try {
    return findTon((await AsyncStorage.getItem(KEY)) ?? undefined)?.id;
  } catch {
    return undefined;
  }
}

export async function saveTon(id: TonId): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // Stockage bloqué : le ton sera oublié au prochain lancement, tant pis.
  }
}

// Confirmation « j'ai 18 ans », retenue sur l'appareil.
export async function loadMajeur(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_MAJEUR)) === '1';
  } catch {
    return false;
  }
}

export async function saveMajeur(value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(KEY_MAJEUR, '1');
    else await AsyncStorage.removeItem(KEY_MAJEUR);
  } catch {
    // Stockage bloqué : la confirmation sera redemandée.
  }
}
