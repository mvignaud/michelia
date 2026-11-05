-- Avis Trustpilot : une seule fois par inscrit, quelques jours après l'inscription, Michel lui demande
-- son avis par e-mail (fonction « avis », copie cachée à Trustpilot). Coupé tant que avis_email_actif
-- ne vaut pas 'true' : rien ne part en collant ce fichier.

-- 1. Date de l'invitation, par inscrit (null : jamais invité).
alter table public.profiles add column if not exists avis_invite_at timestamptz;

-- 2. Les inscrits à inviter : e-mail confirmé, compte d'au moins p_jours jours, jamais invités.
create or replace function public.avis_a_inviter(p_jours integer, p_limite integer)
returns table (user_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.first_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where not u.is_anonymous
    and u.email is not null
    and u.email_confirmed_at is not null
    and p.avis_invite_at is null
    and u.created_at <= now() - make_interval(days => p_jours)
  order by u.created_at
  limit p_limite;
$$;
revoke all on function public.avis_a_inviter(integer, integer) from public, anon, authenticated;
grant execute on function public.avis_a_inviter(integer, integer) to service_role;

-- 3. Réglages : coupé par défaut ; délai après l'inscription.
insert into public.app_config (key, value) values
  ('avis_email_actif', 'false'),
  ('avis_email_jours', '3')
on conflict (key) do nothing;

-- 4. Chaque matin à 9 h UTC (10 h ou 11 h à Paris), après la lettre de Michel.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('avis-trustpilot') where exists (select 1 from cron.job where jobname = 'avis-trustpilot');
select cron.schedule(
  'avis-trustpilot',
  '0 9 * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/avis',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
