-- Follow-up safety migration for CIT-15.
-- Keeps production migration history reproducible after correcting the
-- billing_payment_schedule_events target column in finalize_verified_payment().

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

revoke all on function public.finalize_verified_payment(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_verified_payment(uuid,text,text,jsonb)
  to service_role;
