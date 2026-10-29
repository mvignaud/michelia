import { supabase } from './supabase';

// Le comptoir de Michel : pourboires, payés dans la page par Stripe Embedded Checkout, sur le WEB UNIQUEMENT (règle Apple 3.1.1). Ce fichier n'est
// importé que par les fichiers .web.tsx, jamais par les applis iOS et Android.

export type Palier = { id: string; nom: string; prix_cents: number; merci: string };

export type Comptoir = {
  actif: boolean;
  // Clé publiable Stripe (pk_…), publique par nature ; le secret reste dans les Edge Functions.
  stripe_cle_publique: string;
  paliers: Palier[];
  note_du_mois: { cout_eur: number; recu_eur: number; pourcent: number };
  carnet: string[];
};

let loading: Promise<Comptoir> | null = null;

// Une seule lecture par visite de la page ; en cas d'échec on pourra réessayer.
export function loadComptoir(): Promise<Comptoir> {
  loading ??= Promise.resolve(supabase.rpc('comptoir_public')).then(({ data, error }) => {
    if (error || !data) {
      loading = null;
      throw new Error(error?.message || 'Le comptoir est fermé pour le moment.');
    }
    return data as Comptoir;
  });
  return loading;
}

// Relecture après un paiement : la note du mois et le carnet ont bougé.
export function reloadComptoir(): Promise<Comptoir> {
  loading = null;
  return loadComptoir();
}

export const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
