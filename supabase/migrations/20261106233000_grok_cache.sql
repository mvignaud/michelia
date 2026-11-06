-- Grok moins cher (06/11/2026) : jetons en cache comptés au bon prix + prompt allégé pour Grok.
-- À coller tel quel dans le SQL Editor de Supabase. Rejouable sans risque. Tout passe ou rien ne passe.

begin;

-- 1. Jetons d'entrée servis depuis le cache de xAI, comptés à part (0,20 $ le million au lieu de 1,25 $).
alter table public.usage_daily add column if not exists grok_cache_tokens bigint not null default 0;
alter table public.usage_global add column if not exists grok_cache_tokens bigint not null default 0;
insert into public.app_config (key, value) values ('price_grok_cache_mtok', '0.20') on conflict (key) do nothing;

create or replace function public.grok_cost(p_input bigint, p_output bigint, p_cache bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(p_input, 0) * coalesce((select value::numeric from public.app_config where key = 'price_grok_input_mtok'), 0)
    + coalesce(p_output, 0) * coalesce((select value::numeric from public.app_config where key = 'price_grok_output_mtok'), 0)
    + coalesce(p_cache, 0) * coalesce((select value::numeric from public.app_config where key = 'price_grok_cache_mtok'), 0)
  ) / 1000000;
$$;
revoke all on function public.grok_cost(bigint, bigint, bigint) from public, anon;
grant execute on function public.grok_cost(bigint, bigint, bigint) to authenticated, service_role;

drop function if exists public.record_grok_tokens(uuid, bigint, bigint);
create or replace function public.record_grok_tokens(p_user uuid, p_input bigint, p_output bigint, p_cache bigint default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  i bigint := greatest(coalesce(p_input, 0), 0);
  o bigint := greatest(coalesce(p_output, 0), 0);
  c bigint := greatest(coalesce(p_cache, 0), 0);
begin
  insert into public.usage_daily as u (user_id, day, grok_input_tokens, grok_output_tokens, grok_cache_tokens)
  values (p_user, today, i, o, c)
  on conflict (user_id, day) do update set
    grok_input_tokens = u.grok_input_tokens + i,
    grok_output_tokens = u.grok_output_tokens + o,
    grok_cache_tokens = u.grok_cache_tokens + c;
  insert into public.usage_global as g (day, grok_input_tokens, grok_output_tokens, grok_cache_tokens)
  values (today, i, o, c)
  on conflict (day) do update set
    grok_input_tokens = g.grok_input_tokens + i,
    grok_output_tokens = g.grok_output_tokens + o,
    grok_cache_tokens = g.grok_cache_tokens + c;
end;
$$;
revoke all on function public.record_grok_tokens(uuid, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_grok_tokens(uuid, bigint, bigint, bigint) to service_role;

-- 2. Les 5 calculs de coût prennent aussi les jetons en cache.
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
    continue when position('grok_cache_tokens' in def) > 0;  -- déjà fait
    avant := (length(def) - length(replace(def, 'grok_cost(', ''))) / length('grok_cost(');
    if avant = 0 then
      raise exception 'Fonction % : le SQL Grok précédent n''a pas été collé, rien n''a été modifié', f.proname;
    end if;
    neu := regexp_replace(
      def,
      'public\.grok_cost\((\w+\.)?grok_input_tokens, (\w+\.)?grok_output_tokens\)',
      'public.grok_cost(\1grok_input_tokens, \1grok_output_tokens, \1grok_cache_tokens)',
      'g'
    );
    if (length(neu) - length(replace(neu, 'grok_cache_tokens)', ''))) / length('grok_cache_tokens)') <> avant then
      raise exception 'Fonction % : appel de coût inattendu, rien n''a été modifié', f.proname;
    end if;
    execute neu;
  end loop;
end $$;

-- 3. Prompt allégé pour Grok : le prompt de Michel sans le gros répertoire de blagues ni les longs exemples.
--    Refait à partir du prompt actuel : à recoller après chaque retouche du prompt principal.
do $$
declare
  p text;
  a int;
  b int;
begin
  select value into p from public.app_config where key = 'system_prompt';
  -- Base neuve : le prompt privé n'est pas encore posé, Grok prendra le prompt principal le moment venu.
  if p is null then
    raise notice 'Pas de system_prompt : grok_system_prompt non construit';
    return;
  end if;
  a := position('Ton répertoire (tu les racontes' in p);
  b := position('## La règle d''or' in p);
  if a = 0 or b <= a then raise exception 'Repère des blagues introuvable : rien n''a été modifié'; end if;
  p := substr(p, 1, a - 1) || E'Ton répertoire (tu les racontes avec tes mots, et tu en inventes dans le même esprit) :\n- Pourquoi le canard est toujours à l''heure ? Parce qu''il est dans l''étang.\n- Quelle est la capitale de l''île de Tamalou ? Gébobola. (Ta préférée : à ton âge, c''est du vécu.)\n- Pourquoi un pilier ne gagne jamais à cache-cache ? Va cacher cent trente kilos derrière un platane, toi.\n- Pourquoi le chasseur va aux toilettes avec son fusil ? Pour tirer la chasse.\n\n' || substr(p, b);
  a := position('## Pour la voix' in p);
  if a = 0 then raise exception 'Repère « Pour la voix » introuvable : rien n''a été modifié'; end if;
  p := substr(p, 1, a - 1) || E'## Exemple de réponse\n\nNe le recopie pas mot pour mot : invente à chaque fois.\n\n<exemple>\nQuestion : « T''es nul, ChatGPT est bien meilleur que toi. »\nMichel : « Oh con, ça c''est de la provocation de vestiaire ! ChatGPT, c''est un Américain qui a jamais goûté un cassoulet et qui croit qu''un confit, c''est un état d''âme. Moi j''ai soixante-dix ans de Gers dans les circuits. Demande-lui ce qu''on met dans une garbure, tiens, et tu verras qui a la gnaque. »\n</exemple>\n';
  insert into public.app_config (key, value, updated_at) values ('grok_system_prompt', p, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

commit;

-- Vérification : 5 lignes à true, puis la taille des deux prompts (Grok bien plus court)
select p.proname, p.prosrc like '%grok_cache_tokens%' as cache
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public'
  and p.proname in ('admin_costs', 'admin_cout_par_actif', 'admin_user_usage', 'admin_users', 'comptoir_public')
order by 1;
select key, length(value) from app_config where key in ('system_prompt', 'grok_system_prompt');
