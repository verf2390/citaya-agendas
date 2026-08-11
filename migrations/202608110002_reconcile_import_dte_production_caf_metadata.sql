begin;

create or replace function public.import_dte_production_caf_metadata(
  p_id uuid,
  p_tenant_id uuid,
  p_dte_type integer,
  p_issuer_rut text,
  p_range_from integer,
  p_range_to integer,
  p_authorization_date date,
  p_sha256 text,
  p_logical_identity text,
  p_secure_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  inserted_id uuid;
begin
  if p_dte_type not in (33,34,39,41,52,56,61)
     or p_range_from < 1
     or p_range_to < p_range_from then
    raise exception 'DTE_CAF_INPUT_INVALID';
  end if;

  insert into public.dte_production_cafs(
    id,
    tenant_id,
    dte_type,
    issuer_rut,
    range_from,
    range_to,
    authorization_date,
    sha256,
    logical_identity,
    secure_ref,
    trust_status,
    environment,
    status
  )
  values (
    p_id,
    p_tenant_id,
    p_dte_type,
    p_issuer_rut,
    p_range_from,
    p_range_to,
    p_authorization_date,
    p_sha256,
    p_logical_identity,
    p_secure_ref,
    'verified_official',
    'production',
    'active'
  )
  returning id into inserted_id;

  insert into public.dte_production_folio_ledger(
    tenant_id,
    dte_type,
    folio,
    caf_id,
    state
  )
  select
    p_tenant_id,
    p_dte_type,
    folio,
    inserted_id,
    'available'
  from generate_series(p_range_from, p_range_to) folio;

  insert into public.dte_production_audit(
    tenant_id,
    action,
    metadata_safe
  )
  values (
    p_tenant_id,
    'production_caf_imported',
    jsonb_build_object(
      'dteType', p_dte_type,
      'rangeFrom', p_range_from,
      'rangeTo', p_range_to
    )
  );

  return inserted_id;
end;
$function$;

commit;