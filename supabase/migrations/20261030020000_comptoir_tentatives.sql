-- Formulaire de carte maison du comptoir (Stancer « full API ») : chaque carte envoyée compte un essai,
-- pour freiner les robots qui testent des cartes volées (5 par visiteur et 60 en tout par heure, voir
-- comptoir-paiement). Aucune donnée de carte ici : seulement qui a essayé, quand, et pour quel paiement.
-- Seules les fonctions (service_role) y accèdent. Rejouable sans risque.

create table if not exists public.comptoir_tentatives (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  paiement_id text,
  created_at timestamptz not null default now()
);
create index if not exists comptoir_tentatives_recent_idx on public.comptoir_tentatives (created_at desc);
create index if not exists comptoir_tentatives_user_idx on public.comptoir_tentatives (user_id, created_at desc);
alter table public.comptoir_tentatives enable row level security;
revoke all on public.comptoir_tentatives from anon, authenticated;
