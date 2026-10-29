-- Durées de conservation annoncées dans la politique de confidentialité :
-- compteurs supprimés après 90 jours, comptes anonymes supprimés après un an
-- s'ils n'ont posé aucune question depuis 90 jours.

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

revoke all on function public.purge_old_data() from public, anon, authenticated;
grant execute on function public.purge_old_data() to service_role;

-- Même fonction de quota qu'avant, qui lance la purge au premier message de chaque journée.
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
  if counted = 1 then
    perform public.purge_old_data();
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
