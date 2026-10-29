-- Cache des réponses aux questions d'ouverture.
-- Quand assez de réponses existent pour une question très proche, la fonction « chat »
-- en ressert une au hasard au lieu d'appeler Anthropic. Les questions ne sont liées à
-- aucun visiteur et sont effacées après 14 jours.

create extension if not exists vector with schema extensions;

create table if not exists public.response_cache (
  id bigint generated always as identity primary key,
  question text not null,
  embedding extensions.vector(384) not null,
  answer text not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.response_cache enable row level security;

create index if not exists response_cache_embedding_idx
  on public.response_cache using hnsw (embedding extensions.vector_cosine_ops);

insert into public.app_config (key, value) values
  ('cache_enabled', 'true'),
  ('cache_threshold', '0.94'),
  ('cache_variants', '3')
on conflict (key) do nothing;

-- Renvoie une réponse au hasard parmi celles des questions assez proches,
-- ou null tant qu'il y en a moins de p_min_variants (pour garder de la variété).
create or replace function public.pick_cached_answer(
  p_embedding extensions.vector(384),
  p_threshold double precision,
  p_min_variants integer
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  picked bigint;
  result text;
begin
  with close_answers as (
    select id
    from public.response_cache
    where created_at > now() - interval '14 days'
      and 1 - (embedding <=> p_embedding) >= p_threshold
    order by embedding <=> p_embedding
    limit 20
  )
  select id into picked
  from close_answers
  where (select count(*) from close_answers) >= p_min_variants
  order by random()
  limit 1;

  if picked is null then
    return null;
  end if;

  update public.response_cache set hits = hits + 1 where id = picked returning answer into result;
  return result;
end;
$$;

revoke all on function public.pick_cached_answer(extensions.vector, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.pick_cached_answer(extensions.vector, double precision, integer)
  to service_role;

-- La purge quotidienne efface aussi le cache de plus de 14 jours.
create or replace function public.purge_old_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
begin
  delete from public.usage_daily where day < today - 90;
  delete from public.usage_global where day < today - 90;
  delete from public.response_cache where created_at < now() - interval '14 days';

  begin
    delete from auth.users u
    where u.is_anonymous
      and u.created_at < now() - interval '1 year'
      and not exists (select 1 from public.usage_daily d where d.user_id = u.id);
  exception when others then
    -- Sans droit sur auth.users, on garde les comptes plutôt que de bloquer le chat.
    raise warning 'purge des comptes anonymes impossible : %', sqlerrm;
  end;
end;
$$;
