-- Remarques de revue restées ouvertes (MichelIA+, causettes, facturation). Rejouable sans risque.

-- 1. MichelIA+ : une échéance payée et son abonnement passent ensemble, dans une seule transaction.
-- La résiliation est relue dans la même mise à jour (verrou de ligne) : une résiliation demandée
-- pendant le paiement n'est jamais écrasée par « actif ». Renvoie false si l'échéance n'était plus
-- en cours (une autre confirmation est passée avant). Une erreur annule tout : l'échéance reste en
-- cours et le cron la relit.
create or replace function public.payer_echeance(
  p_echeance bigint,
  p_paiement text default null,
  p_carte text default null,
  p_sepa text default null,
  p_chiffres text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_abonnement bigint;
  v_fin timestamptz;
begin
  update public.abonnement_echeances
  set statut = 'paye', paiement_id = coalesce(p_paiement, paiement_id)
  where id = p_echeance and statut = 'en_cours'
  returning abonnement_id, periode_fin into v_abonnement, v_fin;
  if not found then
    return false;
  end if;
  update public.abonnements
  set statut = case when statut = 'resilie' then 'resilie' else 'actif' end,
      fin_periode = greatest(fin_periode, v_fin),
      echecs = 0,
      prochain_essai = null,
      stancer_carte = coalesce(p_carte, stancer_carte),
      stancer_sepa = coalesce(p_sepa, stancer_sepa),
      derniers_chiffres = coalesce(p_chiffres, derniers_chiffres),
      updated_at = now()
  where id = v_abonnement;
  return true;
end;
$$;

revoke all on function public.payer_echeance(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.payer_echeance(bigint, text, text, text, text) to service_role;

-- 2. MichelIA+ des boutiques : heure du dernier événement RevenueCat appliqué. Un événement plus
-- ancien qui arrive en retard (EXPIRATION après RENEWAL) ne change plus le statut.
alter table public.abonnements add column if not exists store_evenement_le timestamptz;

-- 3. Causettes : les créations du jour sont comptées à part des liens, qu'on peut retirer.
create table if not exists public.causettes_creations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists causettes_creations_user_idx on public.causettes_creations (user_id, created_at desc);
alter table public.causettes_creations enable row level security;
revoke all on public.causettes_creations from anon, authenticated;
-- Les liens encore en ligne, créés dans la journée, comptent déjà.
insert into public.causettes_creations (user_id, created_at)
select c.user_id, c.created_at from public.causettes c
where c.user_id is not null and c.created_at > now() - interval '1 day'
  and not exists (select 1 from public.causettes_creations)
order by c.created_at;

create or replace function public.partager_causette(p_messages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  par_jour integer := coalesce((select value::integer from public.app_config where key = 'causettes_par_jour'), 20);
  propres jsonb;
  nouvel_id text;
begin
  if uid is null then
    return jsonb_build_object('erreur', 'connexion');
  end if;
  if p_messages is null or jsonb_typeof(p_messages) <> 'array'
     or jsonb_array_length(p_messages) not between 1 and 60 then
    return jsonb_build_object('erreur', 'invalide');
  end if;

  -- On ne garde que le rôle et le texte, et on refuse tout le reste (photos comprises).
  select jsonb_agg(jsonb_build_object('role', m->>'role', 'content', m->>'content') order by i)
  into propres
  from jsonb_array_elements(p_messages) with ordinality as t(m, i)
  where jsonb_typeof(m) = 'object'
    and m->>'role' in ('user', 'assistant')
    and jsonb_typeof(m->'content') = 'string'
    and char_length(btrim(m->>'content')) between 1 and 8000;

  if propres is null or jsonb_array_length(propres) <> jsonb_array_length(p_messages)
     or not exists (select 1 from jsonb_array_elements(propres) m where m->>'role' = 'assistant')
     or char_length(propres::text) > 80000 then
    return jsonb_build_object('erreur', 'invalide');
  end if;

  perform pg_advisory_xact_lock(hashtext('causette:' || uid::text));
  -- Compté à part : retirer un lien ne rend pas le droit d'en créer un autre le même jour.
  if (select count(*) from public.causettes_creations c
      where c.user_id = uid and c.created_at > now() - interval '1 day') >= par_jour then
    return jsonb_build_object('erreur', 'quota');
  end if;

  loop
    nouvel_id := translate(rtrim(encode(extensions.gen_random_bytes(8), 'base64'), '='), '+/', '-_');
    exit when not exists (select 1 from public.causettes c where c.id = nouvel_id);
  end loop;
  insert into public.causettes (id, user_id, messages) values (nouvel_id, uid, propres);
  insert into public.causettes_creations (user_id) values (uid);
  delete from public.causettes_creations c where c.created_at < now() - interval '1 day';

  -- Conservation : un an au plus (voir la politique de confidentialité).
  delete from public.causettes c where c.created_at < now() - interval '1 year';
  return jsonb_build_object('id', nouvel_id);
end;
$$;

-- Les liens partagés, 50 par page, du plus récent au plus ancien : p_avant = date du dernier lien lu.
drop function if exists public.mes_causettes();
create or replace function public.mes_causettes(p_avant timestamptz default null)
returns table (id text, created_at timestamptz, apercu text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.created_at,
    left((select m->>'content' from jsonb_array_elements(c.messages) m limit 1), 80)
  from public.causettes c
  where c.user_id = (select auth.uid())
    and (p_avant is null or c.created_at < p_avant)
  order by c.created_at desc
  limit 50;
$$;

revoke all on function public.mes_causettes(timestamptz) from public, anon;
grant execute on function public.mes_causettes(timestamptz) to authenticated;

-- 4. Facturation : les pourboires bloqués en attendant leur paiement Stancer (paym_) ne consomment
-- plus d'essais ; ceux qui les ont déjà tous perdus pour cette raison repartent.
update public.pourboires
set facture_tentatives = 0, facture_erreur = null
where facture_reglee_at is null
  and paiement_carte is null
  and facture_erreur like 'paiement Stancer (paym_) pas encore connu%';
