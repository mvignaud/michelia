-- Webhook Stancer : Stancer n'a pas de rubrique Webhooks dans son espace client, l'adresse s'enregistre
-- par son API (POST /v2/webhooks/), qui renvoie un secret de signature. La fonction « comptoir-paiement »
-- le fait toute seule au premier paiement (une fois en test, une fois en réel) et range le secret ici ;
-- « stancer-webhook » le relit pour vérifier Stancer-Signature. Personne n'a à le copier.
-- Seules les fonctions (service_role) y accèdent. Rejouable sans risque.

create table if not exists public.stancer_webhook (
  mode text primary key check (mode in ('test', 'prod')),
  webhook_id text,
  secret text,
  created_at timestamptz not null default now()
);
alter table public.stancer_webhook enable row level security;
revoke all on public.stancer_webhook from anon, authenticated;
