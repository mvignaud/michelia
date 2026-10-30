-- MichelIA+ par prélèvement : le mandat SEPA se signe maintenant chez Michel (formulaire IBAN et code
-- SMS envoyé par Michel), plus sur la page Stancer. Rejouable sans risque.

-- Codes de signature en attente : une ligne par code envoyé. Jamais l'IBAN ni le code en clair,
-- seulement leurs empreintes (avec un sel par ligne) ; 10 minutes de validité, 5 essais au plus.
create table if not exists public.mandats_sepa_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  abonnement_id bigint not null references public.abonnements (id) on delete cascade,
  sel text not null,
  code_empreinte text not null,
  iban_empreinte text not null,
  titulaire text not null check (char_length(titulaire) <= 64),
  telephone_masque text not null check (char_length(telephone_masque) <= 32),
  essais integer not null default 0,
  expire_le timestamptz not null,
  utilise_le timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mandats_sepa_codes_user_idx on public.mandats_sepa_codes (user_id, created_at desc);
alter table public.mandats_sepa_codes enable row level security;
revoke all on public.mandats_sepa_codes from anon, authenticated;

-- Preuve de la signature (date, IP, navigateur, téléphone masqué, empreinte du PDF), gardée avec le mandat.
alter table public.mandats_sepa add column if not exists preuve jsonb;

-- Les mandats signés (PDF) : stockage privé, lu seulement par les fonctions (service_role).
insert into storage.buckets (id, name, public)
values ('mandats', 'mandats', false)
on conflict (id) do nothing;
