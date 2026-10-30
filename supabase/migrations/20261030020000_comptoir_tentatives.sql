-- Formulaire de carte maison du comptoir (Stancer « full API ») : garde-fous contre les robots qui
-- testent des cartes volées et contre les rafales de paiements ouverts. Aucune donnée de carte ici :
-- seulement qui a essayé, d'où (adresse IP), quand, et pour quel paiement.
-- comptoir_reserver() compte et inscrit l'essai d'un seul coup, sous verrou : des requêtes lancées en
-- parallèle ne passent pas entre les gouttes. Appelée seulement par les fonctions (service_role).
-- Rejouable sans risque.

create table if not exists public.comptoir_tentatives (
  id bigint generated always as identity primary key,
  genre text not null default 'carte' check (genre in ('carte', 'paiement')),
  user_id uuid not null,
  ip text,
  paiement_id text,
  created_at timestamptz not null default now()
);
alter table public.comptoir_tentatives add column if not exists genre text not null default 'carte';
alter table public.comptoir_tentatives add column if not exists ip text;
create index if not exists comptoir_tentatives_recent_idx on public.comptoir_tentatives (genre, created_at desc);
create index if not exists comptoir_tentatives_user_idx on public.comptoir_tentatives (user_id, created_at desc);
create index if not exists comptoir_tentatives_ip_idx on public.comptoir_tentatives (ip, created_at desc);
create index if not exists comptoir_tentatives_paiement_idx on public.comptoir_tentatives (paiement_id);
alter table public.comptoir_tentatives enable row level security;
revoke all on public.comptoir_tentatives from anon, authenticated;

-- Le paiement en attente appartient au visiteur qui l'a ouvert : lui seul peut y mettre une carte.
alter table public.comptoir_attente add column if not exists user_id uuid;

insert into public.app_config (key, value) values
  -- Plafond d'essais de carte par heure pour tout le comptoir (au-delà : refus, et alerte dans les journaux).
  ('comptoir_essais_heure', '30')
on conflict (key) do nothing;

-- Renvoie 'ok' (et inscrit l'essai) ou la raison du refus : 'visiteur', 'ip', 'paiement' ou 'global'.
create or replace function public.comptoir_reserver(p_genre text, p_user uuid, p_ip text, p_paiement text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  heure timestamptz := now() - interval '1 hour';
  n integer;
  max_user integer := case when p_genre = 'carte' then 5 else 10 end;
  max_ip integer := case when p_genre = 'carte' then 5 else 20 end;
  max_global integer := case when p_genre = 'carte'
    then coalesce((select value::integer from public.app_config where key = 'comptoir_essais_heure'), 30)
    else 300 end;
begin
  if p_genre not in ('carte', 'paiement') or p_user is null then
    return 'visiteur';
  end if;
  perform pg_advisory_xact_lock(hashtext('comptoir_reserver_' || p_genre));

  select count(*) into n from public.comptoir_tentatives where genre = p_genre and user_id = p_user and created_at > heure;
  if n >= max_user then return 'visiteur'; end if;
  if p_ip is not null and p_ip <> '' then
    select count(*) into n from public.comptoir_tentatives where genre = p_genre and ip = p_ip and created_at > heure;
    if n >= max_ip then return 'ip'; end if;
  end if;
  -- Deux cartes au plus par paiement : au-delà, il faut en rouvrir un (et ça compte aussi).
  if p_genre = 'carte' then
    select count(*) into n from public.comptoir_tentatives where genre = 'carte' and paiement_id = p_paiement;
    if n >= 2 then return 'paiement'; end if;
  end if;
  select count(*) into n from public.comptoir_tentatives where genre = p_genre and created_at > heure;
  if n >= max_global then return 'global'; end if;

  insert into public.comptoir_tentatives (genre, user_id, ip, paiement_id) values (p_genre, p_user, nullif(p_ip, ''), p_paiement);

  -- Ménage au passage : essais de plus de 30 jours, paiements jamais payés de plus de 3 jours.
  if p_genre = 'paiement' then
    delete from public.comptoir_tentatives where created_at < now() - interval '30 days';
    delete from public.comptoir_attente a where a.created_at < now() - interval '3 days';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.comptoir_reserver(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.comptoir_reserver(text, uuid, text, text) to service_role;

-- Tableau de bord : les paiements d'essai ne comptent pas dans « Pourboires du mois ».
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
      'nombre', (select count(*) from public.pourboires where created_at >= start_month::timestamp at time zone 'Europe/Paris' and not essai),
      'total_eur', coalesce((
        select sum(montant_cents) / 100.0 from public.pourboires
        where created_at >= start_month::timestamp at time zone 'Europe/Paris' and not essai
      ), 0)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_cout_par_actif() from public, anon;
grant execute on function public.admin_cout_par_actif() to authenticated;
