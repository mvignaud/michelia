import { Platform } from 'react-native';
import { supabase } from './supabase';

// « Mes reçus » de l'espace compte : les reçus des pourboires du site, leurs avoirs de remboursement
// (et, à terme, les abonnements MichelIA+).
// Les achats faits dans les applis n'y sont pas : Apple et Google en envoient eux-mêmes le reçu.

export type MonRecu = {
  numero: string;
  date: string;
  genre: 'pourboire' | 'abonnement' | 'avoir';
  libelle: string;
  montant_cents: number;
  rembourse_cents: number;
  recu: string | null; // avoir : le reçu qu'il rembourse
};

export async function loadRecus(): Promise<MonRecu[]> {
  const { data, error } = await supabase.rpc('mes_recus');
  if (error) throw new Error('Impossible de retrouver tes reçus pour le moment.');
  return (data ?? []) as MonRecu[];
}

// Site : télécharge le PDF. Applis : le renvoie par e-mail (adresse du paiement), renvoyée pour l'affichage.
export async function obtenirRecu(numero: string): Promise<string | null> {
  const parEmail = Platform.OS !== 'web';
  const { data, error } = await supabase.functions.invoke('recu', { body: { numero, email: parEmail } });
  if (error) throw new Error(parEmail ? "L'e-mail n'est pas parti, réessaie plus tard." : 'Le reçu ne se télécharge pas, réessaie.');
  if (parEmail) return (data as { email?: string })?.email ?? null;
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${numero.startsWith('A') ? 'avoir' : 'recu'}-michel-${numero}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}
