-- Durcissement (audit sécurité du 30/10) : rien ne change pour les gens.
-- create_profile est une fonction de déclencheur : personne n'a à l'appeler par /rest/v1/rpc
-- (le droit EXECUTE n'est vérifié qu'à la création du déclencheur, pas quand il se déclenche).
revoke all on function public.create_profile() from public, anon, authenticated;
-- search_path fixé, comme les autres fonctions (alerte « Function Search Path Mutable »).
alter function public.stamp_news_opt_in() set search_path = public;
