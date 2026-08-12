begin;

create or replace function public.freeze_boleta39_draft_customer_snapshot(
  p_tenant_id uuid,
  p_draft_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row record;
  customer_row record;
  snapshot jsonb;
begin
  select id, customer_id, dte_type, status, version
    into draft_row
    from public.dte_invoice_drafts
   where tenant_id = p_tenant_id
     and id = p_draft_id
   for update;

  if draft_row.id is null then
    raise exception 'DTE_INVOICE_DRAFT_NOT_FOUND';
  end if;
  if draft_row.dte_type <> 39 then
    raise exception 'DTE_BOLETA39_DRAFT_REQUIRED';
  end if;
  if draft_row.status not in ('DRAFT', 'REVIEW_REQUIRED', 'VALIDATED') then
    raise exception 'DTE_INVOICE_DRAFT_LOCKED';
  end if;
  if draft_row.version <> p_expected_version then
    raise exception 'DTE_INVOICE_DRAFT_VERSION_CONFLICT';
  end if;

  select id, full_name, rut_normalized, email, phone
    into customer_row
    from public.customers
   where tenant_id = p_tenant_id
     and id = draft_row.customer_id;

  if customer_row.id is null or nullif(pg_catalog.btrim(customer_row.full_name), '') is null then
    raise exception 'DTE_BOLETA39_CUSTOMER_NOT_FOUND';
  end if;

  snapshot := jsonb_build_object(
    'rut', coalesce(nullif(customer_row.rut_normalized, ''), '66666666-6'),
    'legalName', left(pg_catalog.btrim(customer_row.full_name), 180),
    'email', nullif(left(pg_catalog.lower(pg_catalog.btrim(customer_row.email)), 254), ''),
    'phone', nullif(left(pg_catalog.btrim(customer_row.phone), 32), ''),
    'customer_id', customer_row.id,
    'customer_name', left(pg_catalog.btrim(customer_row.full_name), 180),
    'customer_rut', nullif(customer_row.rut_normalized, ''),
    'customer_email', nullif(left(pg_catalog.lower(pg_catalog.btrim(customer_row.email)), 254), ''),
    'customer_phone', nullif(left(pg_catalog.btrim(customer_row.phone), 32), ''),
    'tax_receiver', jsonb_build_object(
      'rut', '66666666-6',
      'legal_name', 'Consumidor Final'
    ),
    'captured_at', now()
  );

  update public.dte_invoice_drafts
     set recipient_preview = snapshot,
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_draft_id
     and version = p_expected_version;

  return snapshot;
end;
$$;

revoke all on function public.freeze_boleta39_draft_customer_snapshot(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.freeze_boleta39_draft_customer_snapshot(uuid, uuid, integer)
  to service_role;

comment on function public.freeze_boleta39_draft_customer_snapshot(uuid, uuid, integer) is
  'Freezes the commercial customer for a type 39 draft immediately before finalization. The XML tax receiver remains 66666666-6 / Consumidor Final.';

commit;
