-- Factures de Michel dans l'ERP E-KO de GOLDEN PRINT, et reçu PDF envoyé au payeur.
-- La fonction « facturer », appelée toutes les 5 minutes, prend chaque pourboire web payé (hors essais,
-- hors applis), crée sa facture dans E-KO (jamais envoyée au client, au nom du client générique
-- « ClientMichel Web »), puis envoie le reçu au payeur s'il a laissé son e-mail. Le jeton E-KO
-- (EKO_API_TOKEN) reste dans les secrets des Edge Functions, jamais ici.
-- Rejouable sans risque.

alter table public.pourboires add column if not exists facture_code text;
alter table public.pourboires add column if not exists facture_reglee_at timestamptz;
alter table public.pourboires add column if not exists recu_envoye_at timestamptz;
alter table public.pourboires add column if not exists facture_erreur text;
alter table public.pourboires add column if not exists facture_tentatives integer not null default 0;
alter table public.pourboires add column if not exists recu_reserve_at timestamptz;
alter table public.pourboires add column if not exists recu_erreur text;
alter table public.pourboires add column if not exists recu_tentatives integer not null default 0;

-- Numéro de reçu, tiré avant le paiement pour servir aussi de numéro de commande chez le prestataire
-- (Stancer order_id) : R2026-000123. Une seule série, sans trou volontaire ni doublon.
create sequence if not exists public.recu_numero_seq;
create or replace function public.prochain_numero_recu()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'R' || to_char(now() at time zone 'Europe/Paris', 'YYYY') || '-' || lpad(nextval('public.recu_numero_seq')::text, 6, '0');
$$;
revoke all on function public.prochain_numero_recu() from public, anon, authenticated;
alter table public.comptoir_attente add column if not exists numero_recu text;
alter table public.pourboires add column if not exists numero_recu text unique;

insert into public.app_config (key, value) values
  -- Facturation lancée : elle attend sans bruit que le secret EKO_API_TOKEN soit posé.
  ('facturation_eko_active', 'true'),
  -- Seuls les pourboires payés à partir de cette date (UTC) sont facturés : ouverture réelle du comptoir Stancer.
  ('facturation_eko_depuis', '2026-10-29T23:26:00Z'),
  -- Nom exact du client générique dans E-KO (créé tout seul s'il n'existe pas).
  ('facturation_eko_client', 'ClientMichel Web'),
  -- Reçus PDF envoyés au payeur, indépendamment de la facturation : tant qu'elle est coupée, le reçu
  -- porte un numéro propre à Michel (R2026-000123). Départ : ouverture réelle du comptoir Stancer.
  ('recus_actifs', 'true'),
  ('recus_depuis', '2026-10-29T23:26:00Z')
on conflict (key) do nothing;

select cron.unschedule('facturer-pourboires') where exists (select 1 from cron.job where jobname = 'facturer-pourboires');
select cron.schedule(
  'facturer-pourboires',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/facturer',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
