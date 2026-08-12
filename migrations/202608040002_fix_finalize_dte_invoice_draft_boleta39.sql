-- Migration: 202608040002_fix_finalize_dte_invoice_draft_boleta39.sql
-- Fixes finalize_dte_invoice_draft RPC for Boleta 39 and Factura 33 with schema-qualified search_path,
-- correct requested_document values ('consumer' vs 'invoice'), billing constraints, trigger alignment,
-- idempotent key check, valid intent status transitions ('CANCELED' instead of invalid 'SUPERSEDED'), and least-privilege security hardening.

drop function if exists public.finalize_dte_invoice_draft(uuid, uuid, integer, uuid, text);
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
      'origin', draft_row.source, 'capturedAt', now()
    ),
    case when draft_row.payment_intent_id is not null then 'manual_payment'
      when draft_row.appointment_id is not null then 'manual_appointment'
      else 'manual_standalone' end,
    draft_row.operational_reason, 'PENDING', null, actor_uuid, p_actor_role
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

-- Restrict RPC execution to service_role and postgres only (Least Privilege Security Hardening)
revoke execute on function public.finalize_dte_invoice_draft(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.finalize_dte_invoice_draft(uuid, uuid, integer, text, text) to service_role;

-- Align dte_mirror_boleta_intent_to_draft trigger function to handle invoiceDraftId
create or replace function public.dte_mirror_boleta_intent_to_draft()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  sale_id_value uuid;
  draft_id_value uuid;
  line_description text;
  line_net bigint;
  line_tax bigint;
begin
  if new.resolved_dte_type <> 39 or new.customer_id is null then return new; end if;

  if new.immutable_snapshot ? 'invoiceDraftId' then
    update public.dte_invoice_drafts
       set source_intent_id=new.id, intent_id=new.id,
           status=case when new.status='PENDING' then 'QUEUED' else 'REVIEW_REQUIRED' end,
           review_reason=new.safe_blocking_reason,
           issuer_snapshot=new.immutable_snapshot->'issuer',
           recipient_snapshot=new.immutable_snapshot->'receiver',
           locked_at=case when new.status='PENDING' then now() else null end,
           updated_at=now()
     where id=(new.immutable_snapshot->>'invoiceDraftId')::uuid
       and tenant_id=new.tenant_id;
    return new;
  end if;

  line_description := coalesce(
    new.immutable_snapshot#>>'{lines,0,description}',
    new.appointment_snapshot->>'serviceName','Servicio'
  );
  line_net := coalesce(
    (new.immutable_snapshot#>>'{money,netAmount}')::bigint,
    (new.immutable_snapshot#>>'{taxes,net}')::bigint,
    round(new.amount_snapshot/1.19)
  );
  line_tax := new.amount_snapshot-line_net;

  insert into public.billing_sales(
    tenant_id,customer_id,payment_intent_id,status,net_amount,tax_amount,
    total_amount,paid_amount,payment_snapshot,requested_document_type,
    created_by
  ) values (
    new.tenant_id,new.customer_id,new.payment_intent_id,'DRAFT',line_net,line_tax,
    new.amount_snapshot,new.amount_snapshot,new.immutable_snapshot->'payment',39,
    new.created_by
  ) on conflict (tenant_id,payment_intent_id) do update
    set updated_at=public.billing_sales.updated_at
  returning id into sale_id_value;

  insert into public.billing_sale_items(
    tenant_id,sale_id,service_id,position,description,quantity,unit_net_amount,
    discount_amount,net_amount,tax_amount,total_amount,pricing_mode,
    catalog_unit_gross_amount,service_snapshot
  ) values (
    new.tenant_id,sale_id_value,
    nullif(new.appointment_snapshot->>'serviceId','')::uuid,1,
    line_description,1,line_net,0,line_net,line_tax,new.amount_snapshot,
    'catalog_gross',new.amount_snapshot,
    jsonb_build_object('capturedFrom','verified_payment','documentType',39)
  ) on conflict (tenant_id,sale_id,position) do nothing;

  update public.billing_sales
     set status='PAID',document_selection_locked_at=now(),updated_at=now()
   where tenant_id=new.tenant_id and id=sale_id_value and status='DRAFT';

  insert into public.dte_invoice_drafts(
    tenant_id,sale_id,customer_id,appointment_id,payment_intent_id,
    source_intent_id,dte_type,source,status,issuer_preview,recipient_preview,
    net_amount,tax_amount,total_amount,payment_amount_snapshot,review_reason,
    idempotency_key,intent_id,created_by
  ) values (
    new.tenant_id,sale_id_value,new.customer_id,new.appointment_id,
    new.payment_intent_id,new.id,39,'automatic_payment','REVIEW_REQUIRED',
    coalesce(new.immutable_snapshot->'issuer','{}'::jsonb),
    coalesce(new.immutable_snapshot->'receiver','{}'::jsonb),
    line_net,line_tax,new.amount_snapshot,new.amount_snapshot,
    coalesce(new.safe_blocking_reason,'BOLETA_39_REQUIRES_REVIEW'),
    new.idempotency_key,new.id,new.created_by
  ) on conflict (tenant_id,payment_intent_id)
    where payment_intent_id is not null do nothing
  returning id into draft_id_value;

  if draft_id_value is not null then
    insert into public.dte_invoice_draft_lines(
      tenant_id,draft_id,service_id,appointment_id,position,description,
      quantity,unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,
      pricing_mode,catalog_unit_gross_amount,catalog_snapshot
    ) values (
      new.tenant_id,draft_id_value,
      nullif(new.appointment_snapshot->>'serviceId','')::uuid,new.appointment_id,
      1,line_description,1,line_net,0,line_net,line_tax,new.amount_snapshot,
      'catalog_gross',new.amount_snapshot,
      jsonb_build_object('capturedFrom','verified_payment','documentType',39)
    );
  end if;
  return new;
end;
$function$;
