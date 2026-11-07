-- Code promo à la reprise d'une cotisation résiliée (bouton « Reprendre ma cotisation » de /la-cotisation).
-- La remise vaut pour les prochaines échéances : les échéances déjà payées ne comptent pas dans le
-- nombre d'échéances remisées. Une seule remise par abonnement.

create or replace function public.code_promo_reprise(p_code text, p_abonnement bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a public.abonnements;
  r jsonb;
  prix integer;
  payees integer;
begin
  select * into a from public.abonnements where id = p_abonnement for update;
  if not found or a.statut <> 'resilie' or a.source <> 'web' or a.fin_periode is null or a.fin_periode <= now() then
    return jsonb_build_object('valide', false, 'raison', 'abonnement');
  end if;
  if a.code_promo_id is not null or a.prix_plein_cents is not null then
    return jsonb_build_object('valide', false, 'raison', 'cumul');
  end if;
  r := public.code_promo_lire(p_code, a.user_id, a.formule, true);
  if not (r ->> 'valide')::boolean then return r; end if;
  prix := public.prix_remise(a.prix_cents, (r ->> 'remise_pct')::integer);
  select count(*) into payees from public.abonnement_echeances e where e.abonnement_id = a.id and e.statut = 'paye';
  insert into public.codes_promo_utilisations (code_id, user_id, abonnement_id)
  values ((r ->> 'id')::bigint, a.user_id, a.id);
  update public.abonnements set
    code_promo_id = (r ->> 'id')::bigint,
    remise_pct = (r ->> 'remise_pct')::integer,
    remise_periodes = case when (r ->> 'periodes') is null then null else payees + (r ->> 'periodes')::integer end,
    prix_plein_cents = a.prix_cents,
    prix_cents = prix,
    updated_at = now()
  where id = a.id;
  return r || jsonb_build_object('prix_cents', prix, 'prix_plein_cents', a.prix_cents);
end;
$$;
revoke all on function public.code_promo_reprise(text, bigint) from public, anon, authenticated;
