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

-- Une seule échéance vivante (en cours ou payée) par abonnement et par période : jamais deux
-- prélèvements pour le même mois.
create unique index if not exists abonnement_echeances_periode_idx
  on public.abonnement_echeances (abonnement_id, periode_debut) where statut <> 'refuse';

-- Une seule souscription en cours par compte sur le site, en plus d'un seul abonnement vivant :
-- un double clic ou un second onglet ne peut pas créer un second paiement.
-- (Deux essais en attente déjà là pour un même compte : le plus ancien passe expire, rien n'est effacé.)
update public.abonnements a set statut = 'expire', updated_at = now()
where a.statut = 'en_attente' and a.source = 'web' and exists (
  select 1 from public.abonnements b
  where b.user_id = a.user_id and b.id > a.id and b.source = 'web' and b.statut = 'en_attente'
);
drop index if exists public.abonnements_vivant_idx;
create unique index abonnements_vivant_idx on public.abonnements (user_id)
  where statut in ('actif', 'impaye', 'resilie') or (statut = 'en_attente' and source = 'web');

-- Secret du cron des échéances, gardé dans le coffre (vault) : la fonction refuse tout appel qui
-- ne le présente pas. Créé ici une fois, jamais affiché ni écrit dans le dépôt.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'michelia_plus_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'michelia_plus_cron',
      'En-tête x-michel-cron du cron michelia-plus-echeances');
  end if;
end $$;

create or replace function public.michelia_plus_cron_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32 and p_secret = (
    select decrypted_secret from vault.decrypted_secrets where name = 'michelia_plus_cron' limit 1
  ), false)
$$;
revoke all on function public.michelia_plus_cron_ok(text) from public, anon, authenticated;
grant execute on function public.michelia_plus_cron_ok(text) to service_role;

select cron.unschedule('michelia-plus-echeances') where exists (select 1 from cron.job where jobname = 'michelia-plus-echeances');
select cron.schedule(
  'michelia-plus-echeances',
  '7 * * * *',
  $cron$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/michelia-plus-echeances',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-michel-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'michelia_plus_cron' limit 1)
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $cron$
);
