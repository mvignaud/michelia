-- MichelIA+ sur le site, par carte : quotas des abonnés et prélèvement automatique des échéances.
-- Les abonnés MichelIA+ ont des quotas plus larges dans la fonction chat (réglages *_plus ci-dessous,
-- modifiables à tout moment). Toutes les heures, « michelia-plus-echeances » prélève les échéances
-- arrivées à terme avec la carte enregistrée chez Stancer (voir docs/MICHELIA-PLUS.md).
-- Rejouable sans risque.

insert into public.app_config (key, value) values
  ('daily_limit_plus', '400'),
  ('hourly_limit_plus', '60'),
  ('daily_photo_limit_plus', '50')
on conflict (key) do nothing;

-- La fonction chat demande le droit de l'abonné avec la clé de service.
grant execute on function public.michelia_plus(uuid) to service_role;

select cron.unschedule('michelia-plus-echeances') where exists (select 1 from cron.job where jobname = 'michelia-plus-echeances');
select cron.schedule(
  'michelia-plus-echeances',
  '7 * * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/michelia-plus-echeances',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);
