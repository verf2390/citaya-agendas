-- CIT-15: keep verified-payment documentation on exactly one issuance path.
--
-- A payment that is eligible for automatic DTE issuance must not also create
-- the manual REVIEW_REQUIRED draft for the same sale tranche. Policy review,
-- voucher-as-boleta coverage, manual issuance, and reconciliation cases keep
-- using billing_create_payment_review_document unchanged.

create or replace function public.billing_verified_payment_uses_automatic_dte(
  p_tenant_id uuid,
  p_sale_payment_id uuid,
  p_schedule_id uuid,
  p_provider text,
  p_method_classification text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.billing_sales%rowtype;
  sale_payment public.billing_sale_payments%rowtype;
  decision jsonb;
  uncovered bigint;
  automatic_source boolean;
begin
  automatic_source :=
    p_provider in ('khipu','webpay','mercadopago')
    or (
      p_provider = 'manual'
      and coalesce(
        pg_catalog.current_setting('citaya.manual_transfer_tenant_id', true),
        ''
      ) = p_tenant_id::text
    );

  if not automatic_source or not exists (
    select 1
      from public.dte_tenant_issuance_settings automatic_settings
     where automatic_settings.tenant_id = p_tenant_id
       and automatic_settings.issuance_mode = 'automatic_on_verified_payment'
       and automatic_settings.production_enabled = true
  ) or not exists (
    select 1
      from public.dte_production_tenant_settings production_settings
     where production_settings.tenant_id = p_tenant_id
       and production_settings.enabled = true
       and production_settings.issuance_mode = 'automatic'
  ) then
    return false;
  end if;

  select * into sale_payment
    from public.billing_sale_payments
   where tenant_id = p_tenant_id
     and id = p_sale_payment_id;

  if not found
     or sale_payment.status <> 'VERIFIED'
     or sale_payment.validation_result <> 'provider_verified'
     or sale_payment.reconciliation_status <> 'NOT_REQUIRED' then
    return false;
  end if;

  select * into sale
    from public.billing_sales
   where tenant_id = p_tenant_id
     and id = sale_payment.sale_id;

  if not found
     or sale.tax_treatment_status = 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED' then
    return false;
  end if;

  if sale.requested_document_type = 39
     and p_method_classification = 'requires_boleta' then
    decision := jsonb_build_object(
      'action','ISSUE_BOLETA_39',
      'createBoleta39',true,
      'coveredByVoucher',false,
      'blocked',false
    );
  else
    decision := public.dte_payment_document_policy_decision(
      p_tenant_id,
      sale.requested_document_type,
      p_provider,
      p_method_classification = 'voucher_as_boleta'
    );
  end if;

  if coalesce((decision->>'blocked')::boolean, true)
     or decision->>'action' not in ('ISSUE_FACTURA_33','ISSUE_BOLETA_39') then
    return false;
  end if;

  select coalesce(sum(a.allocated_amount), 0) into uncovered
    from public.billing_payment_schedule_allocations a
   where a.tenant_id = p_tenant_id
     and a.schedule_id = p_schedule_id
     and not exists (
       select 1
         from public.billing_sale_item_document_coverage c
        where c.tenant_id = a.tenant_id
          and c.sale_item_id = a.sale_item_id
          and c.status <> 'VOID'
          and c.amount_range && a.amount_range
     );

  if uncovered = 0 or uncovered <> sale_payment.amount then
    return false;
  end if;

  if sale.requested_document_type = 33 and not exists (
    select 1
      from public.customer_tax_profiles profile
     where profile.tenant_id = p_tenant_id
       and profile.customer_id = sale.customer_id
       and length(trim(profile.rut_normalized)) >= 8
       and length(trim(profile.legal_name)) >= 2
       and length(trim(profile.business_activity)) >= 2
       and length(trim(profile.tax_address)) >= 2
       and length(trim(profile.tax_commune)) >= 2
       and length(trim(profile.tax_city)) >= 2
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.finalize_verified_payment(
  p_intent_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_audit_metadata jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  pi public.payment_intents%rowtype;
  sale public.billing_sales%rowtype;
  schedule public.billing_payment_schedule%rowtype;
  safe_audit jsonb;
  next_paid bigint;
  next_state text;
  sale_payment_id uuid;
  expected bigint;
  deposit_reconciliation boolean;
  automatic_dte boolean;
begin
  select * into pi from public.payment_intents where id=p_intent_id for update;
  if not found or pi.provider<>p_provider or pi.provider_payment_id<>p_provider_payment_id
  then raise exception 'payment_intent_mismatch';end if;
  if pi.status in ('succeeded','reconciliation_required') then return false;end if;
  if pi.status not in ('pending','processing') then raise exception 'payment_intent_not_payable';end if;
  select * into schedule from public.billing_payment_schedule where tenant_id=pi.tenant_id
    and id=pi.billing_payment_schedule_id for update;
  if not found then raise exception 'PAYMENT_SCHEDULE_REQUIRED';end if;
  select * into sale from public.billing_sales where tenant_id=pi.tenant_id and id=schedule.sale_id for update;
  expected:=schedule.amount-schedule.paid_amount;
  safe_audit:=public.payment_audit_metadata_minimal(p_provider,coalesce(p_audit_metadata,'{}'::jsonb));
  if pi.amount<>trunc(pi.amount) or pi.amount::bigint<>expected then
    update public.payment_intents set status='reconciliation_required',reconciliation_reason='PAYMENT_SCHEDULE_AMOUNT_MISMATCH',
      audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
    update public.payments set status='reconciliation_required',audit_metadata=safe_audit,processed_at=now(),updated_at=now()
      where tenant_id=pi.tenant_id and payment_intent_id=pi.id;
    insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
      external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
    values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,p_provider_payment_id,p_provider,
      pi.amount::bigint,pi.currency,'VERIFIED','amount_mismatch',
      encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'REVIEW_REQUIRED');
    insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
    values(pi.tenant_id,schedule.id,'RECONCILIATION_REQUIRED','PAYMENT_SCHEDULE_AMOUNT_MISMATCH');
    return false;
  end if;
  select exists(select 1 from public.billing_sale_items i where i.tenant_id=sale.tenant_id
    and i.sale_id=sale.id and i.payment_policy_snapshot='deposit'
    and (i.deposit_tax_document_policy_status_snapshot<>'enabled' or
      coalesce((select deposit_tax_document_policy_status from public.dte_tenant_issuance_settings
        where tenant_id=sale.tenant_id),'unconfigured')<>'enabled')) into deposit_reconciliation;
  if deposit_reconciliation then
    update public.payment_intents set status='reconciliation_required',reconciliation_reason='DEPOSIT_POLICY_NOT_ENABLED',
      audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
    insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
      external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
    values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,p_provider_payment_id,p_provider,
      pi.amount::bigint,pi.currency,'VERIFIED','historical_unexpected_deposit',
      encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'REVIEW_REQUIRED');
    return false;
  end if;
  update public.payment_intents set status='succeeded',audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
  update public.payments set status='paid',provider=p_provider,currency=pi.currency,amount=pi.amount,
    external_reference=p_provider_payment_id,audit_metadata=safe_audit,processed_at=now(),updated_at=now()
    where tenant_id=pi.tenant_id and payment_intent_id=pi.id;
  insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
    external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
  values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,p_provider_payment_id,p_provider,pi.amount::bigint,
    pi.currency,'VERIFIED','provider_verified',encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'NOT_REQUIRED')
  returning id into sale_payment_id;
  update public.billing_payment_schedule set paid_amount=amount,status='PAID',payment_intent_id=pi.id,updated_at=now()
    where tenant_id=pi.tenant_id and id=schedule.id;
  insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
  values(pi.tenant_id,schedule.id,'PAID','VERIFIED_PROVIDER_PAYMENT');
  next_paid:=sale.paid_amount+pi.amount::bigint;
  next_state:=case when next_paid=sale.total_amount then 'PAID' else 'PARTIALLY_PAID' end;
  update public.billing_sales set paid_amount=next_paid,balance_due=total_amount-next_paid,payment_state=next_state,
    status=next_state,updated_at=now() where tenant_id=pi.tenant_id and id=sale.id;
  update public.appointments set payment_paid_amount=next_paid,payment_remaining_amount=sale.total_amount-next_paid,
    balance_due=sale.total_amount-next_paid,payment_status=case when next_state='PAID' then 'paid' else 'partially_paid' end,
    status=case when schedule.installment_kind='initial' then 'confirmed' else status end,
    booking_status=case when schedule.installment_kind='initial' then 'confirmed' else booking_status end,
    payment_provider=p_provider,payment_reference=p_provider_payment_id,updated_at=now()
    where tenant_id=pi.tenant_id and id in(select appointment_id from public.billing_sale_appointments
      where tenant_id=pi.tenant_id and sale_id=sale.id) and coalesce(status,'') not in ('canceled','cancelled');

  automatic_dte := public.billing_verified_payment_uses_automatic_dte(
    pi.tenant_id,
    sale_payment_id,
    schedule.id,
    p_provider,
    pi.tax_document_method_classification
  );

  if not automatic_dte then
    perform public.billing_create_payment_review_document(
      pi.tenant_id,
      sale_payment_id,
      pi.id,
      schedule.id,
      p_provider,
      pi.tax_document_method_classification
    );
  end if;

  if automatic_dte and p_provider in ('khipu','webpay','mercadopago') then
    perform public.dte_enqueue_payment_snapshot(
      pi.tenant_id,
      pi.appointment_id,
      pi.id,
      p_provider||':'||p_provider_payment_id,
      p_provider,
      null
    );
  end if;
  return true;
end;
$$;

create or replace function public.billing_record_manual_verified_payment(
  p_tenant_id uuid,p_appointment_id uuid,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public, extensions as $$
declare sale public.billing_sales%rowtype;schedule public.billing_payment_schedule%rowtype;
  intent_id uuid:=gen_random_uuid();reference_value text;method_classification text:='unconfigured';boleta_model text;
  sale_payment_id uuid;
begin
  if p_actor_id is null then
    raise exception 'MANUAL_TRANSFER_ACTOR_REQUIRED';
  end if;

  perform public.assert_tenant_can_confirm_transfer(p_tenant_id);

  -- Transaction-local trust marker. It also distinguishes manual_verified
  -- from any other service-role call that happens to use provider=manual.
  perform pg_catalog.set_config(
    'citaya.manual_transfer_tenant_id',
    p_tenant_id::text,
    true
  );

  select s.* into sale from public.billing_sales s join public.billing_sale_appointments a
    on a.tenant_id=s.tenant_id and a.sale_id=s.id where a.tenant_id=p_tenant_id
      and a.appointment_id=p_appointment_id for update of s;
  if not found then raise exception 'PAYMENT_SALE_NOT_INITIALIZED';end if;
  if sale.requested_document_type=33 and not exists(
    select 1 from public.customer_tax_profiles p where p.tenant_id=p_tenant_id
      and p.customer_id=sale.customer_id and length(trim(p.rut_normalized))>=8
      and length(trim(p.legal_name))>=2 and length(trim(p.business_activity))>=2
      and length(trim(p.tax_address))>=2 and length(trim(p.tax_commune))>=2
      and length(trim(p.tax_city))>=2
  ) then raise exception 'INVOICE_TAX_PROFILE_INCOMPLETE';end if;
  select * into schedule from public.billing_payment_schedule where tenant_id=p_tenant_id and sale_id=sale.id
    and status in ('PENDING','PARTIALLY_PAID') order by case installment_kind when 'initial' then 0 else 1 end for update limit 1;
  if not found then raise exception 'SALE_ALREADY_PAID';end if;
  if sale.requested_document_type=39 then
    select boleta_payment_document_model into boleta_model from public.dte_tenant_issuance_settings
      where tenant_id=p_tenant_id;
    if boleta_model='always_issue_boleta' then method_classification:='requires_boleta';
    elsif boleta_model='electronic_payment_voucher_as_boleta' then
      select classification into method_classification from public.tenant_payment_method_tax_policies
        where tenant_id=p_tenant_id and provider='manual' and active;
      if method_classification is null then raise exception 'PAYMENT_METHOD_TAX_CLASSIFICATION_REQUIRED';end if;
    else raise exception 'BOLETA_PAYMENT_DOCUMENT_MODEL_UNCONFIGURED';end if;
  end if;
  reference_value:='manual:'||intent_id::text;
  insert into public.payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,
    status,provider_payment_id,idempotency_key,audit_metadata,tax_document_method_classification,updated_at)
  values(intent_id,p_tenant_id,p_appointment_id,schedule.id,'manual',schedule.amount-schedule.paid_amount,'CLP','pending',
    reference_value,'manual-schedule:'||schedule.id::text,'{}',method_classification,now());
  insert into public.payments(tenant_id,appointment_id,external_reference,amount,status,provider,currency,payment_intent_id)
  values(p_tenant_id,p_appointment_id,reference_value,schedule.amount-schedule.paid_amount,'pending','manual','CLP',intent_id);
  perform public.finalize_verified_payment(intent_id,'manual',reference_value,'{}');

  if not exists (
    select 1
      from public.payment_intents pi
     where pi.tenant_id=p_tenant_id
       and pi.id=intent_id
       and pi.appointment_id=p_appointment_id
       and pi.provider='manual'
       and pi.status='succeeded'
  ) then
    raise exception 'MANUAL_TRANSFER_NOT_VERIFIED';
  end if;

  update public.billing_sale_payments
     set verified_by=p_actor_id
   where tenant_id=p_tenant_id
     and appointment_id=p_appointment_id
     and payment_intent_id=intent_id
     and provider='manual'
     and status='VERIFIED'
     and validation_result='provider_verified'
     and reconciliation_status='NOT_REQUIRED'
  returning id into sale_payment_id;

  if not found then
    raise exception 'MANUAL_TRANSFER_EVIDENCE_NOT_FOUND';
  end if;

  if public.billing_verified_payment_uses_automatic_dte(
    p_tenant_id,
    sale_payment_id,
    schedule.id,
    'manual',
    method_classification
  ) then
    perform public.dte_enqueue_payment_snapshot(
      p_tenant_id,
      p_appointment_id,
      intent_id,
      'manual_verified:'||intent_id::text,
      'manual_verified',
      p_actor_id
    );
  end if;

  return intent_id;
end$$;

revoke all on function public.billing_verified_payment_uses_automatic_dte(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated;

grant execute on function public.billing_verified_payment_uses_automatic_dte(
  uuid,uuid,uuid,text,text
) to service_role;

revoke all on function public.finalize_verified_payment(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_verified_payment(uuid,text,text,jsonb)
  to service_role;

revoke all on function public.billing_record_manual_verified_payment(
  uuid,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.billing_record_manual_verified_payment(
  uuid,uuid,uuid
) to service_role;

comment on function public.billing_verified_payment_uses_automatic_dte(
  uuid,uuid,uuid,text,text
) is 'True only when a verified, unreconciled sale tranche should use the automatic DTE intent/outbox instead of a manual review draft.';
