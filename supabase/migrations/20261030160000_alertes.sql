-- Les alertes pour Mathieu : chaque événement qui compte (idée ou bug dans le cahier de doléances,
-- réponse mal notée, nouveau compte, compte supprimé, pourboire, remboursement, abonnement MichelIA+
-- pris, renouvelé, impayé, résilié ou terminé) dépose une ligne dans public.alertes, par trigger.
-- Toutes les 5 minutes, la fonction Edge « alertes » les envoie par e-mail à contact@michel.beer
-- (app_config alertes_destinataire), une par une, ou en un seul récapitulatif s'il y en a beaucoup.
-- Un trigger d'alerte ne fait jamais échouer l'écriture qu'il observe. Les paiements d'essai sont ignorés.
-- Réglages : alertes_actives ('false' coupe tout), alertes_muettes (liste JSON de genres à taire).
-- Rejouable sans risque.

create table if not exists public.alertes (
  id bigint generated always as identity primary key,
  genre text not null check (genre in (
    'doleance', 'note_basse', 'inscription', 'depart', 'pourboire', 'remboursement',
    'abonnement', 'renouvellement', 'impaye', 'reprise', 'resiliation', 'fin_abonnement'
  )),
  donnees jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  envoyee_at timestamptz,
  reservee_at timestamptz,
  tentatives integer not null default 0,
  erreur text
);

create index if not exists alertes_a_envoyer_idx on public.alertes (id) where envoyee_at is null;

-- Aucune policy : seuls les triggers et la fonction alertes (service_role) y touchent.
alter table public.alertes enable row level security;
revoke all on public.alertes from anon, authenticated;

insert into public.app_config (key, value) values
  ('alertes_actives', 'true'),
  ('alertes_destinataire', 'contact@michel.beer'),
  ('alertes_muettes', '[]')
on conflict (key) do nothing;

-- Dépose une alerte, sauf si les alertes sont coupées ou ce genre est tu. Ne lève jamais d'erreur.
create or replace function public.deposer_alerte(p_genre text, p_donnees jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actives text;
  v_muettes jsonb;
begin
  select value into v_actives from public.app_config where key = 'alertes_actives';
  if coalesce(v_actives, 'true') <> 'true' then
    return;
  end if;
  begin
    select value::jsonb into v_muettes from public.app_config where key = 'alertes_muettes';
  exception when others then
    v_muettes := '[]'::jsonb;
  end;
  if jsonb_typeof(v_muettes) = 'array' and v_muettes ? p_genre then
    return;
  end if;
  insert into public.alertes (genre, donnees) values (p_genre, coalesce(p_donnees, '{}'::jsonb));
exception when others then
  raise warning 'alerte % non déposée : %', p_genre, sqlerrm;
end;
$$;

revoke all on function public.deposer_alerte(text, jsonb) from public, anon, authenticated;

-- Cahier de doléances : chaque idée, bug ou râlerie déposé.
create or replace function public.alerte_doleance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.deposer_alerte('doleance', jsonb_build_object(
    'id', new.id,
    'categorie', new.categorie,
    'texte', new.texte,
    'contact', new.contact,
    'compte', new.user_id is not null and exists (
      select 1 from auth.users u where u.id = new.user_id and not coalesce(u.is_anonymous, false)
    )
  ));
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists alerte_doleance on public.doleances;
create trigger alerte_doleance
  after insert on public.doleances
  for each row execute function public.alerte_doleance();

-- Étoiles : une réponse notée 1 ou 2 (ou qui y redescend).
create or replace function public.alerte_note_basse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.note <= 2 and (tg_op = 'INSERT' or old.note > 2) then
    perform public.deposer_alerte('note_basse', jsonb_build_object(
      'id', new.id,
      'note', new.note,
      'mode', new.mode,
      'question', left(new.question, 500),
      'reponse', left(new.reponse, 1200)
    ));
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists alerte_note_basse on public.notes_reponses;
create trigger alerte_note_basse
  after insert or update of note on public.notes_reponses
  for each row execute function public.alerte_note_basse();

-- Comptes : un profil naît avec chaque vrai compte (jamais les sessions anonymes) et part avec lui.
create or replace function public.alerte_compte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_fournisseur text;
begin
  if tg_op = 'INSERT' then
    select u.email, u.raw_app_meta_data ->> 'provider' into v_email, v_fournisseur
    from auth.users u where u.id = new.id;
    perform public.deposer_alerte('inscription', jsonb_build_object(
      'prenom', new.first_name,
      'nom', new.last_name,
      'annee', new.birth_year,
      'email', v_email,
      'fournisseur', v_fournisseur,
      'total', (select count(*) from public.profiles)
    ));
    return new;
  end if;
  perform public.deposer_alerte('depart', jsonb_build_object(
    'prenom', old.first_name,
    'inscrit_le', old.created_at,
    'total', (select count(*) from public.profiles)
  ));
  return old;
exception when others then
  return coalesce(new, old);
end;
$$;

drop trigger if exists alerte_compte on public.profiles;
create trigger alerte_compte
  after insert or delete on public.profiles
  for each row execute function public.alerte_compte();

-- Pourboires : chaque pourboire payé (site ou applis), puis chaque remboursement constaté.
create or replace function public.alerte_pourboire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.essai then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.deposer_alerte('pourboire', jsonb_build_object(
      'id', new.id,
      'montant_cents', new.montant_cents,
      'palier', new.palier,
      'prenom', new.prenom,
      'canal', new.canal,
      'prestataire', new.prestataire,
      'mois_nombre', (
        select count(*) from public.pourboires
        where not essai and created_at >= date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
      ),
      'mois_cents', (
        select coalesce(sum(montant_cents - rembourse_cents), 0) from public.pourboires
        where not essai and created_at >= date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
      )
    ));
  elsif new.rembourse_cents > old.rembourse_cents then
    perform public.deposer_alerte('remboursement', jsonb_build_object(
      'id', new.id,
      'montant_cents', new.montant_cents,
      'rembourse_cents', new.rembourse_cents - old.rembourse_cents,
      'total_rembourse_cents', new.rembourse_cents,
      'prenom', new.prenom,
      'numero_recu', new.numero_recu
    ));
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists alerte_pourboire on public.pourboires;
create trigger alerte_pourboire
  after insert or update of rembourse_cents on public.pourboires
  for each row execute function public.alerte_pourboire();

-- MichelIA+ : chaque changement de statut qui compte, par le site (Stancer) ou les applis (RevenueCat).
create or replace function public.alerte_abonnement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avant text := case when tg_op = 'UPDATE' then old.statut end;
  v_genre text;
begin
  if new.essai or new.statut is not distinct from v_avant then
    return new;
  end if;
  v_genre := case
    when new.statut = 'actif' and v_avant = 'impaye' then 'reprise'
    when new.statut = 'actif' and v_avant = 'resilie' then 'reprise'
    when new.statut = 'actif' then 'abonnement'
    when new.statut = 'impaye' then 'impaye'
    when new.statut = 'resilie' then 'resiliation'
    -- Un premier paiement jamais passé n'était pas un abonnement : rien à dire.
    when new.statut = 'expire' and v_avant in ('actif', 'impaye', 'resilie') then 'fin_abonnement'
  end;
  if v_genre is null then
    return new;
  end if;
  perform public.deposer_alerte(v_genre, jsonb_build_object(
    'id', new.id,
    'source', new.source,
    'formule', new.formule,
    'moyen', new.moyen,
    'prix_cents', new.prix_cents,
    'fin_periode', new.fin_periode,
    'echecs', new.echecs,
    'email', new.email,
    'prenom', (select first_name from public.profiles where id = new.user_id),
    'actifs', (select count(*) from public.abonnements where statut in ('actif', 'impaye', 'resilie') and not essai)
  ));
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists alerte_abonnement on public.abonnements;
create trigger alerte_abonnement
  after insert or update of statut on public.abonnements
  for each row execute function public.alerte_abonnement();

-- MichelIA+ : chaque échéance payée après la première (la première est déjà l'alerte « abonnement »).
create or replace function public.alerte_echeance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.abonnements%rowtype;
begin
  if new.essai or new.statut <> 'paye' or (tg_op = 'UPDATE' and old.statut = 'paye') then
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

drop trigger if exists alerte_echeance on public.abonnement_echeances;
create trigger alerte_echeance
  after insert or update of statut on public.abonnement_echeances
  for each row execute function public.alerte_echeance();

revoke all on function public.alerte_doleance() from public, anon, authenticated;
revoke all on function public.alerte_note_basse() from public, anon, authenticated;
revoke all on function public.alerte_compte() from public, anon, authenticated;
revoke all on function public.alerte_pourboire() from public, anon, authenticated;
revoke all on function public.alerte_abonnement() from public, anon, authenticated;
revoke all on function public.alerte_echeance() from public, anon, authenticated;

-- Pour la fonction alertes : réserve d'un coup les alertes à envoyer (jamais deux passages sur la même),
-- en reprenant celles d'un passage coupé en route. Cinq essais au plus par alerte.
create or replace function public.reserver_alertes(p_limite integer default 50)
returns setof public.alertes
language sql
security definer
set search_path = public
as $$
  update public.alertes a
  set reservee_at = now(), tentatives = a.tentatives + 1
  where a.id in (
    select id from public.alertes
    where envoyee_at is null
      and tentatives < 5
      and (reservee_at is null or reservee_at < now() - interval '10 minutes')
    order by id
    limit greatest(1, least(p_limite, 200))
    for update skip locked
  )
  returning a.*;
$$;

revoke all on function public.reserver_alertes(integer) from public, anon, authenticated;
grant execute on function public.reserver_alertes(integer) to service_role;

select cron.unschedule('alertes-mathieu') where exists (select 1 from cron.job where jobname = 'alertes-mathieu');
select cron.schedule(
  'alertes-mathieu',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/alertes',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
