-- Refus d'E-KO sur un avoir (422 : remboursement inconnu chez le prestataire, facture pas émise, règlement
-- introuvable) : la fonction facturer le note et ne réessaie plus. Vider eko_erreur pour relancer.
-- Rejouable sans risque.
alter table public.avoirs add column if not exists eko_erreur text;
