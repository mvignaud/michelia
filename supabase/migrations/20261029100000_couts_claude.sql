-- Coût Claude indicatif : jetons consommés par jour, par compte et au total.
-- La fonction « chat » enregistre les jetons de chaque réponse (record_tokens).
-- Le coût est calculé avec les prix de app_config (dollars par million de jetons),
-- à ajuster si le modèle ou les tarifs changent. C'est une estimation, la facture
-- qui fait foi reste celle de la console Claude.
-- Rejouable sans risque.

alter table public.usage_daily
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists cache_read_tokens bigint not null default 0,
  add column if not exists cache_write_tokens bigint not null default 0;

alter table public.usage_global
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists cache_read_tokens bigint not null default 0,
  add column if not exists cache_write_tokens bigint not null default 0;

-- Tarifs Claude Haiku 5.5, en dollars par million de jetons.
insert into public.app_config (key, value) values
  ('price_input_mtok', '0.10'),
  ('price_output_mtok', '0.50'),
  ('price_cache_read_mtok', '0.01'),
  ('price_cache_write_mtok', '0.125')
on conflict (key) do nothing;

-- Ajoute les jetons d'une réponse au compte du jour et au total du jour.
create or replace function public.record_tokens(
  p_user uuid,
  p_input bigint,
  p_output bigint,
  p_cache_read bigint,
  p_cache_write bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  i bigint := greatest(coalesce(p_input, 0), 0);
  o bigint := greatest(coalesce(p_output, 0), 0);
  r bigint := greatest(coalesce(p_cache_read, 0), 0);
  w bigint := greatest(coalesce(p_cache_write, 0), 0);
begin
  insert into public.usage_daily as u (user_id, day, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
  values (p_user, today, i, o, r, w)
  on conflict (user_id, day) do update set
    input_tokens = u.input_tokens + i,
    output_tokens = u.output_tokens + o,
    cache_read_tokens = u.cache_read_tokens + r,
    cache_write_tokens = u.cache_write_tokens + w;
  insert into public.usage_global as g (day, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
  values (today, i, o, r, w)
  on conflict (day) do update set
    input_tokens = g.input_tokens + i,
    output_tokens = g.output_tokens + o,
    cache_read_tokens = g.cache_read_tokens + r,
    cache_write_tokens = g.cache_write_tokens + w;
end;
$$;

revoke all on function public.record_tokens(uuid, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_tokens(uuid, bigint, bigint, bigint, bigint) to service_role;

-- Coût en dollars d'un lot de jetons, aux prix de app_config.
create or replace function public.token_cost(p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(p_input, 0) * coalesce((select value::numeric from public.app_config where key = 'price_input_mtok'), 0)
    + coalesce(p_output, 0) * coalesce((select value::numeric from public.app_config where key = 'price_output_mtok'), 0)
    + coalesce(p_cache_read, 0) * coalesce((select value::numeric from public.app_config where key = 'price_cache_read_mtok'), 0)
    + coalesce(p_cache_write, 0) * coalesce((select value::numeric from public.app_config where key = 'price_cache_write_mtok'), 0)
  ) / 1000000;
$$;

revoke all on function public.token_cost(bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.token_cost(bigint, bigint, bigint, bigint) to authenticated, service_role;

-- Coûts du tableau de bord : aujourd'hui, 7 et 30 jours, et par jour sur 30 jours.
create or replace function public.admin_costs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'cost_today', (
      select coalesce(sum(public.token_cost(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)), 0)
      from public.usage_global where day = today
    ),
    'cost_7d', (
      select coalesce(sum(public.token_cost(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)), 0)
      from public.usage_global where day > today - 7
    ),
    'cost_30d', (
      select coalesce(sum(public.token_cost(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)), 0)
      from public.usage_global where day > today - 30
    ),
    -- Premier jour où des jetons ont été comptés : avant, le coût n'était pas mesuré.
    'since', (select min(day) from public.usage_global where input_tokens + output_tokens > 0),
    'days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'cost', coalesce((
          select public.token_cost(g.input_tokens, g.output_tokens, g.cache_read_tokens, g.cache_write_tokens)
          from public.usage_global g where g.day = d.day
        ), 0)
      ) order by d.day)
      from (select s::date as day from generate_series(today - 29, today, interval '1 day') s) d
    )
  );
end;
$$;

revoke all on function public.admin_costs() from public, anon;
grant execute on function public.admin_costs() to authenticated;

-- Les colonnes renvoyées changent : on recrée la liste des comptes et l'export, qui en dépend.
drop function if exists public.admin_export_members();
drop function if exists public.admin_users(text, boolean, text, integer, integer);
drop function if exists public.admin_user_usage(uuid);

-- Liste des comptes avec leur usage. p_order : 'recent' (inscription), 'usage' (questions sur 90 jours),
-- 'active' (dernier jour d'activité) ou 'cost' (coût Claude sur 90 jours).
-- p_members_only = false ajoute les visiteurs anonymes, utile pour repérer un robot.
create function public.admin_users(
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
  cost_7d numeric,
  cost_90d numeric,
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
      max(d.day) filter (where d.messages > 0) as last_day,
      round(coalesce(sum(public.token_cost(d.input_tokens, d.output_tokens, d.cache_read_tokens, d.cache_write_tokens))
        filter (where d.day > today - 7), 0), 6) as c_7d,
      round(sum(public.token_cost(d.input_tokens, d.output_tokens, d.cache_read_tokens, d.cache_write_tokens)), 6) as c_90d
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
      coalesce(jsonb_array_length(c.messages), 0) as conv,
      coalesce(us.c_7d, 0) as c_7d,
      coalesce(us.c_90d, 0) as c_90d
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
    l.c_7d, l.c_90d,
    count(*) over ()
  from listed l
  order by
    case when p_order = 'usage' then l.m_90d end desc nulls last,
    case when p_order = 'active' then l.last_day end desc nulls last,
    case when p_order = 'cost' then l.c_90d end desc nulls last,
    l.u_created desc
  limit least(greatest(p_limit, 1), 100000)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.admin_users(text, boolean, text, integer, integer) from public, anon;
grant execute on function public.admin_users(text, boolean, text, integer, integer) to authenticated;

-- Questions et coût Claude par jour d'un compte, sur les 90 jours conservés.
create function public.admin_user_usage(p_user uuid)
returns table (day date, messages integer, cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select d.day, d.messages,
    round(public.token_cost(d.input_tokens, d.output_tokens, d.cache_read_tokens, d.cache_write_tokens), 6)
  from public.usage_daily d where d.user_id = p_user order by d.day;
end;
$$;

revoke all on function public.admin_user_usage(uuid) from public, anon;
grant execute on function public.admin_user_usage(uuid) to authenticated;

-- Export de tous les membres (sans les anonymes). Chaque export est journalisé.
create function public.admin_export_members()
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
  cost_7d numeric,
  cost_90d numeric,
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
