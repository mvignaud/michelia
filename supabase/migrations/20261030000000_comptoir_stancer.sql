-- Le comptoir de Michel sur le web avec Stancer (prestataire français) au lieu de Stripe.
-- Le choix se fait dans app_config : comptoir_prestataire = 'stripe' (par défaut) ou 'stancer'.
-- Avec Stancer, la fonction « comptoir-paiement » crée un payment intent, la page affiche les champs
-- de carte Stancer (iframe) et la fonction relit le paiement chez Stancer avant d'écrire le pourboire ;
-- « stancer-webhook » fait la même chose quand Stancer prévient. La clé secrète (STANCER_API_KEY)
-- reste dans les secrets des Edge Functions, jamais ici. Voir docs/COMPTOIR.md.
-- Rejouable sans risque.

-- Identifiant de paiement générique (pi_… Stancer, cs_… Stripe, transaction de boutique), e-mail du
-- payeur pour le reçu, prestataire, et drapeau des paiements d'essai (clés de test, exclus des totaux).
alter table public.pourboires add column if not exists paiement_id text unique;
alter table public.pourboires add column if not exists prestataire text;
alter table public.pourboires add column if not exists email text;
alter table public.pourboires add column if not exists essai boolean not null default false;
alter table public.pourboires drop constraint if exists pourboires_email_check;
alter table public.pourboires add constraint pourboires_email_check check (email is null or char_length(email) <= 254);
alter table public.pourboires drop constraint if exists pourboires_reference_check;
alter table public.pourboires add constraint pourboires_reference_check
  check (stripe_session_id is not null or store_transaction_id is not null or paiement_id is not null);

update public.pourboires set
  paiement_id = coalesce(stripe_session_id, store_transaction_id),
  prestataire = case when stripe_session_id is not null then 'stripe' else 'boutique' end
where paiement_id is null;

-- Paiements Stancer en cours : ce que le visiteur a choisi (palier, prénom, e-mail), le temps qu'il paie.
-- Écrit et lu seulement par les fonctions (service_role).
create table if not exists public.comptoir_attente (
  paiement_id text primary key,
  palier text not null,
  montant_cents integer not null check (montant_cents > 0),
  prenom text check (prenom is null or char_length(prenom) <= 30),
  email text check (email is null or char_length(email) <= 254),
  essai boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.comptoir_attente enable row level security;
revoke all on public.comptoir_attente from anon, authenticated;

insert into public.app_config (key, value) values
  ('comptoir_prestataire', 'stripe'),
  -- 'true' : la page /comptoir?essai=1 s'ouvre même comptoir fermé, et seuls les paiements faits avec
  -- une clé de test Stancer (stest_…) passent. Les lignes d'essai ne comptent ni dans la note ni au carnet.
  ('comptoir_essai', 'false')
on conflict (key) do nothing;

-- Comme avant, avec le prestataire, le mode essai, et sans les lignes d'essai dans les totaux.
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

  select coalesce(sum(montant_cents), 0) / 100.0
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
          where prenom is not null and prenom <> '' and not essai
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
