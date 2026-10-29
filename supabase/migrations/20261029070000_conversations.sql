-- Conversation des membres : la dernière conversation et le prénom retenu par Michel,
-- pour les retrouver sur tous les appareils. Les visiteurs sans compte restent sur l'appareil.

create table if not exists public.conversations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text check (char_length(name) <= 30),
  messages jsonb not null default '[]'::jsonb check (pg_column_size(messages) <= 200000),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

drop policy if exists "Lire sa conversation" on public.conversations;
create policy "Lire sa conversation" on public.conversations
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Créer sa conversation" on public.conversations;
create policy "Créer sa conversation" on public.conversations
  for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists "Modifier sa conversation" on public.conversations;
create policy "Modifier sa conversation" on public.conversations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.conversations to authenticated;
