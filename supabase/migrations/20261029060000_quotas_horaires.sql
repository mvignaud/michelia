-- Quotas à l'heure en plus des quotas du jour, pour éviter les rafales.
-- Sans compte : 5 par heure, 20 par jour. Avec un compte : 30 par heure, 200 par jour.

create table if not exists public.usage_hourly (
  user_id uuid not null references auth.users (id) on delete cascade,
  hour timestamptz not null,
  messages integer not null default 0,
  primary key (user_id, hour)
);

alter table public.usage_hourly enable row level security;

insert into public.app_config (key, value) values
  ('hourly_limit_guest', '5'),
  ('hourly_limit_member', '30')
on conflict (key) do nothing;

update public.app_config set value = '20', updated_at = now()
where key = 'daily_limit_guest' and value = '10';
update public.app_config set value = '200', updated_at = now()
where key = 'daily_limit_member' and value = '100';

-- Compte un message pour le total du jour, l'heure et la journée du visiteur.
-- Renvoie 'ok', 'global_limit', 'hour_limit' ou 'user_limit' ; rien n'est compté si une limite est atteinte.
create or replace function public.consume_message(
  p_user uuid,
  p_limit integer,
  p_global_limit integer,
  p_hour_limit integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  this_hour timestamptz := date_trunc('hour', now());
  counted integer;
begin
  insert into public.usage_global as g (day, messages)
  values (today, 1)
  on conflict (day) do update
    set messages = g.messages + 1
    where g.messages < p_global_limit
  returning messages into counted;
  if counted is null then
    return 'global_limit';
  end if;
  if counted = 1 then
    perform public.purge_old_data();
  end if;

  insert into public.usage_hourly as h (user_id, hour, messages)
  values (p_user, this_hour, 1)
  on conflict (user_id, hour) do update
    set messages = h.messages + 1
    where h.messages < p_hour_limit
  returning messages into counted;
  if counted is null then
    update public.usage_global set messages = messages - 1 where day = today;
    return 'hour_limit';
  end if;

  insert into public.usage_daily as u (user_id, day, messages)
  values (p_user, today, 1)
  on conflict (user_id, day) do update
    set messages = u.messages + 1
    where u.messages < p_limit
  returning messages into counted;
  if counted is null then
    update public.usage_global set messages = messages - 1 where day = today;
    update public.usage_hourly set messages = messages - 1 where user_id = p_user and hour = this_hour;
    return 'user_limit';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.consume_message(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_message(uuid, integer, integer, integer) to service_role;

-- L'ancienne version à trois paramètres reste valable tant que la fonction « chat » n'est pas redéployée.
create or replace function public.consume_message(p_user uuid, p_limit integer, p_global_limit integer)
returns text
language sql
security definer
set search_path = public
as $$
  select public.consume_message(p_user, p_limit, p_global_limit, 2147483647);
$$;

revoke all on function public.consume_message(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_message(uuid, integer, integer) to service_role;

-- La purge quotidienne efface aussi les compteurs horaires de plus de deux jours.
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
  delete from public.usage_hourly where hour < now() - interval '2 days';
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
