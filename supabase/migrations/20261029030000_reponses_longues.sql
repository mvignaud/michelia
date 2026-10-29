-- Les recettes et les explications dépassaient 1024 jetons et s'arrêtaient net.
-- 2048 jetons coûtent au plus 0,001 $ de plus par réponse avec Claude Haiku 5.5.
update public.app_config
set value = '2048', updated_at = now()
where key = 'max_output_tokens' and value = '1024';
