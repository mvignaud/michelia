import { Platform, Share } from 'react-native';
import { supabase } from './supabase';

// Back-office : tout passe par les fonctions admin_* de la base, qui vérifient le droit d'administrateur.

export type DayStat = { day: string; messages: number; active: number; signups: number };

export type Stats = {
  members: number;
  guests: number;
  members_7d: number;
  members_30d: number;
  news_opt_in: number;
  audience_news: number;
  audience_service: number;
  push_devices: number | null;
  messages_today: number;
  messages_7d: number;
  messages_30d: number;
  active_today: number;
  active_7d: number;
  active_members_7d: number;
  cache_answers: number;
  cache_hits: number;
  days: DayStat[];
  providers: Record<string, number>;
  ages: Record<string, number>;
};

export type AdminUser = {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_year: number | null;
  providers: string | null;
  is_anonymous: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  news_opt_in: boolean;
  messages_today: number;
  messages_7d: number;
  messages_90d: number;
  last_active: string | null;
  conversation_messages: number;
  cost_7d: number;
  cost_90d: number;
  total_count: number;
};

export type UserOrder = 'recent' | 'usage' | 'active' | 'cost';

// Coût Claude indicatif, en dollars, calculé avec les prix de app_config.
export type Costs = {
  cost_today: number;
  cost_7d: number;
  cost_30d: number;
  since: string | null;
  days: { day: string; cost: number }[];
};

// Coût réel par utilisateur actif sur 30 jours glissants, en dollars, et pourboires du mois en euros.
export type CostPerActive = {
  actifs: number;
  cout_total: number;
  cout_moyen: number;
  mediane: number;
  p90: number;
  part_top10: number;
  tranches: { label: string; actifs: number }[];
  pourboires_mois: { nombre: number; total_eur: number };
};

export type UserDay = { day: string; messages: number; cost: number };

export type Broadcast = {
  id: number;
  subject: string;
  audience: 'news' | 'service';
  channels: ('email' | 'push')[];
  created_at: string;
  email_status: string | null;
  email_total: number;
  email_sent: number;
  email_failed: number;
  email_started_at: string | null;
  push_status: string | null;
  push_sent: number;
};

export type BroadcastInput = {
  subject: string;
  body: string;
  audience: 'news' | 'service';
  channels: ('email' | 'push')[];
  test?: boolean;
};

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message || 'Ça a planté, réessaie.');
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

export async function loadStats(): Promise<Stats> {
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) fail(error);
  return data as Stats;
}

export async function loadCosts(): Promise<Costs> {
  const { data, error } = await supabase.rpc('admin_costs');
  if (error) fail(error);
  return data as Costs;
}

export async function loadCostPerActive(): Promise<CostPerActive> {
  const { data, error } = await supabase.rpc('admin_cout_par_actif');
  if (error) fail(error);
  return data as CostPerActive;
}

export const PAGE_SIZE = 50;

export async function listUsers(options: {
  search: string;
  membersOnly: boolean;
  order: UserOrder;
  page: number;
}): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_users', {
    p_search: options.search.trim() || null,
    p_members_only: options.membersOnly,
    p_order: options.order,
    p_limit: PAGE_SIZE,
    p_offset: options.page * PAGE_SIZE,
  });
  if (error) fail(error);
  return (data ?? []) as AdminUser[];
}

export async function userUsage(userId: string): Promise<UserDay[]> {
  const { data, error } = await supabase.rpc('admin_user_usage', { p_user: userId });
  if (error) fail(error);
  return data ?? [];
}

// Supprime un compte et tout ce qui lui est rattaché. Journalisé.
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_user', { p_user: userId });
  if (error) fail(error);
}

// Relie deux comptes d'une même personne : « remove » rejoint « keep » puis disparaît. Journalisé.
export async function mergeUsers(keep: string, remove: string): Promise<{ email_moved: boolean; phone_moved: boolean; providers: string[] }> {
  const { data, error } = await supabase.rpc('admin_merge_users', { p_keep: keep, p_remove: remove });
  if (error) fail(error);
  return data;
}

export async function listBroadcasts(): Promise<Broadcast[]> {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('id, subject, audience, channels, created_at, email_status, email_total, email_sent, email_failed, email_started_at, push_status, push_sent')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) fail(error);
  return (data ?? []) as Broadcast[];
}

// Renvoie le message d'erreur de la fonction « annonces » plutôt que l'erreur HTTP générique.
async function invokeAnnonces<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('annonces', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = await context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || "L'envoi a planté.");
  }
  return data as T;
}

export const sendBroadcast = (input: BroadcastInput) =>
  invokeAnnonces<{ id?: number; emails?: number; push?: boolean; test?: boolean; email?: string }>({ ...input });

// La lettre de Michel (tous les 15 jours) : la prochaine, envoyée à l'administrateur seul.
export async function testLettre(): Promise<{ email?: string; entrees: number }> {
  const { data, error } = await supabase.functions.invoke('lettre', { body: { test: true } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = await context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || 'Le test de la lettre a planté.');
  }
  return data as { email?: string; entrees: number };
}

// Reprend un envoi d'e-mails coupé : seuls ceux qui ne l'ont pas reçu sont servis.
export const resumeBroadcast = (id: number) => invokeAnnonces<{ emails?: number }>({ resume: id });

// Lien « Ne plus recevoir les nouvelles » des e-mails : michel.beer/?desabonnement=<id>.<jeton>
export async function unsubscribeFromNews(token: string): Promise<void> {
  await invokeAnnonces({ unsubscribe: token });
}

// Export des membres en CSV (séparateur « ; » et BOM pour qu'Excel l'ouvre proprement).
const COLUMNS: [keyof AdminUser, string][] = [
  ['id', 'identifiant'],
  ['email', 'email'],
  ['phone', 'telephone'],
  ['first_name', 'prenom'],
  ['last_name', 'nom'],
  ['birth_year', 'annee_naissance'],
  ['providers', 'connexions'],
  ['created_at', 'inscription'],
  ['last_sign_in_at', 'derniere_connexion'],
  ['news_opt_in', 'accepte_nouvelles'],
  ['messages_7d', 'questions_7j'],
  ['messages_90d', 'questions_90j'],
  ['last_active', 'dernier_jour_actif'],
  ['cost_7d', 'cout_claude_7j_usd'],
  ['cost_90d', 'cout_claude_90j_usd'],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'boolean'
      ? value ? 'oui' : 'non'
      : typeof value === 'number'
        ? String(value).replace('.', ',') // virgule décimale pour Excel en français
        : String(value);
  // Une cellule qui commence par = + - @ serait exécutée comme formule par le tableur.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportMembers(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_export_members');
  if (error) fail(error);
  const rows = (data ?? []) as AdminUser[];
  const csv =
    '﻿' +
    [COLUMNS.map(([, label]) => label).join(';'), ...rows.map((r) => COLUMNS.map(([key]) => csvCell(r[key])).join(';'))].join(
      '\r\n',
    );
  const name = `membres-michelia-${new Date().toISOString().slice(0, 10)}.csv`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    await Share.share({ title: name, message: csv });
  }
  return rows.length;
}

// Codes promo de MichelIA+ (migration 20261107010000_codes_promo.sql), onglet « Codes promo ».
export type CodePromo = {
  id: number;
  code: string;
  remise_pct: number;
  formule: 'mois' | 'an' | null;
  periodes: number | null;
  user_id: string | null;
  email: string | null;
  utilisations_max: number | null;
  utilisations: number;
  debut: string | null;
  fin: string | null;
  actif: boolean;
  note: string | null;
  created_at: string;
};

export type NouveauCode = {
  code: string;
  remise_pct: number;
  formule: 'mois' | 'an' | null;
  periodes: number | null;
  email: string | null;
  utilisations_max: number | null;
  fin: string | null;
  note: string | null;
};

export async function listCodesPromo(): Promise<CodePromo[]> {
  const { data, error } = await supabase.rpc('admin_codes_promo');
  if (error) fail(error);
  return (data ?? []) as CodePromo[];
}

export async function createCodePromo(c: NouveauCode): Promise<void> {
  const { error } = await supabase.rpc('admin_code_promo_creer', {
    p_code: c.code,
    p_remise_pct: c.remise_pct,
    p_formule: c.formule,
    p_periodes: c.periodes,
    p_email: c.email,
    p_utilisations_max: c.utilisations_max,
    p_fin: c.fin,
    p_note: c.note,
  });
  if (error?.code === '23505') throw new Error('Ce code existe déjà.');
  if (error?.code === 'P0002') throw new Error('Aucun compte avec cette adresse e-mail.');
  if (error?.code === '23514') throw new Error('Valeur refusée : code (3 à 30 lettres, chiffres, tirets), remise de 1 à 100 %.');
  if (error) fail(error);
}

// Modification : ne vaut que pour les prochaines utilisations (les abonnés gardent leur remise).
export async function updateCodePromo(id: number, c: NouveauCode): Promise<void> {
  const { error } = await supabase.rpc('admin_code_promo_modifier', {
    p_id: id,
    p_code: c.code,
    p_remise_pct: c.remise_pct,
    p_formule: c.formule,
    p_periodes: c.periodes,
    p_email: c.email,
    p_utilisations_max: c.utilisations_max,
    p_fin: c.fin,
    p_note: c.note,
  });
  if (error?.code === '23505') throw new Error('Ce code existe déjà.');
  if (error?.code === 'P0002') throw new Error(error.message.includes('Code') ? 'Code introuvable.' : 'Aucun compte avec cette adresse e-mail.');
  if (error?.code === '23514') throw new Error('Valeur refusée : code (3 à 30 lettres, chiffres, tirets), remise de 1 à 100 %.');
  if (error?.code === 'PGRST202') throw new Error("La modification n'est pas encore installée (SQL à coller).");
  if (error) fail(error);
}

export async function setCodePromoActif(id: number, actif: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_code_promo_actif', { p_id: id, p_actif: actif });
  if (error) fail(error);
}
