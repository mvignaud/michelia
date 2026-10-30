-- « Mes reçus » dans l'espace compte, et avoirs de remboursement de Michel.
-- Chaque pourboire web garde le compte qui l'a payé (copié de comptoir_attente, que le ménage vide au
-- bout de 3 jours). Le compte retrouve ses reçus par mes_recus() : ceux payés connecté, plus ceux payés
-- avec son adresse e-mail confirmée (les tout premiers, payés sans session, ou depuis un autre compte).
-- Les remboursements sont relevés chez Stancer (rembourse_cents, rembourse_le : migration
-- 20261030050000_remboursements.sql) ; pour la part pas encore couverte (rembourse_avoir_cents), la
-- fonction facturer tire un avoir de Michel (A2026-000001) et l'envoie au client avec l'e-mail de remboursement.
-- Rejouable sans risque.

alter table public.pourboires add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists pourboires_user_idx on public.pourboires (user_id, created_at desc);

-- Mêmes définitions que la migration des remboursements Stancer : sans effet si elle est déjà passée.
alter table public.pourboires add column if not exists rembourse_cents integer not null default 0;
alter table public.pourboires add column if not exists rembourse_le timestamptz;
alter table public.pourboires add column if not exists rembourse_avoir_cents integer not null default 0;

-- Avoirs de remboursement de Michel, adressés au client : leur propre série, sans trou volontaire.
create sequence if not exists public.avoir_numero_seq;

create or replace function public.prochain_numero_avoir()
returns text
language sql
security definer
set search_path = public
as $$
  select 'A' || to_char(now() at time zone 'Europe/Paris', 'YYYY') || '-' || lpad(nextval('public.avoir_numero_seq')::text, 6, '0');
$$;

revoke all on function public.prochain_numero_avoir() from public, anon, authenticated;

create table if not exists public.avoirs (
  id bigint generated always as identity primary key,
  numero text not null unique default public.prochain_numero_avoir(),
  pourboire_id bigint not null references public.pourboires (id),
  montant_cents integer not null check (montant_cents > 0),
  rembourse_le timestamptz not null,
  envoye_at timestamptz,
  envoi_reserve_at timestamptz,
  envoi_erreur text,
  envoi_tentatives integer not null default 0,
  -- Avoir E-KO correspondant, quand l'API d'E-KO saura en créer.
  eko_code text,
  created_at timestamptz not null default now()
);

create index if not exists avoirs_pourboire_idx on public.avoirs (pourboire_id);

-- Aucune policy : seule la fonction facturer (service_role) y écrit ; le compte les lit par mes_recus().
alter table public.avoirs enable row level security;
revoke all on public.avoirs from anon, authenticated;

-- Tire d'un seul coup (une transaction) un avoir pour chaque part remboursée pas encore couverte, et
-- avance rembourse_avoir_cents : jamais d'avoir en double ni de part oubliée. Un remboursement partiel
-- puis le reste font deux avoirs ; le premier porte la date du remboursement, les suivants la date du
-- relevé. Jamais les paiements d'essai ni les achats des applis. Appelée par la fonction facturer.
create or replace function public.tirer_avoirs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with parts as (
    update public.pourboires p
    set rembourse_avoir_cents = p.rembourse_cents
    from (
      select id, rembourse_avoir_cents as deja from public.pourboires
      where rembourse_cents > rembourse_avoir_cents and rembourse_le is not null
        and canal = 'web' and not essai and email is not null
      for update
    ) a
    where p.id = a.id
    returning p.id, p.rembourse_cents - a.deja as montant,
      case when a.deja = 0 then p.rembourse_le else now() end as le
  )
  insert into public.avoirs (pourboire_id, montant_cents, rembourse_le)
  select id, montant, le from parts order by le, id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.tirer_avoirs() from public, anon, authenticated;
grant execute on function public.tirer_avoirs() to service_role;

-- Le compte du payeur, pris dans le paiement en attente au moment où le pourboire est écrit.
create or replace function public.pourboire_compte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.paiement_id is not null then
    select a.user_id into new.user_id from public.comptoir_attente a where a.paiement_id = new.paiement_id;
  end if;
  return new;
end;
$$;

revoke all on function public.pourboire_compte() from public, anon, authenticated;

drop trigger if exists pourboire_compte on public.pourboires;
create trigger pourboire_compte before insert on public.pourboires
  for each row execute function public.pourboire_compte();

-- Les pourboires déjà payés dont le paiement en attente est encore là.
update public.pourboires p set user_id = a.user_id
from public.comptoir_attente a
where p.user_id is null and a.paiement_id = p.paiement_id and a.user_id is not null;

-- Les reçus et avoirs du compte connecté, du plus récent au plus ancien. Jamais les paiements d'essai.
create or replace function public.mes_recus()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with moi as (
    select u.id, lower(u.email) as email from auth.users u
    where u.id = auth.uid()
  ), paliers as (
    select p ->> 'id' as id, p ->> 'nom' as nom
    from jsonb_array_elements(coalesce((select value::jsonb from public.app_config where key = 'comptoir_paliers'), '[]'::jsonb)) p
  ), recus as (
    select t.id, t.numero_recu, t.created_at, t.montant_cents, t.rembourse_cents,
      'Pourboire MichelIA : ' || coalesce(pa.nom, t.palier) as libelle
    from public.pourboires t
    join moi on t.user_id = moi.id
      or (moi.email is not null and lower(t.email) = moi.email
          and exists (select 1 from auth.users u where u.id = moi.id and u.email_confirmed_at is not null))
    left join paliers pa on pa.id = t.palier
    where t.canal = 'web' and not t.essai and t.numero_recu is not null
  ), pieces as (
    select r.numero_recu as numero, r.created_at as date, 'pourboire' as genre, r.libelle,
      r.montant_cents, r.rembourse_cents, null::text as recu
    from recus r
    union all
    select a.numero, a.rembourse_le, 'avoir', 'Remboursement : ' || r.libelle,
      a.montant_cents, 0, r.numero_recu
    from public.avoirs a join recus r on r.id = a.pourboire_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'numero', p.numero,
    'date', p.date,
    'genre', p.genre,
    'libelle', p.libelle,
    'montant_cents', p.montant_cents,
    'rembourse_cents', p.rembourse_cents,
    'recu', p.recu
  ) order by p.date desc), '[]'::jsonb)
  from pieces p;
$$;

revoke all on function public.mes_recus() from public, anon;
grant execute on function public.mes_recus() to authenticated;
