import { supabase } from './supabase';

// La bobine de chaque utilisateur : un petit portrait dessiné par Michel, sans service extérieur.
// Tant que l'utilisateur n'y a pas touché, le portrait se déduit de son identifiant (toujours le même) ;
// une fois retouché, ses choix sont rangés dans profiles.avatar.

type Option<T extends string = string> = { id: T; label: string; color?: string; weight?: number };

export const AVATAR_PARTS = {
  fond: [
    { id: 'mais', label: 'Maïs', color: '#F2D06B' },
    { id: 'ciel', label: 'Ciel', color: '#A9CBE3' },
    { id: 'lavande', label: 'Lavande', color: '#C9B6E4' },
    { id: 'prairie', label: 'Prairie', color: '#B9D38A' },
    { id: 'brique', label: 'Brique', color: '#E3A188' },
    { id: 'lin', label: 'Lin', color: '#EADBC4' },
  ],
  peau: [
    { id: 'p1', label: 'Très claire', color: '#F6D7C3' },
    { id: 'p2', label: 'Claire', color: '#EEC1A2' },
    { id: 'p3', label: 'Hâlée', color: '#D9A27E' },
    { id: 'p4', label: 'Mate', color: '#B97A56' },
    { id: 'p5', label: 'Brune', color: '#8D5A3B' },
    { id: 'p6', label: 'Foncée', color: '#5E3B26' },
  ],
  cheveux: [
    { id: 'court', label: 'Courts', weight: 3 },
    { id: 'frange', label: 'Frange', weight: 2 },
    { id: 'longs', label: 'Longs', weight: 2 },
    { id: 'chignon', label: 'Chignon' },
    { id: 'boucles', label: 'Bouclés', weight: 2 },
    { id: 'couronne', label: 'Dégarni' },
    { id: 'chauve', label: 'Caillou' },
  ],
  couleur: [
    { id: 'noir', label: 'Noir', color: '#2B2420' },
    { id: 'chatain', label: 'Châtain', color: '#6B4226' },
    { id: 'roux', label: 'Roux', color: '#B5542A' },
    { id: 'blond', label: 'Blond', color: '#D9B26A' },
    { id: 'gris', label: 'Gris', color: '#9A9590' },
    { id: 'blanc', label: 'Blanc', color: '#E9E4DC' },
  ],
  sourcils: [
    { id: 'calmes', label: 'Calmes', weight: 2 },
    { id: 'fronces', label: 'Râleurs' },
  ],
  yeux: [
    { id: 'points', label: 'Points', weight: 2 },
    { id: 'ronds', label: 'Ronds' },
    { id: 'rieurs', label: 'Rieurs' },
    { id: 'clin', label: "Clin d'œil" },
  ],
  nez: [
    { id: 'petit', label: 'Petit', weight: 2 },
    { id: 'patate', label: 'Patate' },
  ],
  bouche: [
    { id: 'sourire', label: 'Sourire', weight: 3 },
    { id: 'rire', label: 'Rire', weight: 2 },
    { id: 'neutre', label: 'Neutre' },
    { id: 'moue', label: 'Moue' },
  ],
  pilosite: [
    { id: 'aucune', label: 'Rien', weight: 5 },
    { id: 'gauloise', label: 'Gauloise', weight: 2 },
    { id: 'guidon', label: 'Guidon' },
    { id: 'collier', label: 'Collier' },
    { id: 'barbe', label: 'Barbe' },
  ],
  joues: [
    { id: 'non', label: 'Pâles' },
    { id: 'oui', label: 'Rouges' },
  ],
  lunettes: [
    { id: 'aucunes', label: 'Aucunes', weight: 4 },
    { id: 'rondes', label: 'Rondes' },
    { id: 'carrees', label: 'Carrées' },
    { id: 'soleil', label: 'Soleil' },
  ],
  chapeau: [
    { id: 'aucun', label: 'Tête nue', weight: 3 },
    { id: 'beret', label: 'Béret', weight: 3 },
    { id: 'casquette', label: 'Casquette' },
    { id: 'paille', label: 'Paille' },
  ],
  haut: [
    { id: 'mariniere', label: 'Marinière' },
    { id: 'vichy', label: 'Vichy' },
    { id: 'bleu', label: 'Bleu de travail' },
    { id: 'pull', label: 'Pull' },
  ],
} satisfies Record<string, Option[]>;

export type AvatarPart = keyof typeof AVATAR_PARTS;
export type Avatar = { [K in AvatarPart]: (typeof AVATAR_PARTS)[K][number]['id'] };

export const PART_LABELS: Record<AvatarPart, string> = {
  fond: 'Fond',
  peau: 'Peau',
  cheveux: 'Cheveux',
  couleur: 'Couleur des poils',
  sourcils: 'Sourcils',
  yeux: 'Yeux',
  nez: 'Nez',
  bouche: 'Bouche',
  pilosite: 'Moustache et barbe',
  joues: 'Joues',
  lunettes: 'Lunettes',
  chapeau: 'Sur la tête',
  haut: 'Habit',
};

const PARTS = Object.keys(AVATAR_PARTS) as AvatarPart[];

// Couleur d'une option (fond, peau, poils).
export function colorOf<K extends AvatarPart>(part: K, id: Avatar[K]): string {
  return (AVATAR_PARTS[part] as Option[]).find((o) => o.id === id)?.color ?? '#999999';
}

// Petit hachage (FNV-1a) puis tirage pseudo-aléatoire (mulberry32) : même identifiant, même bobine.
function seeded(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(options: Option[], random: () => number): string {
  const total = options.reduce((sum, o) => sum + (o.weight ?? 1), 0);
  let roll = random() * total;
  for (const o of options) {
    roll -= o.weight ?? 1;
    if (roll < 0) return o.id;
  }
  return options[options.length - 1].id;
}

// La bobine que Michel dessine à l'inscription, à partir de l'identifiant du compte.
export function avatarFromSeed(seed: string): Avatar {
  const random = seeded(seed || 'michel');
  const avatar = {} as Record<AvatarPart, string>;
  for (const part of PARTS) avatar[part] = pick(AVATAR_PARTS[part], random);
  return avatar as Avatar;
}

// Tirage au pif, pour le bouton de l'éditeur.
export function randomAvatar(): Avatar {
  return avatarFromSeed(`${Date.now()}-${Math.random()}`);
}

// Garde les choix connus, complète le reste avec la bobine d'origine (base ancienne ou bricolée).
export function sanitizeAvatar(raw: unknown, seed: string): Avatar {
  const base = avatarFromSeed(seed);
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Record<string, unknown>;
  const avatar = { ...base } as Record<AvatarPart, string>;
  for (const part of PARTS) {
    const value = input[part];
    if (typeof value === 'string' && (AVATAR_PARTS[part] as Option[]).some((o) => o.id === value)) avatar[part] = value;
  }
  return avatar as Avatar;
}

export async function loadAvatar(userId: string): Promise<Avatar> {
  // Sans la migration des avatars, la colonne n'existe pas encore : la bobine d'origine suffit.
  const { data } = await supabase.from('profiles').select('avatar').eq('id', userId).maybeSingle();
  return sanitizeAvatar((data as { avatar?: unknown } | null)?.avatar, userId);
}

export async function saveAvatar(userId: string, avatar: Avatar) {
  const { error } = await supabase.from('profiles').update({ avatar: { v: 1, ...avatar } }).eq('id', userId);
  if (error) throw new Error(error.code === '42703' ? "L'atelier des bobines n'est pas encore ouvert, réessaie plus tard." : "Ta bobine ne s'est pas enregistrée, réessaie.");
}
