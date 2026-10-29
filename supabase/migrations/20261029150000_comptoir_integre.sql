-- Le comptoir de Michel, paiement intégré à la page (Stripe Embedded Checkout) au lieu des Payment Links.
-- La clé publiable Stripe (pk_live_… ou pk_test_…) est publique par nature : elle peut vivre dans
-- app_config et être renvoyée par comptoir_public(). Le secret (STRIPE_SECRET_KEY) reste dans les
-- secrets des Edge Functions, jamais ici. Le champ url des paliers n'est plus utilisé.
-- Rejouable sans risque.

insert into public.app_config (key, value) values
  ('stripe_cle_publique', ''),
  -- 'true' pour calculer la TVA avec Stripe Tax (prix TTC) ; à n'activer qu'une fois Stripe Tax réglé.
  ('stripe_tax', 'false')
on conflict (key) do nothing;

-- Comme avant, avec la clé publiable en plus ; le comptoir n'est ouvert que si comptoir_actif = 'true'
-- ET si la clé publiable est renseignée. Le champ url n'est plus renvoyé (même s'il traîne en base).
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
