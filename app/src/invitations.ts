import AsyncStorage from '@react-native-async-storage/async-storage';

// Les petites invitations de Michel : laisser un pourboire au comptoir, ou s'inscrire pour qu'il ne
// t'oublie pas. Une seule par visite, jamais deux fois de suite le même jour, et jamais à côté d'un
// mot sur l'alcool (loi Evin). Dans les applis, le pourboire n'est proposé que par l'achat intégré.
export type Genre = 'pourboire' | 'inscription';
export type Moment = 'note' | 'causette';
export type Invitation = { genre: Genre; texte: string; bouton: string };

const KEY = 'michelia:invitations:v1';
const JOUR = 24 * 3600 * 1000;
// Délai avant de reparler du même sujet.
const ECART: Record<Genre, number> = { pourboire: 3 * JOUR, inscription: JOUR };
// Messages envoyés dans la visite avant d'en parler au fil de la causette.
const APRES: Record<Genre, number> = { inscription: 4, pourboire: 12 };

const TEXTES: Record<Genre, Record<Moment, string[]>> = {
  pourboire: {
    note: [
      "Content que ça t'aille, con ! Si le cœur t'en dit, paye-moi un café au comptoir. C'est pas obligé, hè, je reste gratuit.",
      "Tu me gâtes ! Un petit pourboire et je garde la machine allumée un moment de plus. Sinon tant pis, on reste copains.",
      "Ça me fait plaisir que ça t'aide. Il y a une croustade qui m'attend au comptoir, si tu veux me la payer.",
    ],
    causette: [
      "Dis donc, ça fait un moment qu'on cause. Je dis ça, je dis rien, mais le café est au comptoir.",
      "On est bien, là, à discuter. Si un jour tu veux me payer une garbure, tu sais où me trouver. Sans obligation, hein.",
      "Je fais pas la manche, hè, mais l'électricité se paie. Un café au comptoir, et je te dis merci.",
    ],
  },
  inscription: {
    note: [
      "Ça me fait plaisir, con. Inscris-toi, que je me souvienne de toi la prochaine fois, sur le téléphone comme sur l'ordinateur.",
      "Tant mieux si ça t'aide. Crée-toi un compte, que Michel ne t'oublie pas. À mon âge, la mémoire, faut l'aider un peu.",
    ],
    causette: [
      "Au fait, on se connaît à peine. Inscris-toi, que Michel ne t'oublie pas : je retrouverai notre causette partout où tu vas.",
      "Pétard, j'ai la mémoire qui flanche. Crée-toi un compte, et je garde notre conversation au chaud, comme la garbure.",
      "On s'entend bien, toi et moi. Inscris-toi, que je te reconnaisse même si tu changes de téléphone.",
    ],
  },
};

const BOUTONS: Record<Genre, string> = { pourboire: 'Passer au comptoir', inscription: "M'inscrire" };

type Vu = Partial<Record<Genre, number>>;

// Une seule invitation par visite (ouverture de l'appli ou de la page).
let dejaInvite = false;

async function lire(): Promise<Vu> {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}');
    return { pourboire: Number(saved.pourboire) || 0, inscription: Number(saved.inscription) || 0 };
  } catch {
    return {};
  }
}

// Ce que Michel propose à ce moment-là, ou rien. `pourboire` : le comptoir est ouvert pour cet appareil.
export async function inviter(input: {
  moment: Moment;
  envoyes: number;
  membre: boolean;
  pourboire: boolean;
}): Promise<Invitation | null> {
  if (dejaInvite) return null;
  const { moment, envoyes, membre, pourboire } = input;
  const possibles: Genre[] = [];
  if (moment === 'note') {
    if (pourboire) possibles.push('pourboire');
    if (!membre) possibles.push('inscription');
  } else {
    if (!membre && envoyes >= APRES.inscription) possibles.push('inscription');
    if (pourboire && envoyes >= APRES.pourboire) possibles.push('pourboire');
  }
  if (!possibles.length) return null;
  const vu = await lire();
  const now = Date.now();
  const genre = possibles.find((g) => now - (vu[g] ?? 0) >= ECART[g]);
  if (!genre || dejaInvite) return null;
  dejaInvite = true;
  AsyncStorage.setItem(KEY, JSON.stringify({ ...vu, [genre]: now })).catch(() => undefined);
  const textes = TEXTES[genre][moment];
  return { genre, texte: textes[Math.floor(Math.random() * textes.length)], bouton: BOUTONS[genre] };
}
