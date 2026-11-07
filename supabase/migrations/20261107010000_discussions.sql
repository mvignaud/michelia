-- Plusieurs causettes par membre (le carnet, à gauche du chat ou en tiroir sur téléphone).
-- Une ligne par causette. La table conversations reste : la causette où l'on vient d'écrire y est
-- recopiée (avec le prénom), pour le back-office et les applis d'avant le carnet.

create table if not exists public.discussions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  titre text not null default 'Causette' check (char_length(titre) <= 80),
  messages jsonb not null default '[]'::jsonb check (pg_column_size(messages) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discussions_user_updated on public.discussions (user_id, updated_at desc);

alter table public.discussions enable row level security;

drop policy if exists "Lire ses causettes" on public.discussions;
create policy "Lire ses causettes" on public.discussions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Créer ses causettes" on public.discussions;
create policy "Créer ses causettes" on public.discussions
  for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists "Modifier ses causettes" on public.discussions;
create policy "Modifier ses causettes" on public.discussions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Effacer ses causettes" on public.discussions;
create policy "Effacer ses causettes" on public.discussions
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.discussions to authenticated;

-- Garde-fou : l'appli en garde 30 ; au-delà de 100 par compte, la base refuse.
create or replace function public.discussions_plafond()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.discussions where user_id = new.user_id) >= 100 then
    raise exception 'Trop de causettes gardées sur ce compte.';
  end if;
  return new;
end;
$$;

revoke all on function public.discussions_plafond() from public, anon, authenticated;

drop trigger if exists discussions_plafond on public.discussions;
create trigger discussions_plafond before insert on public.discussions
  for each row execute function public.discussions_plafond();

-- La conversation déjà gardée de chaque membre devient sa première causette.
insert into public.discussions (user_id, titre, messages, created_at, updated_at)
select
  c.user_id,
  coalesce(
    nullif(left(regexp_replace(trim((
      select m ->> 'content' from jsonb_array_elements(c.messages) m
      where m ->> 'role' = 'user' and trim(coalesce(m ->> 'content', '')) <> ''
      limit 1
    )), '\s+', ' ', 'g'), 60), ''),
    'Causette'
  ),
  c.messages,
  c.updated_at,
  c.updated_at
from public.conversations c
where jsonb_typeof(c.messages) = 'array'
  and jsonb_array_length(c.messages) > 0
  and not exists (select 1 from public.discussions d where d.user_id = c.user_id);

-- Relier deux comptes : les causettes du compte relié passent sur le compte gardé
-- (même fonction que dans 20261029110000_comptes_admin.sql, avec cette seule ligne en plus).
create or replace function public.admin_merge_users(p_keep uuid, p_remove uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  keep_user auth.users%rowtype;
  gone auth.users%rowtype;
  take_email boolean;
  take_phone boolean;
  providers jsonb;
begin
  perform public.assert_admin();
  if p_keep is null or p_remove is null or p_keep = p_remove then
    raise exception 'Choisis deux comptes différents.';
  end if;
  if p_remove = (select auth.uid()) then
    raise exception 'Garde plutôt ton propre compte : celui qui disparaît ne peut pas être le tien.';
  end if;
  select * into keep_user from auth.users where id = p_keep for update;
  if not found then raise exception 'Le compte à garder n''existe plus.'; end if;
  select * into gone from auth.users where id = p_remove for update;
  if not found then raise exception 'Le compte à relier n''existe plus.'; end if;

  take_email := keep_user.email is null and gone.email is not null;
  take_phone := keep_user.phone is null and gone.phone is not null;

  -- Moyens de connexion. Les identités e-mail et téléphone sont liées à l'adresse et au numéro :
  -- elles ne suivent que si l'adresse ou le numéro suit.
  update auth.identities
  set user_id = p_keep,
    provider_id = case when provider in ('email', 'phone') then p_keep::text else provider_id end,
    identity_data = case when provider in ('email', 'phone')
      then identity_data || jsonb_build_object('sub', p_keep::text) else identity_data end
  where user_id = p_remove
    and (provider not in ('email', 'phone') or (provider = 'email' and take_email) or (provider = 'phone' and take_phone));

  -- Usage : les compteurs du jour s'additionnent.
  insert into public.usage_daily as u (user_id, day, messages, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
  select p_keep, day, messages, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
  from public.usage_daily where user_id = p_remove
  on conflict (user_id, day) do update set
    messages = u.messages + excluded.messages,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens;

  insert into public.usage_hourly as h (user_id, hour, messages)
  select p_keep, hour, messages from public.usage_hourly where user_id = p_remove
  on conflict (user_id, hour) do update set messages = h.messages + excluded.messages;

  -- Profil : on complète ce qui manque. L'accord pour les nouvelles reste celui du compte gardé :
  -- un refus n'est pas daté, on ne peut donc pas savoir lequel des deux choix est le plus récent.
  insert into public.profiles (id) values (p_keep) on conflict (id) do nothing;
  update public.profiles k set
    first_name = coalesce(k.first_name, r.first_name),
    last_name = coalesce(k.last_name, r.last_name),
    birth_year = coalesce(k.birth_year, r.birth_year)
  from public.profiles r
  where k.id = p_keep and r.id = p_remove;

  -- Conversation : on garde la plus récente.
  if exists (
    select 1 from public.conversations r
    where r.user_id = p_remove
      and r.updated_at > coalesce((select k.updated_at from public.conversations k where k.user_id = p_keep), '-infinity')
  ) then
    delete from public.conversations where user_id = p_keep;
    update public.conversations set user_id = p_keep where user_id = p_remove;
  end if;

  -- Causettes : toutes passent sur le compte gardé.
  update public.discussions set user_id = p_keep where user_id = p_remove;

  update public.push_subscriptions set user_id = p_keep where user_id = p_remove;
  insert into public.broadcast_deliveries (broadcast_id, user_id, ok, sent_at)
  select broadcast_id, p_keep, ok, sent_at from public.broadcast_deliveries where user_id = p_remove
  on conflict do nothing;
  update public.broadcasts set created_by = p_keep where created_by = p_remove;
  update public.admin_audit set admin_id = p_keep where admin_id = p_remove;
  if exists (select 1 from public.admins where user_id = p_remove) then
    insert into public.admins (user_id) values (p_keep) on conflict do nothing;
  end if;

  insert into public.admin_audit (admin_id, action, detail)
  values ((select auth.uid()), 'merge_users', jsonb_build_object(
    'keep', p_keep, 'keep_email', keep_user.email,
    'removed', p_remove, 'removed_email', gone.email,
    'email_moved', take_email, 'phone_moved', take_phone
  ));

  -- Le compte relié disparaît (avec ce qui n'a pas été repris), puis son e-mail ou son numéro
  -- passe sur le compte gardé si celui-ci n'en avait pas.
  delete from auth.users where id = p_remove;

  -- Moyens de connexion : ceux déjà notés sur le compte gardé, puis ceux des identités reprises.
  select coalesce(jsonb_agg(p order by first_seen), '[]'::jsonb) into providers
  from (
    select p, min(rank) as first_seen
    from (
      select x.p, x.n as rank
      from jsonb_array_elements_text(coalesce(keep_user.raw_app_meta_data -> 'providers', '[]'::jsonb)) with ordinality as x(p, n)
      union all
      select i.provider, 1000 from auth.identities i where i.user_id = p_keep
    ) all_providers
    where p <> 'anonymous'
    group by p
  ) t;

  update auth.users set
    email = case when take_email then gone.email else email end,
    encrypted_password = case when take_email then gone.encrypted_password else encrypted_password end,
    email_confirmed_at = case when take_email then gone.email_confirmed_at else email_confirmed_at end,
    phone = case when take_phone then gone.phone else phone end,
    phone_confirmed_at = case when take_phone then gone.phone_confirmed_at else phone_confirmed_at end,
    -- Un visiteur anonyme qui récupère un moyen de connexion devient un membre.
    is_anonymous = is_anonymous and jsonb_array_length(providers) = 0,
    raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('providers', providers)
      || case when coalesce(raw_app_meta_data ->> 'provider', 'anonymous') = 'anonymous' and jsonb_array_length(providers) > 0
              then jsonb_build_object('provider', providers -> 0) else '{}'::jsonb end,
    updated_at = now()
  where id = p_keep;

  return jsonb_build_object('email_moved', take_email, 'phone_moved', take_phone, 'providers', providers);
end;
$$;

revoke all on function public.admin_merge_users(uuid, uuid) from public, anon;
grant execute on function public.admin_merge_users(uuid, uuid) to authenticated;
