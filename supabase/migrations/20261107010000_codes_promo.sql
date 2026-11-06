-- Codes promo de MichelIA+ sur le site (voir docs/MICHELIA-PLUS.md, section « Codes promo »).
-- Créés depuis le back-office (onglet « Codes promo ») : remise en %, formule visée, nombre d'échéances
-- remisées, compte réservé, nombre d'utilisations, dates. Le code est tapé sur /la-cotisation ; la
-- fonction michelia-plus le pose sur l'abonnement (code_promo_appliquer) et le prix remisé part chez
-- Stancer, puis dans E-KO (prix du contrat remplacé tant que dure la remise).
-- Les achats dans les applis (Apple, Google) ne sont pas concernés : leurs prix sont ceux des boutiques.

create table if not exists public.codes_promo (
  id bigint generated always as identity primary key,
  -- En majuscules, lettres, chiffres et tirets (MICHEL-20).
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  -- 100 % : périodes offertes (rien prélevé ; carte ou mandat gardés pour la suite, sauf si c'est pour toujours).
  remise_pct integer not null check (remise_pct between 1 and 100),
  -- null : au mois comme à l'année.
  formule text check (formule in ('mois', 'an')),
  -- Nombre d'échéances remisées (1 = la première seulement) ; null : tant que dure l'abonnement.
  periodes integer check (periodes is null or periodes between 1 and 120),
  -- Compte qui seul peut s'en servir ; null : tout le monde.
  user_id uuid references auth.users (id) on delete cascade,
  -- Nombre d'abonnements qui peuvent s'en servir ; null : sans limite.
  utilisations_max integer check (utilisations_max is null or utilisations_max >= 1),
  debut timestamptz,
  fin timestamptz,
  actif boolean not null default true,
  note text check (note is null or char_length(note) <= 200),
  cree_par uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.codes_promo enable row level security;
-- Aucune politique : lu et écrit seulement par les fonctions ci-dessous et le rôle service.

-- Une utilisation par abonnement. Supprimée avec lui (souscription jamais payée, nettoyée par le cron) :
-- le code redevient disponible.
create table if not exists public.codes_promo_utilisations (
  id bigint generated always as identity primary key,
  code_id bigint not null references public.codes_promo (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  abonnement_id bigint not null unique references public.abonnements (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists codes_promo_utilisations_code_idx on public.codes_promo_utilisations (code_id);
alter table public.codes_promo_utilisations enable row level security;

-- Sur l'abonnement : prix_cents devient le prix remisé tant que dure la remise ; prix_plein_cents garde
-- le prix normal, repris à la fin puis vidé (fonction michelia-plus-echeances ou passage E-KO).
-- code_promo_id et remise_pct restent pour l'historique.
alter table public.abonnements
  add column if not exists code_promo_id bigint references public.codes_promo (id) on delete set null,
  add column if not exists remise_pct integer check (remise_pct is null or remise_pct between 1 and 100),
  add column if not exists remise_periodes integer check (remise_periodes is null or remise_periodes >= 1),
  add column if not exists prix_plein_cents integer check (prix_plein_cents is null or prix_plein_cents > 0);

-- Périodes offertes (code à 100 %) : abonnement et échéance à 0 €.
alter table public.abonnements drop constraint if exists abonnements_prix_cents_check;
alter table public.abonnements add constraint abonnements_prix_cents_check check (prix_cents >= 0);
alter table public.abonnement_echeances drop constraint if exists abonnement_echeances_montant_cents_check;
alter table public.abonnement_echeances add constraint abonnement_echeances_montant_cents_check check (montant_cents >= 0);

-- Prix remisé, en centimes : arrondi vers le bas à un multiple de 6 centimes, pour que le prix hors
-- taxes (TVA 20 %) tombe juste au centime chez E-KO et que sa facture égale le paiement Stancer.
-- Jamais sous 0,54 € (minimum Stancer : 0,50 €), sauf à 100 % : offert, 0 €.
create or replace function public.prix_remise(p_prix integer, p_pct integer)
returns integer
language sql
immutable
as $$
  select case when p_pct >= 100 then 0
    else least(p_prix, greatest(54, (floor(p_prix * (100 - p_pct) / 100.0 / 6) * 6)::integer)) end;
$$;

-- Utilisations qui comptent : abonnement vivant, ou terminé après au moins un paiement. Une souscription
-- abandonnée ou refusée (expirée sans rien payer) rend le code.
create or replace function public.code_promo_utilisations(p_code bigint, p_user uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.codes_promo_utilisations u
  join public.abonnements a on a.id = u.abonnement_id
  where u.code_id = p_code
    and (p_user is null or u.user_id = p_user)
    and (a.statut <> 'expire'
      or exists (select 1 from public.abonnement_echeances e where e.abonnement_id = a.id and e.statut = 'paye'));
$$;
revoke all on function public.code_promo_utilisations(bigint, uuid) from public, anon, authenticated;

-- Le code vaut-il pour ce compte et cette formule ? Rend la ligne du code, ou une raison de refus.
create or replace function public.code_promo_lire(p_code text, p_user uuid, p_formule text, p_verrou boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.codes_promo;
begin
  if p_verrou then
    select * into c from public.codes_promo where code = upper(trim(p_code)) for update;
  else
    select * into c from public.codes_promo where code = upper(trim(p_code));
  end if;
  if not found or not c.actif or (c.user_id is not null and c.user_id is distinct from p_user) then
    return jsonb_build_object('valide', false, 'raison', 'inconnu');
  end if;
  if (c.debut is not null and c.debut > now()) or (c.fin is not null and c.fin <= now()) then
    return jsonb_build_object('valide', false, 'raison', 'perime');
  end if;
  if c.formule is not null and p_formule is not null and c.formule <> p_formule then
    return jsonb_build_object('valide', false, 'raison', 'formule', 'formule', c.formule);
  end if;
  if public.code_promo_utilisations(c.id, p_user) > 0 then
    return jsonb_build_object('valide', false, 'raison', 'deja');
  end if;
  if c.utilisations_max is not null and public.code_promo_utilisations(c.id) >= c.utilisations_max then
    return jsonb_build_object('valide', false, 'raison', 'epuise');
  end if;
  return jsonb_build_object('valide', true, 'id', c.id, 'code', c.code, 'remise_pct', c.remise_pct,
    'formule', c.formule, 'periodes', c.periodes);
end;
$$;
revoke all on function public.code_promo_lire(text, uuid, text, boolean) from public, anon, authenticated;

-- Pour la page /la-cotisation : le code tapé, et les prix remisés des deux formules. Membres seulement.
create or replace function public.code_promo_verifier(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r jsonb;
  mois integer;
  an integer;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('valide', false, 'raison', 'compte');
  end if;
  if p_code is null or char_length(p_code) > 40 then
    return jsonb_build_object('valide', false, 'raison', 'inconnu');
  end if;
  r := public.code_promo_lire(p_code, auth.uid(), null);
  if not (r ->> 'valide')::boolean then return r; end if;
  begin
    select (p ->> 'mois')::integer, (p ->> 'an')::integer into mois, an
    from (select value::jsonb p from public.app_config where key = 'michelia_plus_prix') c;
  exception when others then
    mois := null;
    an := null;
  end;
  return jsonb_build_object(
    'valide', true,
    'code', r ->> 'code',
    'remise_pct', (r ->> 'remise_pct')::integer,
    'formule', r ->> 'formule',
    'periodes', (r ->> 'periodes')::integer,
    'mois_cents', case when mois is null or (r ->> 'formule') = 'an' then null else public.prix_remise(mois, (r ->> 'remise_pct')::integer) end,
    'an_cents', case when an is null or (r ->> 'formule') = 'mois' then null else public.prix_remise(an, (r ->> 'remise_pct')::integer) end
  );
end;
$$;
revoke all on function public.code_promo_verifier(text) from public, anon;
grant execute on function public.code_promo_verifier(text) to authenticated;

-- Pose le code sur un abonnement encore en attente (fonction michelia-plus, rôle service), d'un seul
-- coup sous verrou : deux souscriptions en même temps ne prennent jamais la dernière place à deux.
create or replace function public.code_promo_appliquer(p_code text, p_abonnement bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a public.abonnements;
  r jsonb;
  prix integer;
begin
  select * into a from public.abonnements where id = p_abonnement for update;
  if not found or a.statut <> 'en_attente' or a.source <> 'web' or a.code_promo_id is not null then
    return jsonb_build_object('valide', false, 'raison', 'abonnement');
  end if;
  r := public.code_promo_lire(p_code, a.user_id, a.formule, true);
  if not (r ->> 'valide')::boolean then return r; end if;
  prix := public.prix_remise(a.prix_cents, (r ->> 'remise_pct')::integer);
  insert into public.codes_promo_utilisations (code_id, user_id, abonnement_id)
  values ((r ->> 'id')::bigint, a.user_id, a.id);
  update public.abonnements set
    code_promo_id = (r ->> 'id')::bigint,
    remise_pct = (r ->> 'remise_pct')::integer,
    remise_periodes = (r ->> 'periodes')::integer,
    prix_plein_cents = a.prix_cents,
    prix_cents = prix,
    updated_at = now()
  where id = a.id;
  return r || jsonb_build_object('prix_cents', prix, 'prix_plein_cents', a.prix_cents);
end;
$$;
revoke all on function public.code_promo_appliquer(text, bigint) from public, anon, authenticated;

-- ── Back-office (onglet « Codes promo »), administrateurs seulement.

create or replace function public.admin_codes_promo()
returns table (
  id bigint, code text, remise_pct integer, formule text, periodes integer, user_id uuid, email text,
  utilisations_max integer, utilisations integer, debut timestamptz, fin timestamptz, actif boolean,
  note text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select c.id, c.code, c.remise_pct, c.formule, c.periodes, c.user_id, u.email::text,
    c.utilisations_max, public.code_promo_utilisations(c.id), c.debut, c.fin, c.actif, c.note, c.created_at
  from public.codes_promo c
  left join auth.users u on u.id = c.user_id
  order by c.created_at desc;
end;
$$;
revoke all on function public.admin_codes_promo() from public, anon;
grant execute on function public.admin_codes_promo() to authenticated;

-- Nouveau code. p_email (facultatif) réserve le code à ce compte.
create or replace function public.admin_code_promo_creer(
  p_code text, p_remise_pct integer, p_formule text default null, p_periodes integer default null,
  p_email text default null, p_utilisations_max integer default null, p_fin timestamptz default null,
  p_note text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  qui uuid;
  nouveau bigint;
begin
  perform public.assert_admin();
  if nullif(trim(p_email), '') is not null then
    select id into qui from auth.users where lower(email) = lower(trim(p_email)) and not coalesce(is_anonymous, false) limit 1;
    if qui is null then
      raise exception 'Aucun compte avec cette adresse' using errcode = 'P0002';
    end if;
  end if;
  insert into public.codes_promo (code, remise_pct, formule, periodes, user_id, utilisations_max, fin, note, cree_par)
  values (upper(trim(p_code)), p_remise_pct, nullif(p_formule, ''), p_periodes, qui, p_utilisations_max, p_fin,
    nullif(trim(p_note), ''), auth.uid())
  returning id into nouveau;
  insert into public.admin_audit (admin_id, action, detail)
  values (auth.uid(), 'code_promo_cree', jsonb_build_object('code', upper(trim(p_code)), 'remise_pct', p_remise_pct));
  return nouveau;
end;
$$;
revoke all on function public.admin_code_promo_creer(text, integer, text, integer, text, integer, timestamptz, text) from public, anon;
grant execute on function public.admin_code_promo_creer(text, integer, text, integer, text, integer, timestamptz, text) to authenticated;

-- Activer ou couper un code (les abonnements qui l'ont déjà gardent leur remise).
create or replace function public.admin_code_promo_actif(p_id bigint, p_actif boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();
  update public.codes_promo set actif = p_actif where id = p_id;
end;
$$;
revoke all on function public.admin_code_promo_actif(bigint, boolean) from public, anon;
grant execute on function public.admin_code_promo_actif(bigint, boolean) to authenticated;

-- Sa cotisation, avec la remise en cours : prix normal et échéances remisées qui restent (null : toutes).
create or replace function public.mon_abonnement()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'actif', public.michelia_plus(a.user_id),
    'source', a.source,
    'formule', a.formule,
    'moyen', a.moyen,
    'statut', a.statut,
    'prix_cents', a.prix_cents,
    'fin_periode', a.fin_periode,
    'derniers_chiffres', a.derniers_chiffres,
    'remise_pct', case when a.prix_plein_cents is not null and a.prix_cents < a.prix_plein_cents then a.remise_pct end,
    'prix_plein_cents', case when a.prix_plein_cents is not null and a.prix_cents < a.prix_plein_cents then a.prix_plein_cents end,
    'remise_restante', case when a.prix_plein_cents is not null and a.prix_cents < a.prix_plein_cents and a.remise_periodes is not null
      then greatest(0, a.remise_periodes - (select count(*) from public.abonnement_echeances e where e.abonnement_id = a.id and e.statut = 'paye'))::integer end
  )
  from public.abonnements a
  where a.user_id = auth.uid()
    and a.statut in ('actif', 'impaye', 'resilie')
  order by a.created_at desc
  limit 1;
$$;

revoke all on function public.mon_abonnement() from public, anon;
grant execute on function public.mon_abonnement() to authenticated;

-- Alerte de renouvellement (migration 20261030160000_alertes.sql) : pas pour une période offerte à 0 €,
-- qui reviendrait chaque mois sans rien d'encaissé.
create or replace function public.alerte_echeance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.abonnements%rowtype;
begin
  if new.essai or new.statut <> 'paye' or new.montant_cents = 0 or (tg_op = 'UPDATE' and old.statut = 'paye') then
    return new;
  end if;
  if not exists (
    select 1 from public.abonnement_echeances e
    where e.abonnement_id = new.abonnement_id and e.id < new.id and e.statut = 'paye'
  ) then
    return new;
  end if;
  select * into a from public.abonnements where id = new.abonnement_id;
  perform public.deposer_alerte('renouvellement', jsonb_build_object(
    'id', a.id,
    'source', a.source,
    'formule', a.formule,
    'moyen', a.moyen,
    'montant_cents', new.montant_cents,
    'periode_fin', new.periode_fin,
    'prenom', (select first_name from public.profiles where id = a.user_id)
  ));
  return new;
exception when others then
  return new;
end;
$$;
