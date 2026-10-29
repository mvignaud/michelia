-- Le cahier de doléances (michel.beer/cahier-de-doleances) : les idées et les râleries des gens
-- pour améliorer Michel. Les visiteurs passent par deposer_doleance(), qui exige une session
-- (compte anonyme créé derrière le captcha Turnstile) et applique les quotas. La lecture est
-- réservée aux administrateurs : le tri se fait dans le projet, voir docs/CAHIER-DE-DOLEANCES.md.
-- Rejouable sans risque.

create table if not exists public.doleances (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  categorie text not null default 'idee' check (categorie in ('idee', 'bug', 'autre')),
  texte text not null check (char_length(texte) between 10 and 1000),
  contact text check (contact is null or char_length(contact) <= 120),
  -- nouvelle → retenue (mise dans « Ça mijote ») → servie (sortie), ou bien refusee / doublon.
  statut text not null default 'nouvelle'
    check (statut in ('nouvelle', 'retenue', 'servie', 'refusee', 'doublon')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists doleances_created_idx on public.doleances (created_at desc);
create index if not exists doleances_user_idx on public.doleances (user_id, created_at desc);

-- Aucune policy pour les visiteurs : ils écrivent par la fonction ci-dessous, seuls les admins lisent.
alter table public.doleances enable row level security;
revoke all on public.doleances from anon, authenticated;
drop policy if exists doleances_admin_read on public.doleances;
create policy doleances_admin_read on public.doleances
  for select to authenticated using ((select public.is_admin()));
grant select on public.doleances to authenticated;

insert into public.app_config (key, value) values
  ('doleances_par_jour', '3'),
  ('doleances_global_jour', '200')
on conflict (key) do nothing;

-- Dépose une doléance. Renvoie 'ok', 'connexion', 'trop_court', 'trop_long', 'quota', 'plein' ou 'doublon'.
create or replace function public.deposer_doleance(p_texte text, p_categorie text default 'idee', p_contact text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  v_texte text := btrim(coalesce(p_texte, ''));
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_categorie text := case when p_categorie in ('idee', 'bug', 'autre') then p_categorie else 'idee' end;
  par_jour integer := coalesce((select value::integer from public.app_config where key = 'doleances_par_jour'), 3);
  global_jour integer := coalesce((select value::integer from public.app_config where key = 'doleances_global_jour'), 200);
begin
  if uid is null then
    return 'connexion';
  end if;
  if char_length(v_texte) < 10 then
    return 'trop_court';
  end if;
  if char_length(v_texte) > 1000 or char_length(coalesce(v_contact, '')) > 120 then
    return 'trop_long';
  end if;

  -- Un seul dépôt à la fois par visiteur, pour que deux clics simultanés ne passent pas le quota.
  perform pg_advisory_xact_lock(hashtext('doleance:' || uid::text));

  if exists (
    select 1 from public.doleances d
    where d.user_id = uid and d.texte = v_texte and d.created_at > now() - interval '1 day'
  ) then
    return 'doublon';
  end if;
  if (select count(*) from public.doleances d
      where d.user_id = uid and d.created_at > now() - interval '1 day') >= par_jour then
    return 'quota';
  end if;
  if (select count(*) from public.doleances d
      where d.created_at > now() - interval '1 day') >= global_jour then
    return 'plein';
  end if;

  insert into public.doleances (user_id, categorie, texte, contact)
  values (uid, v_categorie, v_texte, v_contact);

  -- Conservation : deux ans au plus (voir la politique de confidentialité).
  delete from public.doleances d where d.created_at < now() - interval '2 years';
  return 'ok';
end;
$$;

revoke all on function public.deposer_doleance(text, text, text) from public, anon;
grant execute on function public.deposer_doleance(text, text, text) to authenticated;
