import { Platform } from 'react-native';
import { supabase } from './supabase';

// Le comptoir de Michel : pourboires payés sur le web dans notre formulaire (champs de carte Stripe
// Elements, ou Stancer selon app_config comptoir_prestataire),
// et dans les applis par achat intégré Apple / Google via RevenueCat (jamais Stripe dans les applis :
// règle Apple 3.1.1). Même note du mois et même carnet des copains partout.

export type Palier = { id: string; nom: string; prix_cents: number; merci: string };

export type Comptoir = {
  actif: boolean;
  // Prestataire du web. Stancer n'a pas de clé publique : seuls ses champs de carte (iframe) sont chez lui.
  prestataire?: 'stripe' | 'stancer';
  // Mode essai (clé de test Stancer) : la page /comptoir?essai=1 s'ouvre même comptoir fermé.
  essai?: boolean;
  // Clé publiable Stripe (pk_…), publique par nature ; le secret reste dans les Edge Functions.
  stripe_cle_publique: string;
  // Applis : ouverture propre et clés SDK RevenueCat (publiques par nature), une par boutique.
  appli?: { actif: boolean; cle_ios: string; cle_android: string };
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

// Applis : la clé RevenueCat de la boutique de cet appareil, si le comptoir des applis est ouvert.
export function cleAppli(data?: Comptoir): string | undefined {
  if (Platform.OS === 'web' || !data?.appli?.actif) return undefined;
  return (Platform.OS === 'ios' ? data.appli.cle_ios : data.appli.cle_android) || undefined;
}
