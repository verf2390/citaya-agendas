begin;

-- CIT-66 keeps the Mercado Pago preference created during activation separate
-- from the real Payment identifier returned by the provider verification API.
alter table public.payment_intents
  add column verified_provider_payment_id text;

alter table public.payment_intents
  add constraint payment_intents_verified_provider_payment_id_length
  check (
    verified_provider_payment_id is null
    or length(verified_provider_payment_id) between 1 and 256
  );

create unique index payment_intents_verified_provider_payment_uidx
  on public.payment_intents(
    tenant_id,
    provider,
    verified_provider_payment_id
  )
  where verified_provider_payment_id is not null;

comment on column public.payment_intents.provider_payment_id is
  'Provider activation reference. For Mercado Pago this is the preference ID.';
comment on column public.payment_intents.verified_provider_payment_id is
  'Real provider payment/transaction ID verified after activation; never a full provider payload.';

-- Keep only the provider fields required to reproduce the verification
-- decision. Unknown fields and full Mercado Pago payloads are discarded.
create or replace function public.payment_audit_metadata_minimal(
  p_provider text,
  p_value jsonb
) returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(case p_provider
    when 'khipu' then jsonb_build_object(
      'payment_id',left(p_value->>'payment_id',64),
      'transaction_id',left(p_value->>'transaction_id',128),
      'status',left(p_value->>'status',32),
      'status_detail',left(p_value->>'status_detail',64),
      'conciliation_date',p_value->>'conciliation_date'
    )
    when 'mercadopago' then jsonb_build_object(
      'payment_id',left(p_value->>'payment_id',64),
      'status',left(p_value->>'status',32),
      'date_approved',left(p_value->>'date_approved',64),
      'transaction_amount',case
        when jsonb_typeof(p_value->'transaction_amount')='number'
        then p_value->'transaction_amount'
      end,
      'currency_id',left(p_value->>'currency_id',8),
      'external_reference',left(p_value->>'external_reference',64),
      'verification_source',case
        when p_value->>'verification_source'='admin_mercadopago_lookup'
        then 'admin_mercadopago_lookup'
      end
    )
    when 'webpay' then jsonb_build_object(
      'buy_order',left(p_value->>'buy_order',64),
      'session_id',left(p_value->>'session_id',128),
      'status',left(p_value->>'status',32),
      'response_code',p_value->'response_code',
      'transaction_date',p_value->>'transaction_date'
    )
    else '{}'::jsonb
  end);
$$;

create or replace function public.billing_confirm_manually_verified_mercadopago_payment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_intent_id uuid,
  p_preference_id text,
  p_mercadopago_payment_id text,
  p_received_amount numeric,
  p_actor_id uuid,
  p_audit_metadata jsonb
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  intent_row public.payment_intents%rowtype;
  safe_audit jsonb;
  existing_payment_id text;
  transitioned boolean;
  final_status text;
begin
  if p_actor_id is null
     or length(coalesce(p_preference_id,'')) not between 1 and 256
     or coalesce(p_mercadopago_payment_id,'') !~ '^[0-9]{1,32}$'
     or p_received_amount is null
     or p_received_amount <= 0 then
    raise exception 'MERCADOPAGO_MANUAL_VERIFICATION_INVALID';
  end if;

  select * into intent_row
    from public.payment_intents
   where id = p_intent_id
     and tenant_id = p_tenant_id
     and appointment_id = p_appointment_id
     and provider = 'mercadopago'
   for update;

  if not found
     or intent_row.provider_payment_id is distinct from p_preference_id then
    raise exception 'MERCADOPAGO_MANUAL_VERIFICATION_INTENT_MISMATCH';
  end if;

  safe_audit := public.payment_audit_metadata_minimal(
    'mercadopago',
    coalesce(p_audit_metadata,'{}'::jsonb)
  );
  if safe_audit->>'payment_id' is distinct from p_mercadopago_payment_id
     or safe_audit->>'status' is distinct from 'approved'
     or safe_audit->>'external_reference' is distinct from intent_row.id::text
     or upper(safe_audit->>'currency_id') is distinct from upper(intent_row.currency)
     or (safe_audit->>'transaction_amount')::numeric is distinct from p_received_amount
     or safe_audit->>'verification_source' is distinct from 'admin_mercadopago_lookup' then
    raise exception 'MERCADOPAGO_MANUAL_VERIFICATION_EVIDENCE_MISMATCH';
  end if;

  if intent_row.status in ('succeeded','reconciliation_required') then
    existing_payment_id := case
      when intent_row.verified_provider_payment_id is not null
      then intent_row.verified_provider_payment_id
      else intent_row.audit_metadata->>'payment_id'
    end;
    if existing_payment_id is distinct from p_mercadopago_payment_id then
      raise exception 'MERCADOPAGO_MANUAL_VERIFICATION_REPLAY_MISMATCH';
    end if;

    if intent_row.verified_provider_payment_id is null then
      update public.payment_intents
         set verified_provider_payment_id = p_mercadopago_payment_id
       where id = intent_row.id
         and tenant_id = intent_row.tenant_id;
    end if;

    return case
      when intent_row.status='succeeded' then 'replay'
      else 'reconciliation_required'
    end;
  end if;

  if intent_row.status not in ('pending','processing') then
    raise exception 'MERCADOPAGO_MANUAL_VERIFICATION_NOT_PAYABLE';
  end if;

  update public.payment_intents
     set verified_provider_payment_id = p_mercadopago_payment_id,
         updated_at = now()
   where id = intent_row.id and tenant_id = intent_row.tenant_id;

  if p_received_amount is distinct from intent_row.amount then
    perform public.billing_record_unapplied_provider_payment(
      intent_row.id,
      'mercadopago',
      p_mercadopago_payment_id,
      p_received_amount,
      safe_audit
    );
    transitioned := false;
  else
    transitioned := public.finalize_verified_payment(
      intent_row.id,
      'mercadopago',
      intent_row.provider_payment_id,
      safe_audit
    );
  end if;

  update public.billing_sale_payments
     set verified_by = p_actor_id,
         verified_at = now()
   where tenant_id = intent_row.tenant_id
     and payment_intent_id = intent_row.id;
  if not found then
    raise exception 'MERCADOPAGO_MANUAL_VERIFICATION_EVIDENCE_MISSING';
  end if;

  select status into final_status
    from public.payment_intents
   where id = intent_row.id and tenant_id = intent_row.tenant_id;
  if final_status='reconciliation_required' then
    return 'reconciliation_required';
  end if;
  if transitioned then
    return 'transitioned';
  end if;
  return 'replay';
end;
$$;

revoke all on function public.billing_confirm_manually_verified_mercadopago_payment(
  uuid,uuid,uuid,text,text,numeric,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.billing_confirm_manually_verified_mercadopago_payment(
  uuid,uuid,uuid,text,text,numeric,uuid,jsonb
) to service_role;

commit;
