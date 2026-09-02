-- Migration: 202608050005_allow_type39_in_reserve_folio.sql
--
-- Purpose:
-- Update reserve_dte_production_folio to allow DTE type 39 (boleta electrónica)
-- alongside 33, 56, and 61.
--
-- Idempotent: uses CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION public.reserve_dte_production_folio(
  p_tenant_id uuid,
  p_dte_type integer,
  p_document_id uuid,
  p_business_operation_id text
)
 RETURNS TABLE(folio integer, caf_id uuid, reused boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  existing public.dte_production_folio_ledger%rowtype;
  selected public.dte_production_folio_ledger%rowtype;
begin
  if p_dte_type not in (33,39,56,61) or
     nullif(trim(p_business_operation_id), '') is null then
    raise exception 'DTE_FOLIO_INPUT_INVALID';
  end if;

  select ledger.* into existing
    from public.dte_production_folio_ledger as ledger
   where ledger.tenant_id = p_tenant_id
     and ledger.business_operation_id = p_business_operation_id
   for update;
  if found then
    if existing.document_id <> p_document_id or
       existing.dte_type <> p_dte_type or
       existing.state not in ('reserved','issued') then
      raise exception 'DTE_FOLIO_IDEMPOTENCY_CONFLICT';
    end if;
    return query select existing.folio, existing.caf_id, true;
    return;
  end if;

  select ledger.* into selected
    from public.dte_production_folio_ledger as ledger
   where ledger.tenant_id = p_tenant_id
     and ledger.dte_type = p_dte_type
     and ledger.state = 'available'
   order by ledger.folio
   for update skip locked
   limit 1;
  if not found then raise exception 'DTE_FOLIO_EXHAUSTED'; end if;

  update public.dte_production_folio_ledger as ledger
     set state = 'reserved',
         document_id = p_document_id,
         business_operation_id = p_business_operation_id,
         reserved_at = now(),
         updated_at = now()
   where ledger.tenant_id = selected.tenant_id
     and ledger.dte_type = selected.dte_type
     and ledger.folio = selected.folio
     and ledger.state = 'available';
  if not found then raise exception 'DTE_FOLIO_COLLISION'; end if;

  insert into public.dte_production_audit(
    tenant_id, document_id, action, metadata_safe
  ) values (
    p_tenant_id, p_document_id, 'folio_reserved',
    jsonb_build_object('dteType', p_dte_type, 'folio', selected.folio)
  );
  return query select selected.folio, selected.caf_id, false;
end;
$function$;
