-- Codes promo : modification depuis le back-office (onglet « Codes promo », bouton « Modifier »).
-- Tout se change : code, remise, formule, échéances remisées, compte réservé, utilisations max, date
-- de fin, note. Les abonnements qui ont déjà le code gardent la remise obtenue (elle est copiée sur
-- l'abonnement) : la modification ne vaut que pour les prochaines utilisations.
create or replace function public.admin_code_promo_modifier(
  p_id bigint, p_code text, p_remise_pct integer, p_formule text default null, p_periodes integer default null,
  p_email text default null, p_utilisations_max integer default null, p_fin timestamptz default null,
  p_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  qui uuid;
begin
  perform public.assert_admin();
  if nullif(trim(p_email), '') is not null then
    select id into qui from auth.users where lower(email) = lower(trim(p_email)) and not coalesce(is_anonymous, false) limit 1;
    if qui is null then
      raise exception 'Aucun compte avec cette adresse' using errcode = 'P0002';
    end if;
  end if;
  update public.codes_promo set
    code = upper(trim(p_code)),
    remise_pct = p_remise_pct,
    formule = nullif(p_formule, ''),
    periodes = p_periodes,
    user_id = qui,
    utilisations_max = p_utilisations_max,
    fin = p_fin,
    note = nullif(trim(p_note), '')
  where id = p_id;
  if not found then
    raise exception 'Code introuvable' using errcode = 'P0002';
  end if;
  insert into public.admin_audit (admin_id, action, detail)
  values (auth.uid(), 'code_promo_modifie', jsonb_build_object('id', p_id, 'code', upper(trim(p_code)), 'remise_pct', p_remise_pct));
end;
$$;
revoke all on function public.admin_code_promo_modifier(bigint, text, integer, text, integer, text, integer, timestamptz, text) from public, anon;
grant execute on function public.admin_code_promo_modifier(bigint, text, integer, text, integer, text, integer, timestamptz, text) to authenticated;
