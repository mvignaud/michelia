-- La causette : une conversation avec Michel partagée par un lien public en lecture seule
-- (michel.beer/la-causette/<id>). Seuls le texte et qui parle partent, jamais les photos.
-- Écriture par partager_causette(), lecture par lire_causette() (ouverte à tous, mais seulement
-- par identifiant : impossible de lister les causettes des autres). Rejouable sans risque.

create table if not exists public.causettes (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{8,16}$'),
  user_id uuid references auth.users (id) on delete cascade,
  -- [{ "role": "user" | "assistant", "content": "…" }, …]
  messages jsonb not null check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists causettes_user_idx on public.causettes (user_id, created_at desc);

alter table public.causettes enable row level security;
revoke all on public.causettes from anon, authenticated;
drop policy if exists causettes_admin_read on public.causettes;
create policy causettes_admin_read on public.causettes
  for select to authenticated using ((select public.is_admin()));
grant select on public.causettes to authenticated;

insert into public.app_config (key, value) values ('causettes_par_jour', '20')
on conflict (key) do nothing;

-- Crée un lien. Renvoie { "id": "…" } ou { "erreur": "connexion" | "invalide" | "quota" }.
create or replace function public.partager_causette(p_messages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  par_jour integer := coalesce((select value::integer from public.app_config where key = 'causettes_par_jour'), 20);
  propres jsonb;
  nouvel_id text;
begin
  if uid is null then
    return jsonb_build_object('erreur', 'connexion');
  end if;
  if p_messages is null or jsonb_typeof(p_messages) <> 'array'
     or jsonb_array_length(p_messages) not between 1 and 60 then
    return jsonb_build_object('erreur', 'invalide');
  end if;

  -- On ne garde que le rôle et le texte, et on refuse tout le reste (photos comprises).
  select jsonb_agg(jsonb_build_object('role', m->>'role', 'content', m->>'content') order by i)
  into propres
  from jsonb_array_elements(p_messages) with ordinality as t(m, i)
  where jsonb_typeof(m) = 'object'
    and m->>'role' in ('user', 'assistant')
    and jsonb_typeof(m->'content') = 'string'
    and char_length(btrim(m->>'content')) between 1 and 8000;

  if propres is null or jsonb_array_length(propres) <> jsonb_array_length(p_messages)
     or not exists (select 1 from jsonb_array_elements(propres) m where m->>'role' = 'assistant')
     or char_length(propres::text) > 80000 then
    return jsonb_build_object('erreur', 'invalide');
  end if;

  perform pg_advisory_xact_lock(hashtext('causette:' || uid::text));
  if (select count(*) from public.causettes c
      where c.user_id = uid and c.created_at > now() - interval '1 day') >= par_jour then
    return jsonb_build_object('erreur', 'quota');
  end if;

  loop
    nouvel_id := translate(rtrim(encode(extensions.gen_random_bytes(8), 'base64'), '='), '+/', '-_');
    exit when not exists (select 1 from public.causettes c where c.id = nouvel_id);
  end loop;
  insert into public.causettes (id, user_id, messages) values (nouvel_id, uid, propres);

  -- Conservation : un an au plus (voir la politique de confidentialité).
  delete from public.causettes c where c.created_at < now() - interval '1 year';
  return jsonb_build_object('id', nouvel_id);
end;
$$;

-- Lit une causette par son identifiant, sans dire qui l'a partagée. Null si elle n'existe pas (ou plus).
create or replace function public.lire_causette(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('messages', c.messages, 'created_at', c.created_at)
  from public.causettes c
  where c.id = p_id and c.created_at > now() - interval '1 year';
$$;

-- Les liens partagés par la personne connectée, pour pouvoir les retirer.
create or replace function public.mes_causettes()
returns table (id text, created_at timestamptz, apercu text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.created_at,
    left((select m->>'content' from jsonb_array_elements(c.messages) m limit 1), 80)
  from public.causettes c
  where c.user_id = (select auth.uid())
  order by c.created_at desc
  limit 50;
$$;

-- Retire un lien. Seul son auteur le peut. Renvoie true si un lien a été retiré.
create or replace function public.retirer_causette(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.causettes c where c.id = p_id and c.user_id = (select auth.uid());
  return found;
end;
$$;

revoke all on function public.partager_causette(jsonb) from public, anon;
grant execute on function public.partager_causette(jsonb) to authenticated;
revoke all on function public.lire_causette(text) from public;
grant execute on function public.lire_causette(text) to anon, authenticated;
revoke all on function public.mes_causettes() from public, anon;
grant execute on function public.mes_causettes() to authenticated;
revoke all on function public.retirer_causette(text) from public, anon;
grant execute on function public.retirer_causette(text) to authenticated;
