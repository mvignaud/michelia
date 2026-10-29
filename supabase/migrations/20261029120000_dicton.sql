-- Le dicton (ou le coup de gueule) du jour : une notification par jour, aux appareils
-- qui l'ont demandé. La fonction « dicton » l'écrit une seule fois par jour avec Claude,
-- puis le fait envoyer par la fonction « push » (audience « daily »).
-- À coller après la migration push (20261029090000). Rejouable sans risque.

-- 1. Choix fait sur l'appareil : le dicton du jour, oui ou non (non par défaut).
alter table public.push_subscriptions add column if not exists daily boolean not null default false;
create index if not exists push_subscriptions_daily on public.push_subscriptions (daily) where daily;

-- register_push gagne p_daily : null = ne rien changer (resynchronisation au démarrage).
drop function if exists public.register_push(text, text, jsonb);
create or replace function public.register_push(
  p_platform text,
  p_token text,
  p_keys jsonb default null,
  p_daily boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'connexion requise';
  end if;
  if p_platform in ('ios', 'android') then
    if p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$' then
      raise exception 'jeton invalide';
    end if;
    p_keys := null;
  elsif p_platform = 'web' then
    -- Seulement les services push des navigateurs : la fonction d'envoi n'appelle jamais une autre adresse.
    if p_token !~ '^https://([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)/'
      or char_length(p_token) > 1000
      or coalesce(p_keys ->> 'p256dh', '') !~ '^[A-Za-z0-9_-]{80,100}={0,2}$'
      or coalesce(p_keys ->> 'auth', '') !~ '^[A-Za-z0-9_-]{16,30}={0,2}$' then
      raise exception 'abonnement invalide';
    end if;
    p_keys := jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth');
  else
    raise exception 'plateforme inconnue';
  end if;

  insert into public.push_subscriptions as s (user_id, platform, token, keys, daily)
  values (uid, p_platform, p_token, p_keys, coalesce(p_daily, false))
  on conflict (token) do update
    set user_id = uid, platform = excluded.platform, keys = excluded.keys, last_seen_at = now(),
        daily = coalesce(p_daily, s.daily);

  -- Vingt appareils au plus par compte : les plus anciens sortent.
  delete from public.push_subscriptions
  where user_id = uid
    and id not in (
      select id from public.push_subscriptions where user_id = uid order by last_seen_at desc limit 20
    );
end;
$$;

revoke all on function public.register_push(text, text, jsonb, boolean) from public, anon;
grant execute on function public.register_push(text, text, jsonb, boolean) to authenticated;

-- 2. Audience « daily » pour la fonction push : les appareils qui ont dit oui, comptes anonymes compris.
create or replace function public.push_targets(p_audience text)
returns table (platform text, token text, keys jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_audience = 'service' then
    return query
      select s.platform, s.token, s.keys
      from public.push_subscriptions s
      join auth.users u on u.id = s.user_id
      where not u.is_anonymous;
  elsif p_audience = 'news' then
    return query
      select s.platform, s.token, s.keys
      from public.push_subscriptions s
      join auth.users u on u.id = s.user_id
      left join public.profiles p on p.id = s.user_id
      where u.is_anonymous or coalesce(p.news_opt_in, false);
  elsif p_audience = 'daily' then
    return query
      select s.platform, s.token, s.keys
      from public.push_subscriptions s
      where s.daily;
  else
    raise exception 'audience inconnue : %', p_audience;
  end if;
end;
$$;

revoke all on function public.push_targets(text) from public, anon, authenticated;
grant execute on function public.push_targets(text) to service_role;

-- 3. Un dicton par jour (heure de Paris), gardé pour ne pas se répéter.
create table if not exists public.daily_sayings (
  day date primary key,
  kind text check (kind in ('dicton', 'coup_de_gueule')),
  text text,
  status text not null default 'en_cours' check (status in ('en_cours', 'envoye', 'echec')),
  attempts int not null default 1,
  sent int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_sayings enable row level security;

-- Réserve le dicton du jour. Vrai si l'appel doit l'écrire et l'envoyer : la première fois,
-- ou après un échec (trois essais au plus, dix minutes d'écart), ou si un envoi est resté
-- bloqué plus de quinze minutes. Deux appels simultanés ne peuvent pas envoyer deux fois.
create or replace function public.claim_daily_saying(p_day date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_sayings as d (day) values (p_day)
  on conflict (day) do update
    set status = 'en_cours', attempts = d.attempts + 1, updated_at = now()
    where d.attempts < 3
      and ((d.status = 'echec' and d.updated_at < now() - interval '10 minutes')
        or (d.status = 'en_cours' and d.updated_at < now() - interval '15 minutes'));
  return found;
end;
$$;

revoke all on function public.claim_daily_saying(date) from public, anon, authenticated;
grant execute on function public.claim_daily_saying(date) to service_role;

-- 4. Réglages (modifiables sans redéployer) : interrupteur et heure d'envoi, heure de Paris.
insert into public.app_config (key, value) values
  ('dicton_enabled', 'true'),
  ('dicton_hour', '8')
on conflict (key) do nothing;

-- 5. Planification : pg_cron appelle la fonction chaque heure de 5 h à 9 h UTC ;
-- elle n'envoie qu'une fois par jour, à partir de dicton_hour (heure de Paris, été comme hiver).
-- Pas de clé à fournir : la fonction ne fait rien de plus si on l'appelle en dehors du cron.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'dicton-du-jour',
  '0 5-9 * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/dicton',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
