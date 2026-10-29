import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

// Petit mot de Michel juste après une connexion, selon le moyen choisi.
const LINES: Record<string, string[]> = {
  facebook: [
    "Et dis, tu te connectes avec le Face de Book, toi ? Moi, le seul mur où j'affichais quelque chose, c'était celui de la grange. Allez, te voilà des nôtres, con !",
    "Ah, le Face de Book ! Ma cousine Paulette y met les photos de son chat tous les matins. Toi au moins, tu t'en sers pour venir causer avec Michel, pardi !",
  ],
  google: [
    "Té, tu t'es connecté avec Gogole ! Moi, Gogole, je lui demande la météo et il me sort des pubs pour des tondeuses. Bon, te voilà inscrit, con !",
    "Avec Gogole, carrément ! Celui-là il sait tout, mais il a jamais goûté un confit. Allez, installe-toi, con !",
  ],
  phone: [
    "Ah, avec ton téléphone ! Moi à l'époque je recevais même pas les SMS de la Janine quand j'étais à la palombière. Toi au moins ton code est arrivé, miladiou !",
    "Un code par SMS, comme les jeunes ! À la palombière, le seul réseau qu'on avait, c'était le cri du geai. Bienvenue, con !",
  ],
  apple: [
    "Avec la pomme, carrément ! Chez nous les pommes, on les met dans la croustade, pas dans les téléphones. Bon, bienvenue quand même, con !",
  ],
  email: [
    "Et beh, à l'ancienne, avec l'e-mail ! Ça me plaît, ça, c'est du solide comme une mêlée de Fleurance. Te voilà inscrit, con !",
  ],
};

const KEY = 'michelia:dernier-accueil';

// Renvoie le mot d'accueil une seule fois par connexion (pas à chaque rechargement de la page).
export async function loginGreeting(session: Session | null): Promise<string | undefined> {
  const user = session?.user;
  if (!user || user.is_anonymous || !user.last_sign_in_at) return undefined;
  const marker = `${user.id}:${user.last_sign_in_at}`;
  try {
    if ((await AsyncStorage.getItem(KEY)) === marker) return undefined;
    await AsyncStorage.setItem(KEY, marker);
  } catch {
    return undefined;
  }
  const provider = String(user.app_metadata?.provider ?? 'email');
  const lines = LINES[provider] ?? LINES.email;
  return lines[Math.floor(Math.random() * lines.length)];
}
