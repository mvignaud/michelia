-- Back-office : statistiques, membres et leurs usages, export des comptes, annonces.
-- Réservé aux comptes inscrits dans public.admins (ajoutés à la main, voir docs/MISE-EN-LIGNE.md).
-- Les fonctions admin_* vérifient elles-mêmes le droit : sans lui, elles refusent.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_admin() from public, anon, authenticated;

-- Journal des actions sensibles (exports de comptes, annonces envoyées).
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

-- Nouvelles de Michel : seulement pour les membres qui l'ont accepté (consentement, RGPD).
-- La date du consentement est posée par la base, pas par l'appli.
alter table public.profiles add column if not exists news_opt_in boolean not null default false;
alter table public.profiles add column if not exists news_opt_in_at timestamptz;

grant update (news_opt_in) on public.profiles to authenticated;

create or replace function public.stamp_news_opt_in()
returns trigger
language plpgsql
as $$
begin
  if new.news_opt_in is distinct from old.news_opt_in then
    new.news_opt_in_at := case when new.news_opt_in then now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_news_opt_in on public.profiles;
create trigger stamp_news_opt_in
  before update on public.profiles
  for each row execute function public.stamp_news_opt_in();

-- Le formulaire d'inscription peut cocher les nouvelles dès la création du compte.
create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  year_text text := meta ->> 'birth_year';
  news boolean := coalesce(meta ->> 'news_opt_in', '') = 'true';
begin
  if new.is_anonymous then
    return new;
  end if;
  insert into public.profiles (id, first_name, last_name, birth_year, news_opt_in, news_opt_in_at)
  values (
    new.id,
    left(nullif(trim(coalesce(meta ->> 'first_name', meta ->> 'given_name', split_part(meta ->> 'full_name', ' ', 1))), ''), 50),
    left(nullif(trim(coalesce(meta ->> 'last_name', meta ->> 'family_name')), ''), 50),
    case when year_text ~ '^\d{4}$' and year_text::int between 1900 and 2100 then year_text::int end,
    news,
    case when news then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Annonces envoyées depuis le back-office.
-- audience : 'news' (membres ayant accepté les nouvelles) ou 'service' (tous les membres,
-- pour une information sur le service lui-même : conditions, panne, fermeture…).
-- Point d'accroche des notifications : quand 'push' est dans channels, la ligne arrive avec
-- push_status = 'en_attente' ; l'envoi des notifications la traite et met à jour push_status.
create table if not exists public.broadcasts (
  id bigint generated always as identity primary key,
  subject text not null check (char_length(subject) between 1 and 150),
  body text not null check (char_length(body) between 1 and 10000),
  audience text not null check (audience in ('news', 'service')),
  channels text[] not null check (channels <@ array['email', 'push'] and cardinality(channels) > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  email_status text,
  email_total integer not null default 0,
  email_sent integer not null default 0,
  email_failed integer not null default 0,
  push_status text,
  push_sent integer not null default 0,
  finished_at timestamptz
);

alter table public.broadcasts enable row level security;

drop policy if exists "Admins lisent les annonces" on public.broadcasts;
create policy "Admins lisent les annonces" on public.broadcasts
  for select to authenticated using ((select public.is_admin()));

grant select on public.broadcasts to authenticated;

-- Destinataires d'une annonce par e-mail : membres avec une adresse confirmée.
-- Appelée seulement par la fonction « annonces » (clé service_role).
create or replace function public.broadcast_recipients(p_audience text)
returns table (user_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.first_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where not u.is_anonymous
    and u.email is not null
    and u.email_confirmed_at is not null
    and (p_audience = 'service' or p.news_opt_in);
$$;

revoke all on function public.broadcast_recipients(text) from public, anon, authenticated;
grant execute on function public.broadcast_recipients(text) to service_role;

-- Tableau de bord : chiffres clés et courbes des 30 derniers jours (heure de Paris).
-- Les compteurs de questions ne remontent pas au-delà de 90 jours (purge automatique).
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  this_year integer := extract(year from now())::integer;
  push_devices bigint;
begin
  perform public.assert_admin();
  -- Appareils abonnés aux notifications, une fois la table des notifications créée.
  if to_regclass('public.push_subscriptions') is not null then
    execute 'select count(*) from public.push_subscriptions' into push_devices;
  end if;
  return jsonb_build_object(
    'push_devices', push_devices,
    'members', (select count(*) from auth.users where not is_anonymous),
    'guests', (select count(*) from auth.users where is_anonymous),
    'members_7d', (select count(*) from auth.users where not is_anonymous and created_at > now() - interval '7 days'),
    'members_30d', (select count(*) from auth.users where not is_anonymous and created_at > now() - interval '30 days'),
    'news_opt_in', (select count(*) from public.profiles where news_opt_in),
    'audience_news', (select count(*) from public.broadcast_recipients('news')),
    'audience_service', (select count(*) from public.broadcast_recipients('service')),
    'messages_today', coalesce((select messages from public.usage_global where day = today), 0),
    'messages_7d', (select coalesce(sum(messages), 0) from public.usage_global where day > today - 7),
    'messages_30d', (select coalesce(sum(messages), 0) from public.usage_global where day > today - 30),
    'active_today', (select count(*) from public.usage_daily where day = today),
    'active_7d', (select count(distinct user_id) from public.usage_daily where day > today - 7),
    'active_members_7d', (
      select count(distinct d.user_id)
      from public.usage_daily d join auth.users u on u.id = d.user_id
      where not u.is_anonymous and d.day > today - 7
    ),
    'cache_answers', (select count(*) from public.response_cache),
    'cache_hits', (select coalesce(sum(hits), 0) from public.response_cache),
    'days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'messages', coalesce((select g.messages from public.usage_global g where g.day = d.day), 0),
        'active', (select count(*) from public.usage_daily u where u.day = d.day),
        'signups', (
          select count(*) from auth.users u
          where not u.is_anonymous and (u.created_at at time zone 'Europe/Paris')::date = d.day
        )
      ) order by d.day)
      from (select s::date as day from generate_series(today - 29, today, interval '1 day') s) d
    ),
    'providers', (
      select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
      from (
        select x.provider, count(*) as n
        from auth.users u
        cross join lateral jsonb_array_elements_text(
          coalesce(u.raw_app_meta_data -> 'providers', jsonb_build_array(u.raw_app_meta_data ->> 'provider'))
        ) as x(provider)
        where not u.is_anonymous and x.provider is not null
        group by x.provider
      ) t
    ),
    'ages', (
      select coalesce(jsonb_object_agg(bracket, n), '{}'::jsonb)
      from (
        select case
            when birth_year is null then 'inconnu'
            when this_year - birth_year < 25 then '18-24'
            when this_year - birth_year < 35 then '25-34'
            when this_year - birth_year < 50 then '35-49'
            when this_year - birth_year < 65 then '50-64'
            else '65+'
          end as bracket,
          count(*) as n
        from public.profiles
        group by 1
      ) t
    )
  );
end;
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- Liste des comptes avec leur usage. p_order : 'recent' (inscription), 'usage' (questions sur 90 jours)
-- ou 'active' (dernier jour d'activité). p_members_only = false ajoute les visiteurs anonymes,
-- utile pour repérer un robot.
create or replace function public.admin_users(
  p_search text default null,
  p_members_only boolean default true,
  p_order text default 'recent',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  phone text,
  first_name text,
  last_name text,
  birth_year integer,
  providers text,
  is_anonymous boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  news_opt_in boolean,
  messages_today integer,
  messages_7d integer,
  messages_90d integer,
  last_active date,
  conversation_messages integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  pattern text := '%' || replace(replace(replace(coalesce(trim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform public.assert_admin();
  return query
  with usage as (
    select d.user_id,
      coalesce(sum(d.messages) filter (where d.day = today), 0)::integer as m_today,
      coalesce(sum(d.messages) filter (where d.day > today - 7), 0)::integer as m_7d,
      sum(d.messages)::integer as m_90d,
      max(d.day) as last_day
    from public.usage_daily d
    group by d.user_id
  ),
  listed as (
    select u.id as uid,
      u.email::text as u_email,
      u.phone::text as u_phone,
      p.first_name as p_first,
      p.last_name as p_last,
      p.birth_year as p_year,
      coalesce(
        (select string_agg(x, ', ') from jsonb_array_elements_text(u.raw_app_meta_data -> 'providers') x),
        u.raw_app_meta_data ->> 'provider'
      ) as u_providers,
      u.is_anonymous as anon,
      u.created_at as u_created,
      u.last_sign_in_at as u_last_sign_in,
      coalesce(p.news_opt_in, false) as news,
      coalesce(us.m_today, 0) as m_today,
      coalesce(us.m_7d, 0) as m_7d,
      coalesce(us.m_90d, 0) as m_90d,
      us.last_day,
      coalesce(jsonb_array_length(c.messages), 0) as conv
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join usage us on us.user_id = u.id
    left join public.conversations c on c.user_id = u.id
    where (not p_members_only or not u.is_anonymous)
      and (
        pattern = '%%'
        or u.email ilike pattern
        or u.phone ilike pattern
        or p.first_name ilike pattern
        or p.last_name ilike pattern
        or u.id::text = trim(p_search)
      )
  )
  select l.uid, l.u_email, l.u_phone, l.p_first, l.p_last, l.p_year, l.u_providers, l.anon,
    l.u_created, l.u_last_sign_in, l.news, l.m_today, l.m_7d, l.m_90d, l.last_day, l.conv,
    count(*) over ()
  from listed l
  order by
    case when p_order = 'usage' then l.m_90d end desc nulls last,
    case when p_order = 'active' then l.last_day end desc nulls last,
    l.u_created desc
  limit least(greatest(p_limit, 1), 100000)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.admin_users(text, boolean, text, integer, integer) from public, anon;
grant execute on function public.admin_users(text, boolean, text, integer, integer) to authenticated;

-- Questions par jour d'un compte, sur les 90 jours conservés.
create or replace function public.admin_user_usage(p_user uuid)
returns table (day date, messages integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select d.day, d.messages from public.usage_daily d where d.user_id = p_user order by d.day;
end;
$$;

revoke all on function public.admin_user_usage(uuid) from public, anon;
grant execute on function public.admin_user_usage(uuid) to authenticated;

-- Export de tous les membres (sans les anonymes). Chaque export est journalisé.
create or replace function public.admin_export_members()
returns table (
  id uuid,
  email text,
  phone text,
  first_name text,
  last_name text,
  birth_year integer,
  providers text,
  is_anonymous boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  news_opt_in boolean,
  messages_today integer,
  messages_7d integer,
  messages_90d integer,
  last_active date,
  conversation_messages integer,
  total_count bigint
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  insert into public.admin_audit (admin_id, action, detail)
  values ((select auth.uid()), 'export_members', jsonb_build_object('rows', (select count(*) from auth.users u where not u.is_anonymous)));
  return query select * from public.admin_users(null, true, 'recent', 100000, 0);
end;
$$;

revoke all on function public.admin_export_members() from public, anon;
grant execute on function public.admin_export_members() to authenticated;
