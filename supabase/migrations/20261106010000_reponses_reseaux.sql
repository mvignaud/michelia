-- Michel répond aux commentaires Facebook et Instagram (fonction Edge « reseaux », toutes les 10 minutes).
-- Chaque commentaire vu est gardé ici, une seule fois : ce que Michel a répondu, ou pourquoi il s'est tu.
-- Rien ne part tant que le secret META_PAGE_TOKEN n'est pas posé (mode d'emploi : docs/REPONSES-RESEAUX.md).
-- Réglages dans app_config : reseaux_reponses_actif ('false' coupe tout), reseaux_facebook et
-- reseaux_instagram ('false' coupe un réseau), reseaux_fenetre_heures, reseaux_max_passage,
-- reseaux_max_auteur_jour, et reseaux_consigne (facultatif, remplace la consigne écrite dans la fonction).
-- Rejouable sans risque.

-- 1. Le journal des commentaires.
create table if not exists public.reponses_reseaux (
  id bigint generated always as identity primary key,
  reseau text not null check (reseau in ('facebook', 'instagram')),
  commentaire_id text not null unique,
  publication_id text,
  auteur_id text,
  auteur text,
  commentaire text,
  commente_at timestamptz,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'repondu', 'silence', 'mathieu', 'echec')),
  reponse text,
  reponse_id text,
  raison text,
  created_at timestamptz not null default now(),
  traite_at timestamptz
);

create index if not exists reponses_reseaux_auteur_idx on public.reponses_reseaux (reseau, auteur_id, traite_at);

-- Aucune policy : seule la fonction reseaux (service_role) y touche.
alter table public.reponses_reseaux enable row level security;
revoke all on public.reponses_reseaux from anon, authenticated;

-- 2. Un nouveau genre d'alerte pour Mathieu : jeton Meta cassé, ou commentaire à traiter à la main.
alter table public.alertes drop constraint if exists alertes_genre_check;
alter table public.alertes add constraint alertes_genre_check check (genre in (
  'doleance', 'note_basse', 'inscription', 'depart', 'pourboire', 'remboursement',
  'abonnement', 'renouvellement', 'impaye', 'reprise', 'resiliation', 'fin_abonnement',
  'reseaux'
));

-- 3. Réglages : allumé (choix de Mathieu le 6/11 : « automatique tout de suite »).
insert into public.app_config (key, value) values
  ('reseaux_reponses_actif', 'true'),
  ('reseaux_facebook', 'true'),
  ('reseaux_instagram', 'true'),
  ('reseaux_fenetre_heures', '72'),
  ('reseaux_max_passage', '10'),
  ('reseaux_max_auteur_jour', '3')
on conflict (key) do nothing;

-- 4. Toutes les 10 minutes.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('reponses-reseaux') where exists (select 1 from cron.job where jobname = 'reponses-reseaux');
select cron.schedule(
  'reponses-reseaux',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/reseaux',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);
