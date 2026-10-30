-- MichelIA+ : l'abonnement facultatif (3,99 € par mois ou 39 € par an). Michel gratuit reste gratuit.
-- Un seul droit par compte, quelle que soit la façon de payer : sur le site (Stancer, carte ou
-- prélèvement SEPA, Michel relance lui-même chaque échéance) ou dans les applis (abonnement
-- auto-renouvelable Apple ou Google, suivi par RevenueCat). L'appli et le site lisent michelia_plus().
-- Les numéros de carte et les IBAN ne sont jamais ici : seulement les jetons Stancer (card_…, sepa_…)
-- et les 4 derniers chiffres. Écrit seulement par les fonctions (service_role).
-- Rejouable sans risque.

create table if not exists public.abonnements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('web', 'apple', 'google')),
  formule text not null check (formule in ('mois', 'an')),
  -- Sur le site seulement : carte ou prélèvement SEPA.
  moyen text check (moyen in ('carte', 'sepa')),
  -- en_attente : premier paiement pas encore passé ; actif ; impaye : échéance ratée, Michel réessaie ;
  -- resilie : résiliation demandée, le droit court jusqu'à fin_periode ; expire : terminé.
  statut text not null default 'en_attente' check (statut in ('en_attente', 'actif', 'impaye', 'resilie', 'expire')),
  prix_cents integer not null check (prix_cents > 0),
  fin_periode timestamptz,
  resilie_le timestamptz,
  email text check (email is null or char_length(email) <= 254),
  -- Site (Stancer) : client, carte enregistrée ou mandat SEPA, jamais le numéro complet.
  stancer_client text check (stancer_client is null or stancer_client ~ '^cust_[A-Za-z0-9]{6,64}$'),
  stancer_carte text check (stancer_carte is null or stancer_carte ~ '^card_[A-Za-z0-9]{6,64}$'),
  stancer_sepa text check (stancer_sepa is null or stancer_sepa ~ '^sepa_[A-Za-z0-9]{6,64}$'),
  derniers_chiffres text check (derniers_chiffres is null or derniers_chiffres ~ '^[0-9A-Z]{4}$'),
  -- Échéances ratées d'affilée et prochain essai (site) ; un abonnement remis d'aplomb repart à zéro.
  echecs integer not null default 0,
  prochain_essai timestamptz,
  -- Applis : produit et transaction d'origine de la boutique (identifie l'abonnement chez Apple/Google).
  store_produit text,
  store_transaction text unique,
  essai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un seul abonnement vivant par compte.
create unique index if not exists abonnements_vivant_idx on public.abonnements (user_id)
  where statut in ('actif', 'impaye', 'resilie');
create index if not exists abonnements_echeance_idx on public.abonnements (fin_periode)
  where source = 'web' and statut in ('actif', 'impaye');

alter table public.abonnements enable row level security;
revoke all on public.abonnements from anon, authenticated;

-- Chaque échéance payée (ou tentée) : de quoi faire le reçu, la facture E-KO et suivre les remboursements.
create table if not exists public.abonnement_echeances (
  id bigint generated always as identity primary key,
  abonnement_id bigint not null references public.abonnements (id) on delete cascade,
  -- paym_… (Stancer) ou <boutique>:<transaction> (applis).
  paiement_id text not null unique,
  montant_cents integer not null check (montant_cents > 0),
  periode_debut timestamptz not null,
  periode_fin timestamptz not null,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'paye', 'refuse')),
  numero_recu text,
  rembourse_cents integer not null default 0,
  essai boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists abonnement_echeances_abonnement_idx on public.abonnement_echeances (abonnement_id, created_at desc);

alter table public.abonnement_echeances enable row level security;
revoke all on public.abonnement_echeances from anon, authenticated;

-- Mandats SEPA signés chez Stancer (code SMS), gardés aussi chez Michel et copiés dans E-KO.
-- Un nouvel IBAN = un nouveau mandat ; l'ancien est révoqué, jamais effacé.
create table if not exists public.mandats_sepa (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  abonnement_id bigint references public.abonnements (id) on delete set null,
  stancer_sepa text not null unique check (stancer_sepa ~ '^sepa_[A-Za-z0-9]{6,64}$'),
  -- Référence unique du mandat (RUM), telle que Stancer l'a créée.
  rum text check (rum is null or char_length(rum) <= 35),
  titulaire text check (titulaire is null or char_length(titulaire) <= 64),
  iban_derniers text check (iban_derniers is null or iban_derniers ~ '^[0-9A-Z]{4}$'),
  signe_le timestamptz,
  revoque_le timestamptz,
  -- Copie du mandat signé (stockage privé) et référence E-KO, quand elles sont faites.
  pdf_chemin text,
  eko_ref text,
  created_at timestamptz not null default now()
);
create index if not exists mandats_sepa_user_idx on public.mandats_sepa (user_id, created_at desc);

alter table public.mandats_sepa enable row level security;
revoke all on public.mandats_sepa from anon, authenticated;

insert into public.app_config (key, value) values
  -- 'true' : l'abonnement s'ouvre sur le site et dans les applis.
  ('michelia_plus_actif', 'false'),
  -- Prix TTC en centimes, toujours lus ici par le serveur, jamais envoyés par le navigateur.
  ('michelia_plus_prix', '{"mois": 399, "an": 3900}')
on conflict (key) do nothing;

-- Le compte a-t-il MichelIA+ en ce moment ? Résilié : oui jusqu'à la fin de la période payée.
-- Impayé : encore oui pendant que Michel réessaie (la date de fin n'avance pas).
create or replace function public.michelia_plus(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.abonnements
    where user_id = p_user
      and statut in ('actif', 'impaye', 'resilie')
      and not essai
      and fin_periode > now()
  );
$$;

revoke all on function public.michelia_plus(uuid) from public, anon, authenticated;

-- Pour l'espace compte et l'appli : l'abonnement de la personne connectée, sans rien de sensible
-- (ni jeton Stancer, ni e-mail). null si elle n'en a pas.
create or replace function public.mon_abonnement()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'actif', public.michelia_plus(a.user_id),
    'source', a.source,
    'formule', a.formule,
    'moyen', a.moyen,
    'statut', a.statut,
    'prix_cents', a.prix_cents,
    'fin_periode', a.fin_periode,
    'derniers_chiffres', a.derniers_chiffres
  )
  from public.abonnements a
  where a.user_id = auth.uid()
    and a.statut in ('actif', 'impaye', 'resilie')
  order by a.created_at desc
  limit 1;
$$;

revoke all on function public.mon_abonnement() from public, anon;
grant execute on function public.mon_abonnement() to authenticated;

-- Prix et ouverture, pour la page d'abonnement (rien de secret).
create or replace function public.michelia_plus_public()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mois integer;
  an integer;
begin
  -- Un JSON mal rempli ne casse pas la page : elle n'affiche simplement pas de prix.
  begin
    select (p ->> 'mois')::integer, (p ->> 'an')::integer into mois, an
    from (select value::jsonb p from public.app_config where key = 'michelia_plus_prix') c;
  exception when others then
    mois := null;
    an := null;
  end;
  return jsonb_build_object(
    'actif', coalesce((select value from public.app_config where key = 'michelia_plus_actif'), 'false') = 'true',
    'mois_cents', mois,
    'an_cents', an
  );
end;
$$;

revoke all on function public.michelia_plus_public() from public;
grant execute on function public.michelia_plus_public() to anon, authenticated;
