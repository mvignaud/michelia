import AsyncStorage from '@react-native-async-storage/async-storage';

// Modes thématiques : l'appli n'envoie que l'identifiant. La consigne donnée à Michel
// vit dans app_config (clé mode_<id>), hors du dépôt public, et se règle sans redéployer.
export type Mode = {
  id: string;
  label: string;
  // Ce que Michel dit quand on passe dans ce mode (affiché seulement, jamais envoyé à l'IA).
  hello: string;
  suggestions: string[];
};

export const DEFAULT_SUGGESTIONS = [
  'Une recette de garbure',
  'Écris un mot pour mon voisin',
  "Explique-moi l'inflation",
  'Quel temps fait-il ?',
];

export const MODES: Mode[] = [
  {
    id: 'cuisine',
    label: '🍲 Cuisine',
    hello: "Bon, on passe aux fourneaux. Dis-moi ce que t'as dans le frigo et je te sors une recette d'ici, avec les quantités, con.",
    suggestions: ['Une vraie garbure', 'Que faire avec un magret ?', 'Un dessert gersois', 'Menu pour 8 copains'],
  },
  {
    id: 'rugby',
    label: '🏉 Rugby',
    hello: "Ah, le rugby ! Là tu parles à un connaisseur. Règles, histoire, troisième mi-temps : vas-y, envoie le ballon.",
    suggestions: ['Explique-moi le hors-jeu', "C'est quoi une mêlée ?", "L'histoire du FC Auch", 'Les postes au rugby'],
  },
  {
    id: 'jardin',
    label: '🌱 Jardin',
    hello: "On sort les bottes. Potager, verger, fleurs : demande, j'ai les mains dans la terre depuis soixante ans.",
    suggestions: ['Que planter ce mois-ci ?', 'Mes tomates ont des taches', 'Faire son compost', 'Tailler un pommier'],
  },
  {
    id: 'gascon',
    label: '🗣️ Gascon',
    hello: "Adishatz ! Aujourd'hui je t'apprends le gascon, la langue de chez nous. Demande un mot, une expression, ou dis « interro ».",
    suggestions: ['Apprends-moi à dire bonjour', 'Les jours de la semaine', 'Une expression du Gers', 'Interro !'],
  },
];

export const findMode = (id: string | undefined) => MODES.find((m) => m.id === id);

const KEY = 'michelia:mode:v1';

export async function loadMode(): Promise<string | undefined> {
  try {
    return findMode((await AsyncStorage.getItem(KEY)) ?? undefined)?.id;
  } catch {
    return undefined;
  }
}

export async function saveMode(id: string | undefined): Promise<void> {
  try {
    if (id) await AsyncStorage.setItem(KEY, id);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // Stockage bloqué : le mode sera oublié au prochain lancement, tant pis.
  }
}
