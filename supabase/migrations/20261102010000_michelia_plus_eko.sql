-- MichelIA+ dans E-KO : E-KO tient le contrat de chaque abonné du site, facture chaque période et la
-- prélève chez Stancer (carte card_… ou mandat sepa_… obtenus par Michel au premier paiement). Michel
-- garde le premier paiement (3D Secure, mandat signé par SMS) et suit E-KO par ses webhooks
-- (fonction eko-webhook). Voir docs/MICHELIA-PLUS.md, section « E-KO ».
-- Coupé tant que michelia_plus_eko_actif ne vaut pas 'true' : les abonnements restent alors prélevés par
-- Michel (michelia-plus-echeances), comme avant. Rejouable sans risque.

-- L'abonné dans E-KO : son tiers (CU…), son abonnement (SUB-…), la résiliation transmise, et la dernière
-- erreur (vider eko_erreur pour relancer).
alter table public.abonnements add column if not exists eko_tiers text;
alter table public.abonnements add column if not exists eko_abonnement text unique;
alter table public.abonnements add column if not exists eko_resilie_le timestamptz;
alter table public.abonnements add column if not exists eko_erreur text;
alter table public.abonnements add column if not exists eko_tentatives integer not null default 0;

-- Chaque période facturée par E-KO : son cycle et sa facture (FA…). Une période prélevée par E-KO porte
-- « eko:<cycle> » comme paiement tant que la transaction Stancer n'est pas connue.
alter table public.abonnement_echeances add column if not exists eko_cycle text unique;
alter table public.abonnement_echeances add column if not exists eko_facture text;
alter table public.abonnement_echeances add column if not exists eko_facture_id bigint;
alter table public.abonnement_echeances add column if not exists eko_regle_le timestamptz;

-- Les webhooks reçus d'E-KO, gardés tels quels : un même envoi (X-Subscriptions-Delivery-Id) n'est
-- traité qu'une fois, et un traitement raté est repris par le cron.
create table if not exists public.eko_evenements (
  livraison bigint primary key,
  evenement text not null,
  abonnement text,
  charge jsonb not null,
  recu_le timestamptz not null default now(),
  traite_le timestamptz,
  essais integer not null default 0,
  erreur text
);
create index if not exists eko_evenements_a_traiter_idx on public.eko_evenements (recu_le) where traite_le is null;
alter table public.eko_evenements enable row level security;
revoke all on public.eko_evenements from anon, authenticated;

insert into public.app_config (key, value) values
  -- 'true' : chaque nouvel abonné du site part dans E-KO, qui facture et prélève à la place de Michel.
  ('michelia_plus_eko_actif', 'false'),
  -- Seuls les abonnements pris à partir de cette date partent dans E-KO (les essais d'avant restent chez Michel).
  ('michelia_plus_eko_depuis', '2999-01-01T00:00:00Z'),
  -- Codes des plans créés dans l'écran d'E-KO.
  ('michelia_plus_eko_plans', '{"mois": "PLAN-MICHELIA-MOIS", "an": "PLAN-MICHELIA-AN"}')
on conflict (key) do nothing;
