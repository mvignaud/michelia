-- MichelIA : configuration et quotas.
-- Aucune table n'est lisible depuis l'appli : seule la fonction « chat »
-- (clé service_role côté serveur) y accède.

create table public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Le prompt de Michel n'est pas versionné (dépôt public) :
-- l'ajouter à la main, voir docs/MISE-EN-LIGNE.md.
insert into public.app_config (key, value) values
  ('model', 'claude-haiku-5-5'),
  ('daily_limit', '30'),
  ('max_output_tokens', '1024');

create table public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'Europe/Paris')::date,
  messages integer not null default 0,
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

-- Compte un message et renvoie le nouveau total, ou null si le quota du jour est atteint.
-- Atomique : deux requêtes simultanées ne peuvent pas dépasser la limite.
create function public.consume_message(p_user uuid, p_limit integer)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.usage_daily as u (user_id, day, messages)
  values (p_user, (now() at time zone 'Europe/Paris')::date, 1)
  on conflict (user_id, day) do update
    set messages = u.messages + 1
    where u.messages < p_limit
  returning messages;
$$;

revoke all on function public.consume_message(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_message(uuid, integer) to service_role;
