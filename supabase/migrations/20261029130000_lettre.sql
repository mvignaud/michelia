-- La lettre de Michel : un e-mail tous les 15 jours aux membres qui ont accepté les nouvelles,
-- avec les nouveautés du carnet (michel.beer/confit-de-canard) parues depuis la lettre d'avant.
-- Envoyée par la fonction « lettre », appelée chaque matin par pg_cron ; rien ne part
-- s'il n'y a rien de neuf, ni avant 15 jours après la lettre précédente.

-- 1. Les lettres envoyées. entrees : clés « date|titre » des nouveautés racontées,
-- pour ne jamais raconter deux fois la même.
create table if not exists public.lettres (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  subject text not null,
  entrees text[] not null,
  email_status text not null default 'envoi' check (email_status in ('envoi', 'envoye', 'partiel', 'echec')),
  email_total integer not null default 0,
  email_sent integer not null default 0,
  email_failed integer not null default 0,
  email_started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.lettres enable row level security;

drop policy if exists "Admins lisent les lettres" on public.lettres;
create policy "Admins lisent les lettres" on public.lettres
  for select to authenticated using ((select public.is_admin()));

grant select on public.lettres to authenticated;

-- Un e-mail par membre et par lettre : une reprise n'écrit qu'à ceux qui ne l'ont pas reçue.
create table if not exists public.lettre_envois (
  lettre_id bigint not null references public.lettres (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ok boolean not null,
  sent_at timestamptz not null default now(),
  primary key (lettre_id, user_id)
);

alter table public.lettre_envois enable row level security;
revoke all on public.lettre_envois from anon, authenticated;

-- 2. Réserve la lettre du jour, sous verrou : deux appels simultanés n'en créent qu'une,
-- et rien ne part si la précédente a moins de p_jours jours (dates de Paris).
create or replace function public.reserver_lettre(p_jours integer, p_subject text, p_entrees text[])
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  derniere timestamptz;
  nouvelle bigint;
begin
  perform pg_advisory_xact_lock(hashtext('lettre-de-michel'));
  select max(created_at) into derniere from public.lettres;
  if derniere is not null
     and (now() at time zone 'Europe/Paris')::date - (derniere at time zone 'Europe/Paris')::date < p_jours then
    return null;
  end if;
  insert into public.lettres (subject, entrees) values (p_subject, p_entrees) returning id into nouvelle;
  return nouvelle;
end;
$$;

revoke all on function public.reserver_lettre(integer, text, text[]) from public, anon, authenticated;
grant execute on function public.reserver_lettre(integer, text, text[]) to service_role;

-- 3. Réglages (modifiables sans redéployer).
-- lettre_debut : pas de lettre avant cette date, pour laisser le temps de s'envoyer un test
-- depuis le back-office. lettre_jours : écart minimal entre deux lettres.
insert into public.app_config (key, value) values
  ('lettre_enabled', 'true'),
  ('lettre_jours', '15'),
  ('lettre_debut', '2026-11-05')
on conflict (key) do nothing;

-- 4. Planification : chaque matin à 8 h UTC (9 h ou 10 h à Paris). La fonction décide seule
-- s'il est temps d'écrire ; l'appeler en trop ne fait rien de plus.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lettre-de-michel') where exists (select 1 from cron.job where jobname = 'lettre-de-michel');
select cron.schedule(
  'lettre-de-michel',
  '0 8 * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/lettre',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
