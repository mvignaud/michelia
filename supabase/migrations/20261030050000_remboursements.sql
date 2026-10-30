-- Remboursements des pourboires Stancer. Stancer ne prévient pas (aucun webhook au remboursement) :
-- la fonction « stancer-remboursements » relit toutes les 15 minutes les paiements Stancer des 120
-- derniers jours et inscrit ici le montant remboursé. Le fil facturation (facturer) envoie ensuite
-- l'e-mail de remboursement et l'avoir E-KO. La note du mois, le carnet et le tableau de bord admin
-- comptent désormais net des remboursements. Rejouable.

alter table public.pourboires
  add column if not exists paiement_carte text,
  add column if not exists rembourse_cents integer not null default 0,
  add column if not exists rembourse_le timestamptz,
  add column if not exists rembourse_verifie_le timestamptz;

comment on column public.pourboires.paiement_carte is 'Paiement Stancer (paym_…) derrière le payment intent : sert à relire les remboursements.';
comment on column public.pourboires.rembourse_cents is 'Total remboursé chez Stancer (to_refund, refund_sent, refunded, payment_canceled).';
comment on column public.pourboires.rembourse_le is 'Premier remboursement constaté.';

create index if not exists pourboires_remboursements_idx
  on public.pourboires (rembourse_verifie_le nulls first)
  where prestataire = 'stancer' and not essai;

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
  prestataire text := coalesce((select value from public.app_config where key = 'comptoir_prestataire'), 'stripe');
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

  -- Net des remboursements.
  select coalesce(sum(montant_cents - rembourse_cents), 0) / 100.0
  into recu
  from public.pourboires
  where created_at >= start_month::timestamp at time zone 'Europe/Paris' and not essai;

  return jsonb_build_object(
    -- Stripe a besoin de sa clé publiable ; Stancer n'a besoin que de son secret, côté fonctions.
    'actif',
      coalesce((select value from public.app_config where key = 'comptoir_actif'), 'false') = 'true'
      and (prestataire = 'stancer' or btrim(cle) <> ''),
    'prestataire', prestataire,
    'essai', coalesce((select value from public.app_config where key = 'comptoir_essai'), 'false') = 'true',
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
          where prenom is not null and prenom <> '' and not essai and rembourse_cents < montant_cents
          order by lower(prenom), created_at desc
        ) d
        order by dernier desc
        limit 60
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_cout_par_actif()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  start_month date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  result jsonb;
begin
  perform public.assert_admin();
  with par_compte as (
    select user_id,
      sum(public.token_cost(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)) as cout
    from public.usage_daily
    where day > today - 30
    group by user_id
    having sum(messages) > 0
  ),
  classes as (
    select cout, row_number() over (order by cout desc) as rang, count(*) over () as n
    from par_compte
  )
  select jsonb_build_object(
    'actifs', (select count(*) from par_compte),
    'cout_total', coalesce((select sum(cout) from par_compte), 0),
    'cout_moyen', coalesce((select avg(cout) from par_compte), 0),
    'mediane', coalesce((select percentile_cont(0.5) within group (order by cout) from par_compte), 0),
    'p90', coalesce((select percentile_cont(0.9) within group (order by cout) from par_compte), 0),
    -- Part du coût total faite par les 10 % d'utilisateurs les plus gros (au moins un).
    'part_top10', coalesce((
      select sum(cout) filter (where rang <= ceil(n * 0.1)) / nullif(sum(cout), 0) from classes
    ), 0),
    'tranches', (
      select jsonb_agg(jsonb_build_object('label', t.label, 'actifs', t.actifs) order by t.ordre)
      from (
        select o.ordre, o.label,
          (select count(*) from par_compte p where p.cout >= o.mini and p.cout < o.maxi) as actifs
        from (values
          (1, '< 0,01 $', 0::numeric, 0.01::numeric),
          (2, '0,01 – 0,05 $', 0.01, 0.05),
          (3, '0,05 – 0,15 $', 0.05, 0.15),
          (4, '0,15 – 0,50 $', 0.15, 0.50),
          (5, '> 0,50 $', 0.50, 1e12)
        ) as o(ordre, label, mini, maxi)
      ) t
    ),
    'pourboires_mois', jsonb_build_object(
      'nombre', (select count(*) from public.pourboires where created_at >= start_month::timestamp at time zone 'Europe/Paris' and not essai and rembourse_cents < montant_cents),
      'total_eur', coalesce((
        select sum(montant_cents - rembourse_cents) / 100.0 from public.pourboires
        where created_at >= start_month::timestamp at time zone 'Europe/Paris' and not essai
      ), 0)
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_cout_par_actif() from public, anon;
grant execute on function public.admin_cout_par_actif() to authenticated;

select cron.unschedule('stancer-remboursements') where exists (select 1 from cron.job where jobname = 'stancer-remboursements');
select cron.schedule(
  'stancer-remboursements',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/stancer-remboursements',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
