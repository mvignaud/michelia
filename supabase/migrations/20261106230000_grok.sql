-- Grok pour l'ultra-hard des abonnés MichelIA+ (06/11/2026) : réglages et calcul du coût.
-- À coller tel quel dans le SQL Editor de Supabase. Rejouable sans risque. Tout passe ou rien ne passe.

begin;

-- 1. Jetons Grok comptés à part, par compte et par jour, et au total du jour.
alter table public.usage_daily
  add column if not exists grok_input_tokens bigint not null default 0,
  add column if not exists grok_output_tokens bigint not null default 0;
alter table public.usage_global
  add column if not exists grok_input_tokens bigint not null default 0,
  add column if not exists grok_output_tokens bigint not null default 0;

-- 2. Réglages : Grok coupé tant que grok_actif ne vaut pas true. Tarifs xAI en dollars par million de jetons.
insert into public.app_config (key, value) values
  ('grok_actif', 'false'),
  ('grok_model', 'grok-4.20-0309-non-reasoning'),
  ('price_grok_input_mtok', '1.25'),
  ('price_grok_output_mtok', '2.50')
on conflict (key) do nothing;

-- 3. Coût en dollars d'un lot de jetons Grok.
create or replace function public.grok_cost(p_input bigint, p_output bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(p_input, 0) * coalesce((select value::numeric from public.app_config where key = 'price_grok_input_mtok'), 0)
    + coalesce(p_output, 0) * coalesce((select value::numeric from public.app_config where key = 'price_grok_output_mtok'), 0)
  ) / 1000000;
$$;
revoke all on function public.grok_cost(bigint, bigint) from public, anon;
grant execute on function public.grok_cost(bigint, bigint) to authenticated, service_role;

-- 4. La fonction chat enregistre les jetons Grok de chaque réponse.
create or replace function public.record_grok_tokens(p_user uuid, p_input bigint, p_output bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  i bigint := greatest(coalesce(p_input, 0), 0);
  o bigint := greatest(coalesce(p_output, 0), 0);
begin
  insert into public.usage_daily as u (user_id, day, grok_input_tokens, grok_output_tokens)
  values (p_user, today, i, o)
  on conflict (user_id, day) do update set
    grok_input_tokens = u.grok_input_tokens + i,
    grok_output_tokens = u.grok_output_tokens + o;
  insert into public.usage_global as g (day, grok_input_tokens, grok_output_tokens)
  values (today, i, o)
  on conflict (day) do update set
    grok_input_tokens = g.grok_input_tokens + i,
    grok_output_tokens = g.grok_output_tokens + o;
end;
$$;
revoke all on function public.record_grok_tokens(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_grok_tokens(uuid, bigint, bigint) to service_role;

-- 5. Les calculs de coût du back-office (et du comptoir) ajoutent le coût Grok au coût Claude.
--    Chaque appel token_cost(...) devient (token_cost(...) + grok_cost(...)), dans ces 5 fonctions.
do $$
declare
  f record;
  def text;
  neu text;
  avant int;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public'
      and p.proname in ('admin_costs', 'admin_cout_par_actif', 'admin_user_usage', 'admin_users', 'comptoir_public')
  loop
    def := pg_get_functiondef(f.oid);
    continue when position('grok_cost' in def) > 0;  -- déjà fait
    avant := (length(def) - length(replace(def, 'token_cost(', ''))) / length('token_cost(');
    neu := regexp_replace(
      def,
      '(public\.)?token_cost\((\w+\.)?input_tokens, (\w+\.)?output_tokens, (\w+\.)?cache_read_tokens, (\w+\.)?cache_write_tokens\)',
      '(public.token_cost(\2input_tokens, \2output_tokens, \2cache_read_tokens, \2cache_write_tokens) + public.grok_cost(\2grok_input_tokens, \2grok_output_tokens))',
      'g'
    );
    if (length(neu) - length(replace(neu, 'grok_cost(', ''))) / length('grok_cost(') <> avant then
      raise exception 'Fonction % : appel de coût inattendu, rien n''a été modifié', f.proname;
    end if;
    execute neu;
  end loop;
end $$;

commit;

-- Vérification : doit afficher 5 lignes, toutes à true
select p.proname, p.prosrc like '%grok_cost%' as grok
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public'
  and p.proname in ('admin_costs', 'admin_cout_par_actif', 'admin_user_usage', 'admin_users', 'comptoir_public')
order by 1;
