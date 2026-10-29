-- Back-office : supprimer un compte, ou relier deux comptes d'une même personne
-- (par exemple un compte ouvert avec Facebook et un autre avec Google).
-- Relier = fusionner : le compte gardé récupère les moyens de connexion, l'usage, la conversation
-- et les appareils de l'autre, puis l'autre compte est supprimé. Chaque opération est journalisée.
-- Rejouable sans risque.

-- Supprime un compte et tout ce qui lui est rattaché (profil, usage, conversation, appareils).
create or replace function public.admin_delete_user(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target_email text;
begin
  perform public.assert_admin();
  if p_user = (select auth.uid()) then
    raise exception 'Tu ne peux pas supprimer ton propre compte d''ici.';
  end if;
  select email into target_email from auth.users where id = p_user;
  if not found then
    raise exception 'Ce compte n''existe plus.';
  end if;
  insert into public.admin_audit (admin_id, action, detail)
  values ((select auth.uid()), 'delete_user', jsonb_build_object('user', p_user, 'email', target_email));
  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Relie p_remove à p_keep : p_keep reste, p_remove disparaît.
-- Les connexions Google, Facebook et Apple passent sur p_keep. L'e-mail (avec son mot de passe)
-- et le numéro de téléphone de p_remove ne passent que si p_keep n'en a pas : un compte n'a qu'un e-mail.
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
