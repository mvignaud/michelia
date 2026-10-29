-- Photos envoyées à Michel : une photo coûte plus cher qu'un message (jetons d'image),
-- elle a donc son propre quota du jour en plus du quota de messages.
-- Sans compte : 3 photos par jour. Avec un compte : 20 par jour. Plafond global : 1 000 par jour.
-- Les photos ne sont jamais enregistrées : seuls les compteurs le sont.

alter table public.usage_daily add column if not exists photos integer not null default 0;
alter table public.usage_global add column if not exists photos integer not null default 0;

insert into public.app_config (key, value) values
  ('photos_enabled', 'true'),
  ('daily_photo_limit_guest', '3'),
  ('daily_photo_limit_member', '20'),
  ('global_daily_photo_limit', '1000')
on conflict (key) do nothing;

-- Compte une photo puis le message qui la porte.
-- Renvoie 'ok', 'global_photo_limit', 'photo_limit' ou les valeurs de consume_message ;
-- rien n'est compté si une limite est atteinte.
create or replace function public.consume_photo(
  p_user uuid,
  p_limit integer,
  p_global_limit integer,
  p_hour_limit integer,
  p_photo_limit integer,
  p_global_photo_limit integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  counted integer;
  result text;
begin
  if p_global_photo_limit <= 0 then
    return 'global_photo_limit';
  end if;
  if p_photo_limit <= 0 then
    return 'photo_limit';
  end if;

  insert into public.usage_global as g (day, messages, photos)
  values (today, 0, 1)
  on conflict (day) do update
    set photos = g.photos + 1
    where g.photos < p_global_photo_limit
  returning photos into counted;
  if counted is null then
    return 'global_photo_limit';
  end if;

  insert into public.usage_daily as u (user_id, day, messages, photos)
  values (p_user, today, 0, 1)
  on conflict (user_id, day) do update
    set photos = u.photos + 1
    where u.photos < p_photo_limit
  returning photos into counted;
  if counted is null then
    update public.usage_global set photos = photos - 1 where day = today;
    return 'photo_limit';
  end if;

  result := public.consume_message(p_user, p_limit, p_global_limit, p_hour_limit);
  if result <> 'ok' then
    update public.usage_global set photos = photos - 1 where day = today;
    update public.usage_daily set photos = photos - 1 where user_id = p_user and day = today;
    -- Ligne créée juste pour cette photo : on l'efface pour ne pas fausser les visiteurs du jour.
    delete from public.usage_daily
    where user_id = p_user and day = today and messages = 0 and photos = 0;
  end if;
  return result;
end;
$$;

revoke all on function public.consume_photo(uuid, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_photo(uuid, integer, integer, integer, integer, integer)
  to service_role;
