-- Le comptoir de Michel : pourboires facultatifs, sur le web seulement, par Stripe Payment Links.
-- La fonction Edge « stripe-webhook » enregistre chaque paiement (clé service_role) ; la page
-- /comptoir lit seulement comptoir_public(). Rien de tout ça n'est lié dans les applis iOS et Android.
-- Les liens Stripe (url) et l'ouverture du comptoir se règlent dans app_config, voir docs/COMPTOIR.md.
-- Rejouable sans risque.

-- Un pourboire reçu : une ligne par session de paiement Stripe (l'unicité rend le webhook rejouable).
create table if not exists public.pourboires (
  id bigint generated always as identity primary key,
  stripe_session_id text not null unique,
  montant_cents integer not null check (montant_cents > 0),
  devise text not null default 'eur',
  palier text not null default 'autre',
  prenom text check (prenom is null or char_length(prenom) <= 30),
  created_at timestamptz not null default now()
);

create index if not exists pourboires_created_idx on public.pourboires (created_at desc);

-- Aucune policy : seuls le webhook (service_role) et les fonctions ci-dessous y accèdent.
alter table public.pourboires enable row level security;
revoke all on public.pourboires from anon, authenticated;

-- Réglages du comptoir. Fermé tant que Mathieu n'a pas rempli les liens et passé comptoir_actif à 'true'.
-- prix_cents sert aussi au webhook pour reconnaître le palier payé.
insert into public.app_config (key, value) values
  ('comptoir_actif', 'false'),
  ('comptoir_paliers', $json$[
    {"id": "cafe", "nom": "Le café serré", "prix_cents": 199, "url": "", "merci": "Merci, ça me réveille mieux que le coq du voisin."},
    {"id": "croustade", "nom": "La croustade", "prix_cents": 299, "url": "", "merci": "Une croustade ! T'es un bon, toi. Je la partage pas, par contre."},
    {"id": "garbure", "nom": "La garbure", "prix_cents": 499, "url": "", "merci": "Avec ça je tiens jusqu'à la Saint-Martin."},
    {"id": "fete", "nom": "Le repas de fête", "prix_cents": 999, "url": "", "merci": "Là tu m'as eu. Je te mets en haut du carnet des copains, et je râle plus pendant une heure. Promis."}
  ]$json$),
  -- Dollars vers euros, pour comparer le coût Claude (en dollars) aux pourboires (en euros).
  ('usd_eur', '0.92')
on conflict (key) do nothing;

-- Ce que la page /comptoir a le droit de savoir : ouverture, paliers, la note du mois et le carnet des copains.
-- Publique (visiteurs anonymes compris) : elle ne renvoie que des prénoms seuls et des totaux.
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
      'url', coalesce(p ->> 'url', ''),
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
    'actif', coalesce((select value from public.app_config where key = 'comptoir_actif'), 'false') = 'true',
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

-- Coût réel par utilisateur actif, sur 30 jours glissants (dollars, comme admin_costs).
-- Actif : au moins un message sur la période. Les tranches sont en dollars par utilisateur.
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
      'nombre', (select count(*) from public.pourboires where created_at >= start_month::timestamp at time zone 'Europe/Paris'),
      'total_eur', coalesce((
        select sum(montant_cents) / 100.0 from public.pourboires
        where created_at >= start_month::timestamp at time zone 'Europe/Paris'
      ), 0)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_cout_par_actif() from public, anon;
grant execute on function public.admin_cout_par_actif() to authenticated;
