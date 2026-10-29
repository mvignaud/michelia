-- Comptes MichelIA : e-mail et mot de passe, Google ou Facebook.
-- On ne garde que le prénom, le nom et l'année de naissance (pour l'âge et la règle des 18 ans).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text check (char_length(first_name) <= 50),
  last_name text check (char_length(last_name) <= 50),
  birth_year integer check (birth_year between 1900 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Lire son profil" on public.profiles;
create policy "Lire son profil" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Modifier son profil" on public.profiles;
create policy "Modifier son profil" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant select, update (first_name, last_name, birth_year, updated_at) on public.profiles to authenticated;

-- Crée le profil à l'inscription, à partir du formulaire (e-mail) ou du fournisseur (Google, Facebook).
create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  year_text text := meta ->> 'birth_year';
begin
  if new.is_anonymous then
    return new;
  end if;
  insert into public.profiles (id, first_name, last_name, birth_year)
  values (
    new.id,
    left(nullif(trim(coalesce(meta ->> 'first_name', meta ->> 'given_name', split_part(meta ->> 'full_name', ' ', 1))), ''), 50),
    left(nullif(trim(coalesce(meta ->> 'last_name', meta ->> 'family_name')), ''), 50),
    case when year_text ~ '^\d{4}$' and year_text::int between 1900 and 2100 then year_text::int end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile();

-- Suppression du compte par son titulaire (profil et compteurs suivent en cascade).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users where id = (select auth.uid()) and not is_anonymous;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Quotas quotidiens : 10 messages sans compte, 100 avec un compte.
insert into public.app_config (key, value) values
  ('daily_limit_guest', '10'),
  ('daily_limit_member', '100')
on conflict (key) do nothing;
