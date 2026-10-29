-- Le comptoir de Michel dans les applis iOS et Android : pourboires par achat intégré (Apple, Google),
-- gérés par RevenueCat. La fonction Edge « revenuecat-webhook » enregistre chaque achat dans la même
-- table pourboires que le web (même note du mois, même carnet des copains). Voir docs/COMPTOIR.md.
-- Les clés SDK RevenueCat (appl_…, goog_…) sont publiques par nature ; le secret du webhook
-- (REVENUECAT_WEBHOOK_AUTH) reste dans les secrets des Edge Functions.
-- Rejouable sans risque.

-- Une ligne vient soit d'une session Stripe (web), soit d'une transaction de boutique (applis).
alter table public.pourboires alter column stripe_session_id drop not null;
alter table public.pourboires add column if not exists store_transaction_id text unique;
alter table public.pourboires add column if not exists canal text not null default 'web';
alter table public.pourboires drop constraint if exists pourboires_canal_check;
alter table public.pourboires add constraint pourboires_canal_check check (canal in ('web', 'ios', 'android'));
alter table public.pourboires drop constraint if exists pourboires_reference_check;
alter table public.pourboires add constraint pourboires_reference_check
  check (stripe_session_id is not null or store_transaction_id is not null);

insert into public.app_config (key, value) values
  -- Ouverture du comptoir dans les applis, indépendante du web.
  ('comptoir_appli_actif', 'false'),
  ('revenuecat_cle_ios', ''),
  ('revenuecat_cle_android', ''),
  -- 'true' pour enregistrer aussi les achats de test (sandbox Apple, testeurs Google). À remettre à 'false' après.
  ('comptoir_sandbox', 'false')
on conflict (key) do nothing;

-- Comme avant, avec en plus le bloc « appli » (ouverture et clés RevenueCat).
create or replace function public.comptoir_public()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  start_month date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  rate numeric := coalesce((select value::numeric from public.app_config where key = 'usd_eur'), 0.92);
  cle text := coalesce((select value from public.app_config where key = 'stripe_cle_publique'), '');
  cle_ios text := btrim(coalesce((select value from public.app_config where key = 'revenuecat_cle_ios'), ''));
  cle_android text := btrim(coalesce((select value from public.app_config where key = 'revenuecat_cle_android'), ''));
  cout numeric;
  recu numeric;
  paliers jsonb;
begin
  -- Un JSON mal rempli dans app_config ne doit pas casser la page : elle affichera simplement zéro palier.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p ->> 'id',
      'nom', p ->> 'nom',
      'prix_cents', (p ->> 'prix_cents')::integer,
      'merci', coalesce(p ->> 'merci', '')
    )), '[]'::jsonb)
    into paliers
    from jsonb_array_elements((select value::jsonb from public.app_config where key = 'comptoir_paliers')) p;
  exception when others then
    paliers := '[]'::jsonb;
  end;

  select coalesce(sum(public.token_cost(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)), 0) * rate
  into cout
  from public.usage_global where day >= start_month;

  select coalesce(sum(montant_cents), 0) / 100.0
  into recu
  from public.pourboires
  where created_at >= start_month::timestamp at time zone 'Europe/Paris';

  return jsonb_build_object(
    'actif',
      coalesce((select value from public.app_config where key = 'comptoir_actif'), 'false') = 'true'
      and btrim(cle) <> '',
    'stripe_cle_publique', btrim(cle),
    -- Dans les applis : achat intégré par RevenueCat. Clés SDK publiques (appl_…, goog_…), une par boutique.
    'appli', jsonb_build_object(
      'actif', coalesce((select value from public.app_config where key = 'comptoir_appli_actif'), 'false') = 'true',
      'cle_ios', cle_ios,
      'cle_android', cle_android
    ),
    'paliers', coalesce(paliers, '[]'::jsonb),
    'note_du_mois', jsonb_build_object(
      'cout_eur', round(cout, 2),
      'recu_eur', round(recu, 2),
      'pourcent', case when cout > 0 then round(recu / cout * 100) else 0 end
    ),
    -- Prénom seul, un par prénom (sans tenir compte des majuscules), du plus récent au plus ancien.
    'carnet', coalesce((
      select jsonb_agg(c.prenom order by c.dernier desc)
      from (
        select prenom, dernier from (
          select distinct on (lower(prenom)) prenom, created_at as dernier
          from public.pourboires
          where prenom is not null and prenom <> ''
          order by lower(prenom), created_at desc
        ) d
        order by dernier desc
        limit 60
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.comptoir_public() from public;
grant execute on function public.comptoir_public() to anon, authenticated;
