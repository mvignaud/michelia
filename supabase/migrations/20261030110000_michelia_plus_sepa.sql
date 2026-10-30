-- MichelIA+ par prélèvement SEPA sur le site. Le premier prélèvement passe par la page Stancer
-- (payment intent pi_…), où la personne signe le mandat par code SMS ; tant que le prélèvement (paym_…)
-- n'est pas connu, l'échéance porte le payment intent, gardé ensuite dans stancer_intent.
-- Rejouable sans risque.

alter table public.abonnement_echeances
  add column if not exists stancer_intent text unique
    check (stancer_intent is null or stancer_intent ~ '^pi_[A-Za-z0-9]{6,64}$');

-- Relecture des prélèvements SEPA encore rejetables (michelia-plus-echeances, toutes les heures).
create index if not exists abonnement_echeances_recentes_idx
  on public.abonnement_echeances (created_at) where statut = 'paye';
