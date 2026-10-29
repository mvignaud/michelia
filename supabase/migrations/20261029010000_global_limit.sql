-- Anti-robots : plafond global de messages par jour, tous visiteurs confondus.
-- Même si des robots créent des milliers de comptes anonymes, la dépense du jour reste bornée.

create table if not exists public.usage_global (
  day date primary key,
  messages integer not null default 0
);

alter table public.usage_global enable row level security;

insert into public.app_config (key, value) values
  ('global_daily_limit', '5000')
on conflict (key) do nothing;

drop function if exists public.consume_message(uuid, integer);

-- Compte un message pour le visiteur et pour le total du jour.
-- Renvoie 'ok', 'user_limit' ou 'global_limit' ; rien n'est compté si une limite est atteinte.
create or replace function public.consume_message(p_user uuid, p_limit integer, p_global_limit integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
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

  insert into public.usage_daily as u (user_id, day, messages)
  values (p_user, today, 1)
  on conflict (user_id, day) do update
    set messages = u.messages + 1
    where u.messages < p_limit
  returning messages into counted;
  if counted is null then
    -- Le visiteur est au maximum : on rend le message compté au total du jour.
    update public.usage_global set messages = messages - 1 where day = today;
    return 'user_limit';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.consume_message(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_message(uuid, integer, integer) to service_role;
