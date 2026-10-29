-- Les étoiles sous les réponses de Michel : une note de 1 à 5 pour savoir si la réponse était pertinente.
-- La question et la réponse notées sont gardées avec la note (seulement quand on note), pour comprendre
-- ce qui plaît et ce qui coince. Écriture par noter_reponse() seulement, lecture réservée aux admins.
-- Rejouable sans risque.

create table if not exists public.notes_reponses (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  -- Identifiant de la réponse donné par l'appareil : changer d'avis remplace la note au lieu d'en ajouter une.
  cle text not null check (char_length(cle) between 1 and 64),
  note smallint not null check (note between 1 and 5),
  mode text check (mode is null or char_length(mode) <= 40),
  question text check (question is null or char_length(question) <= 500),
  reponse text not null check (char_length(reponse) <= 4000),
  created_at timestamptz not null default now(),
  unique (user_id, cle)
);

create index if not exists notes_reponses_created_idx on public.notes_reponses (created_at desc);

alter table public.notes_reponses enable row level security;
revoke all on public.notes_reponses from anon, authenticated;
drop policy if exists notes_reponses_admin_read on public.notes_reponses;
create policy notes_reponses_admin_read on public.notes_reponses
  for select to authenticated using ((select public.is_admin()));
grant select on public.notes_reponses to authenticated;

insert into public.app_config (key, value) values ('notes_par_jour', '100')
on conflict (key) do nothing;

-- Note une réponse. Renvoie 'ok', 'connexion', 'invalide' ou 'quota'.
create or replace function public.noter_reponse(
  p_cle text,
  p_note integer,
  p_reponse text,
  p_question text default null,
  p_mode text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  par_jour integer := coalesce((select value::integer from public.app_config where key = 'notes_par_jour'), 100);
begin
  if uid is null then
    return 'connexion';
  end if;
  if p_note is null or p_note not between 1 and 5 or coalesce(p_cle, '') = '' or char_length(p_cle) > 64
     or coalesce(btrim(p_reponse), '') = '' then
    return 'invalide';
  end if;

  perform pg_advisory_xact_lock(hashtext('note:' || uid::text));

  -- Changer d'avis sur une réponse déjà notée ne compte pas dans le quota.
  update public.notes_reponses n set note = p_note, created_at = now()
  where n.user_id = uid and n.cle = p_cle;
  if found then
    return 'ok';
  end if;

  if (select count(*) from public.notes_reponses n
      where n.user_id = uid and n.created_at > now() - interval '1 day') >= par_jour then
    return 'quota';
  end if;

  insert into public.notes_reponses (user_id, cle, note, mode, question, reponse)
  values (uid, p_cle, p_note, left(nullif(btrim(p_mode), ''), 40), left(nullif(btrim(p_question), ''), 500), left(p_reponse, 4000));

  -- Conservation : un an au plus (voir la politique de confidentialité).
  delete from public.notes_reponses n where n.created_at < now() - interval '1 year';
  return 'ok';
end;
$$;

revoke all on function public.noter_reponse(text, integer, text, text, text) from public, anon;
grant execute on function public.noter_reponse(text, integer, text, text, text) to authenticated;
