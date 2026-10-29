-- Notifications push : un abonnement par appareil. Applis iOS et Android : jeton Expo
-- (Expo relaie vers Apple et Google). Site web : abonnement Web Push du navigateur.
-- Aucune lecture directe depuis l'appli : tout passe par les fonctions ci-dessous.

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  -- Jeton Expo, ou adresse du service push du navigateur.
  token text not null unique check (char_length(token) <= 1000),
  -- Web seulement : clés p256dh et auth pour chiffrer le message.
  keys jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Enregistre l'appareil du visiteur connecté (compte anonyme compris). Un même appareil
-- qui change de compte passe au nouveau compte.
create or replace function public.register_push(p_platform text, p_token text, p_keys jsonb default null)
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

  insert into public.push_subscriptions as s (user_id, platform, token, keys)
  values (uid, p_platform, p_token, p_keys)
  on conflict (token) do update
    set user_id = uid, platform = excluded.platform, keys = excluded.keys, last_seen_at = now();

  -- Vingt appareils au plus par compte : les plus anciens sortent.
  delete from public.push_subscriptions
  where user_id = uid
    and id not in (
      select id from public.push_subscriptions where user_id = uid order by last_seen_at desc limit 20
    );
end;
$$;

create or replace function public.unregister_push(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where token = p_token and user_id = (select auth.uid());
$$;

revoke all on function public.register_push(text, text, jsonb) from public, anon;
revoke all on function public.unregister_push(text) from public, anon;
grant execute on function public.register_push(text, text, jsonb) to authenticated;
grant execute on function public.unregister_push(text) to authenticated;

-- Appareils visés par une annonce du back-office :
-- « service » = tous les membres ; « news » = membres abonnés aux nouvelles (profiles.news_opt_in),
-- plus les visiteurs sans compte qui ont accepté les notifications sur leur appareil.
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
  else
    raise exception 'audience inconnue : %', p_audience;
  end if;
end;
$$;

-- Réserve les annonces push en attente (table broadcasts du back-office) :
-- deux envois lancés en même temps ne peuvent pas prendre la même annonce.
create or replace function public.claim_push_broadcasts()
returns table (id bigint, subject text, body text, audience text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.broadcasts b
    set push_status = 'en_cours'
    where 'push' = any (b.channels) and b.push_status = 'en_attente'
    returning b.id, b.subject, b.body, b.audience::text;
end;
$$;

revoke all on function public.push_targets(text) from public, anon, authenticated;
revoke all on function public.claim_push_broadcasts() from public, anon, authenticated;
grant execute on function public.push_targets(text) to service_role;
grant execute on function public.claim_push_broadcasts() to service_role;
