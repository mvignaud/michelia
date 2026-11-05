-- MichelIA+ sur le site : changer de carte ou de compte (IBAN) depuis la page de la cotisation, sans
-- souscrire à nouveau. Rejouable sans risque.

-- Un code de signature peut servir à remplacer le mandat d'un abonnement déjà en cours.
alter table public.mandats_sepa_codes add column if not exists changement boolean not null default false;

-- Nouvelle carte : une autorisation de 0,50 € avec 3D Secure, jamais encaissée, qui enregistre la
-- carte chez Stancer. Une ligne par essai ; l'abonnement ne bascule qu'une fois la banque d'accord.
create table if not exists public.abonnement_changements (
  id bigint generated always as identity primary key,
  abonnement_id bigint not null references public.abonnements (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  paiement_id text not null unique check (paiement_id ~ '^paym_[A-Za-z0-9]{6,64}$'),
  statut text not null default 'en_cours' check (statut in ('en_cours', 'fait', 'refuse')),
  created_at timestamptz not null default now()
);
create index if not exists abonnement_changements_user_idx on public.abonnement_changements (user_id, created_at desc);
alter table public.abonnement_changements enable row level security;
revoke all on public.abonnement_changements from anon, authenticated;

-- Abonnement prélevé par E-KO : le nouveau moyen lui est transmis par le cron
-- (PUT /subscriptions/{code}/payment-method), puis la date est effacée.
alter table public.abonnements add column if not exists eko_moyen_change_le timestamptz;
