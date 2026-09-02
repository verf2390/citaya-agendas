-- Migration: 202608050006_fix_finalize_dte_invoice_draft_operational_reason.sql
-- Description: Fixes finalize_dte_invoice_draft RPC to populate and validate operational_reason, satisfying dte_intent_manual_reason_required constraint.

drop function if exists public.finalize_dte_invoice_draft(uuid, uuid, integer, text, text);

create or replace function public.finalize_dte_invoice_draft(
  p_tenant_id uuid,
  p_draft_id uuid,
  p_expected_version integer,
  p_actor_id text,
  p_actor_role text
)
returns table (
  intent_id uuid,
  intent_status text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row record;
  payment_row record;
  old_intent record;
  sale_id_value uuid;
  lines_value jsonb;
  issuer_value jsonb;
  recipient_value jsonb;
  payment_snapshot_value jsonb;
  key_hash text;
  new_intent_id uuid;
  resolved_type integer;
  doc_type_name text;
  actor_uuid uuid;
  paid_amount_val bigint;
  v_origin text;
  v_operational_reason text;
begin
  select * into draft_row from public.dte_invoice_drafts
    where tenant_id = p_tenant_id and id = p_draft_id for update;

  if draft_row.id is null then
    raise exception 'DTE_INVOICE_DRAFT_NOT_FOUND';
  end if;

  if draft_row.status not in ('DRAFT', 'REVIEW_REQUIRED', 'VALIDATED') then
    -- Check if draft was already finalized and intent exists for idempotency
    if draft_row.source_intent_id is not null or draft_row.intent_id is not null then
      select * into old_intent from public.dte_payment_document_intents
        where tenant_id = p_tenant_id and id = coalesce(draft_row.intent_id, draft_row.source_intent_id);
      if old_intent.id is not null then
        return query select old_intent.id, old_intent.status, true;
        return;
      end if;
    end if;
    raise exception 'DTE_INVOICE_DRAFT_LOCKED';
  end if;

  if draft_row.version <> p_expected_version then
    raise exception 'DTE_INVOICE_DRAFT_VERSION_CONFLICT';
  end if;

  actor_uuid := case
    when p_actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_actor_id::uuid
    else null
  end;

  resolved_type := coalesce(draft_row.dte_type, 33);
  doc_type_name := case when resolved_type = 39 then 'consumer' else 'invoice' end;

  v_origin := case
    when draft_row.payment_intent_id is not null then 'manual_payment'
    when draft_row.appointment_id is not null then 'manual_appointment'
    else 'manual_standalone'
  end;

  -- Populate and pre-validate operational_reason to satisfy constraint dte_intent_manual_reason_required
  v_operational_reason := coalesce(
    nullif(trim(draft_row.operational_reason), ''),
    'Emisión manual iniciada por administrador desde panel de facturación'
  );

  if v_origin in ('manual_standalone', 'manual_payment', 'manual_appointment') then
    if length(trim(v_operational_reason)) < 10 or length(trim(v_operational_reason)) > 500 then
      raise exception 'DTE_MANUAL_REASON_REQUIRED';
    end if;
  end if;

  payment_snapshot_value := null;
  if draft_row.payment_intent_id is not null then
    select * into payment_row from public.payment_intents
      where tenant_id = p_tenant_id and id = draft_row.payment_intent_id;
    if payment_row.id is null or payment_row.status <> 'succeeded' then
      raise exception 'DTE_PAYMENT_NOT_CONFIRMED';
    end if;
    if payment_row.amount <> draft_row.total_amount then
      raise exception 'DTE_PAYMENT_AMOUNT_MISMATCH';
    end if;
    payment_snapshot_value := jsonb_build_object(
      'id', payment_row.id,
      'amount', payment_row.amount,
      'currency', payment_row.currency,
      'provider', payment_row.provider,
      'status', payment_row.status
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position', position,
      'description', description,
      'quantity', quantity,
      'unitNetAmount', unit_net_amount,
      'discountBasisPoints', discount_basis_points,
      'discountAmount', discount_amount,
      'netAmount', net_amount,
      'taxAmount', tax_amount,
      'grossAmount', total_amount,
      'pricingMode', pricing_mode,
      'catalogUnitGrossAmount', catalog_unit_gross_amount,
      'serviceId', service_id,
      'appointmentId', appointment_id
    ) order by position
  ), '[]'::jsonb) into lines_value
  from public.dte_invoice_draft_lines
  where tenant_id = p_tenant_id and draft_id = p_draft_id;

  if jsonb_array_length(lines_value) = 0 then
    raise exception 'DTE_INVOICE_DRAFT_LINES_REQUIRED';
  end if;

  select jsonb_build_object(
    'rut', issuer_rut,
    'legalName', issuer_legal_name,
    'businessActivity', issuer_activity,
    'address', issuer_address,
    'commune', issuer_commune,
    'city', issuer_city
  ) into issuer_value
  from public.dte_production_tenant_settings
  where tenant_id = p_tenant_id;

  if issuer_value->>'rut' is null or issuer_value->>'legalName' is null then
    raise exception 'DTE_TAX_DATA_INCOMPLETE';
  end if;

  recipient_value := draft_row.recipient_preview;
  if recipient_value is null or recipient_value->>'rut' is null then
    select jsonb_build_object(
      'rut', rut_normalized,
      'legalName', legal_name,
      'businessActivity', business_activity,
      'address', tax_address,
      'commune', tax_commune,
      'city', tax_city,
      'email', tax_email
    ) into recipient_value
    from public.customer_tax_profiles
    where tenant_id = p_tenant_id and customer_id = draft_row.customer_id;
  end if;

  if recipient_value is null or recipient_value->>'rut' is null then
    raise exception 'DTE_TAX_DATA_INCOMPLETE';
  end if;

  if draft_row.source_intent_id is not null then
    select * into old_intent from public.dte_payment_document_intents
      where tenant_id = p_tenant_id and id = draft_row.source_intent_id;
    if old_intent.id is not null and old_intent.production_document_id is not null then
      return query select old_intent.id, old_intent.status, true;
      return;
    end if;
    if old_intent.id is not null and old_intent.status = 'BLOCKED' then
      update public.dte_payment_document_intents
        set status = 'CANCELED', updated_at = now()
        where tenant_id = p_tenant_id and id = old_intent.id and status = 'BLOCKED';
    end if;
  end if;

  sale_id_value := draft_row.sale_id;
  paid_amount_val := coalesce(draft_row.payment_amount_snapshot, 0);

  if sale_id_value is null then
    insert into public.billing_sales(
      tenant_id, customer_id, payment_intent_id, status, currency,
      net_amount, tax_amount, total_amount, paid_amount,
      initial_payment_due, balance_due, payment_state,
      payment_snapshot, created_by, pending_documentation_amount
    ) values (
      p_tenant_id, draft_row.customer_id, draft_row.payment_intent_id, 'DRAFT', 'CLP',
      draft_row.net_amount, draft_row.tax_amount, draft_row.total_amount,
      paid_amount_val,
      draft_row.total_amount,
      draft_row.total_amount - paid_amount_val,
      case when paid_amount_val = draft_row.total_amount then 'PAID'
        when paid_amount_val > 0 then 'PARTIALLY_PAID'
        else 'UNPAID' end,
      payment_snapshot_value, actor_uuid,
      draft_row.total_amount
    ) returning id into sale_id_value;

    insert into public.billing_sale_items(
      tenant_id, sale_id, service_id, position, description, quantity,
      unit_net_amount, discount_basis_points, discount_amount, net_amount,
      tax_amount, total_amount, pricing_mode, catalog_unit_gross_amount,
      service_snapshot, initial_payment_due, balance_due
    )
    select tenant_id, sale_id_value, service_id, position, description, quantity,
      unit_net_amount, discount_basis_points, discount_amount, net_amount,
      tax_amount, total_amount, pricing_mode, catalog_unit_gross_amount,
      catalog_snapshot, 0, total_amount
    from public.dte_invoice_draft_lines
    where tenant_id = p_tenant_id and draft_id = p_draft_id order by position;

    update public.billing_sales
      set status = case
        when paid_amount_val = draft_row.total_amount
          then 'PAID' else 'INVOICED' end,
          updated_at = now()
    where tenant_id = p_tenant_id and id = sale_id_value and status = 'DRAFT';

    update public.dte_invoice_drafts set sale_id = sale_id_value
    where tenant_id = p_tenant_id and id = p_draft_id;
  end if;

  key_hash := encode(extensions.digest(concat_ws(
    '|', p_tenant_id::text, 'invoice-draft', p_draft_id::text,
    p_expected_version::text
  ), 'sha256'), 'hex');

  select * into old_intent from public.dte_payment_document_intents
    where tenant_id = p_tenant_id and idempotency_key = key_hash;
  if old_intent.id is not null then
    return query select old_intent.id, old_intent.status, true;
    return;
  end if;

  insert into public.dte_payment_document_intents(
    tenant_id, appointment_id, payment_intent_id, customer_id, payment_key,
    trigger_source, idempotency_key, requested_document, resolved_dte_type,
    amount_snapshot, currency, appointment_snapshot, receiver_snapshot,
    immutable_snapshot, origin, operational_reason, status, safe_blocking_reason,
    created_by, requested_by_role
  ) values (
    p_tenant_id, draft_row.appointment_id, draft_row.payment_intent_id,
    draft_row.customer_id, 'invoice-draft:' || p_draft_id::text, 'manual_admin',
    key_hash, doc_type_name, resolved_type, draft_row.total_amount, 'CLP',
    case when draft_row.appointment_id is null then '{}'::jsonb
      else jsonb_build_object('id', draft_row.appointment_id) end,
    recipient_value,
    jsonb_build_object(
      'invoiceDraftId', p_draft_id, 'tenantId', p_tenant_id,
      'saleId', sale_id_value, 'issuer', issuer_value, 'receiver', recipient_value,
      'lines', lines_value, 'money', jsonb_build_object(
        'netAmount', draft_row.net_amount, 'exemptAmount', 0,
        'taxAmount', draft_row.tax_amount, 'grossAmount', draft_row.total_amount
      ),
      'payment', payment_snapshot_value,
      'appointment', case when draft_row.appointment_id is null then null else
        jsonb_build_object('id', draft_row.appointment_id) end,
      'customerId', draft_row.customer_id, 'documentType', resolved_type,
      'origin', draft_row.source, 'capturedAt', now(),
      'operationalReason', v_operational_reason
    ),
    v_origin,
    v_operational_reason, 'PENDING', null, actor_uuid, p_actor_role
  ) returning id into new_intent_id;

  insert into public.dte_document_events(
    tenant_id, intent_id, event_type, actor_id, safe_metadata
  ) values (
    p_tenant_id, new_intent_id, 'INVOICE_DRAFT_FINALIZED', actor_uuid,
    jsonb_build_object(
      'draftId', p_draft_id, 'saleId', sale_id_value,
      'replacedIntentId', draft_row.source_intent_id
    )
  );

  return query select new_intent_id, 'PENDING'::text, false;
end;
$$;

revoke execute on function public.finalize_dte_invoice_draft(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.finalize_dte_invoice_draft(uuid, uuid, integer, text, text) to service_role;
