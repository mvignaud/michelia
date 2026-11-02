-- Rappel explicite : la purge et le tirage du cache ne sont appelables que côté serveur.
-- Les droits posés à la création (20261029020000_purge.sql) tiennent déjà en base (vérifié
-- le 2/11/2026) ; ce fichier les redit pour qu'aucune réinstallation ne les oublie.
revoke all on function public.purge_old_data() from public, anon, authenticated;
grant execute on function public.purge_old_data() to service_role;
revoke all on function public.pick_cached_answer(extensions.vector, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.pick_cached_answer(extensions.vector, double precision, integer)
  to service_role;
