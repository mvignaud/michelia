-- MichelIA+ dans E-KO, suite de 20261102010000_michelia_plus_eko.sql. Rejouable sans risque.

-- 1. Compte supprimé : la suppression de l'utilisateur emporte son abonnement (cascade), mais E-KO, lui,
-- continuerait de prélever. Avant que la ligne disparaisse, son code E-KO est gardé ici ; le passage
-- horaire (synchroniserEko) coupe tout de suite l'abonnement chez E-KO et note l'heure.
create table if not exists public.eko_resiliations (
  eko_abonnement text primary key,
  demande_le timestamptz not null default now(),
  transmise_le timestamptz,
  essais integer not null default 0,
  erreur text
);
create index if not exists eko_resiliations_a_transmettre_idx on public.eko_resiliations (demande_le) where transmise_le is null;
alter table public.eko_resiliations enable row level security;
revoke all on public.eko_resiliations from anon, authenticated;

create or replace function public.garder_resiliation_eko()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.eko_abonnement is not null then
    insert into public.eko_resiliations (eko_abonnement) values (old.eko_abonnement)
    on conflict (eko_abonnement) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.garder_resiliation_eko() from public, anon, authenticated;

drop trigger if exists abonnements_garder_resiliation_eko on public.abonnements;
create trigger abonnements_garder_resiliation_eko
  before delete on public.abonnements
  for each row execute function public.garder_resiliation_eko();

-- 2. Heure du dernier rejet bancaire (payment_rejected) d'une période : un avis de paiement plus ancien,
-- livré après ce rejet, ne la remet pas payée.
alter table public.abonnement_echeances add column if not exists eko_rejete_le timestamptz;
