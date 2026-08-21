-- CIT-15
-- Trusted admin bank-transfer verification -> automatic DTE.
--
-- SAFETY:
-- - Does not enable generic createPayment for internal tenants.
-- - Does not enable generic enqueueDte for internal tenants.
-- - Does not enable runDteWorker globally.
-- - manual_verified requires a succeeded manual payment plus VERIFIED
--   billing evidence whose verified_by matches the actor.
-- - Manual payment table mutations are allowed only inside the
--   service-role-only billing_record_manual_verified_payment RPC.
-- - The automatic worker remains disabled unless explicitly enabled
--   for the controlled E2E.

create or replace function public.assert_tenant_can_confirm_transfer(
  p_tenant_id uuid
)
returns void
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_lifecycle_status text;
  v_operational_mode text;
begin
  select lifecycle_status, operational_mode
    into v_lifecycle_status, v_operational_mode
    from public.tenants
   where id = p_tenant_id;

  if not found then
    raise exception 'TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE';
  end if;

  if v_lifecycle_status = 'active'
     and v_operational_mode in ('internal','live') then
    return;
  end if;

  raise exception 'TENANT_MODE_TRANSFER_CONFIRMATION_BLOCKED';
end;
$function$;


create or replace function public.assert_tenant_can_enqueue_dte(
  p_tenant_id uuid,
  p_trigger_source text default null
)
returns void
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  caps jsonb;
begin
  caps := public.resolve_tenant_operational_capabilities(p_tenant_id);

  if coalesce((caps->>'enqueueDte')::boolean,false) then
    return;
  end if;

  if coalesce((caps->>'manualDteEnqueue')::boolean,false)
     and (p_trigger_source='manual_admin' or p_trigger_source is null) then
    return;
  end if;

  if p_trigger_source='manual_verified'
     and coalesce((caps->>'manualDteEnqueue')::boolean,false) then
    perform public.assert_tenant_can_confirm_transfer(p_tenant_id);
    return;
  end if;

  raise exception 'TENANT_MODE_DTE_BLOCKED';
end;
$function$;



create or replace function public.tenant_mode_payment_status_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_transfer_tenant text;
begin
  if new.status in ('pending','processing','succeeded','paid','VERIFIED')
     and new.status is distinct from old.status then

    v_transfer_tenant :=
      coalesce(
        pg_catalog.current_setting(
          'citaya.manual_transfer_tenant_id',
          true
        ),
        ''
      );

    if coalesce(new.provider,'')='manual'
       and v_transfer_tenant = new.tenant_id::text then
      perform public.assert_tenant_can_confirm_transfer(new.tenant_id);
    else
      perform public.assert_tenant_can_create_payment(new.tenant_id);
    end if;
  end if;

  return new;
end;
$function$;


create or replace function public.assert_tenant_operational_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trigger_source text;
  v_transfer_tenant text;
begin
  if tg_table_name='appointments' then
    perform public.assert_tenant_can_create_appointment(new.tenant_id);

  elsif tg_table_name in ('payment_intents','payments','billing_sale_payments') then
    v_transfer_tenant :=
      coalesce(
        pg_catalog.current_setting(
          'citaya.manual_transfer_tenant_id',
          true
        ),
        ''
      );

    if coalesce(new.provider,'')='manual'
       and v_transfer_tenant = new.tenant_id::text then
      perform public.assert_tenant_can_confirm_transfer(new.tenant_id);
    else
      perform public.assert_tenant_can_create_payment(new.tenant_id);
    end if;

  elsif tg_table_name='dte_payment_document_intents' then
    perform public.assert_tenant_can_enqueue_dte(
      new.tenant_id,
      new.trigger_source
    );

  elsif tg_table_name='dte_issuance_outbox' then
    select trigger_source
      into v_trigger_source
      from public.dte_payment_document_intents
     where id=new.intent_id
       and tenant_id=new.tenant_id;

    perform public.assert_tenant_can_enqueue_dte(
      new.tenant_id,
      coalesce(v_trigger_source,'manual_admin')
    );

  else
    raise exception 'TENANT_MODE_TRIGGER_TABLE_UNSUPPORTED';
  end if;

  return new;
end;
$function$;

alter table public.dte_payment_document_intents
  drop constraint if exists dte_payment_document_intents_trigger_source_check;

alter table public.dte_payment_document_intents
  add constraint dte_payment_document_intents_trigger_source_check
  check (
    trigger_source = any (
      array[
        'khipu',
        'webpay',
        'mercadopago',
        'manual_admin',
        'manual_verified'
      ]::text[]
    )
  );

create or replace function public.dte_enqueue_payment_snapshot(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_payment_intent_id uuid,
  p_payment_key text,
  p_trigger_source text,
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a public.appointments%rowtype;
  pi public.payment_intents%rowtype;
  cfg public.dte_tenant_issuance_settings%rowtype;
  commercial_customer record;
  requested text;
  selected_document_type integer;
  resolved_type integer;
  expected_amount bigint;
  block_reason text;
  key_hash text;
  cfg_found boolean;
  automatic_flow boolean;
  existing_intent public.dte_payment_document_intents%rowtype;
  created_intent public.dte_payment_document_intents%rowtype;
begin
  if p_trigger_source not in ('khipu','webpay','mercadopago','manual_admin','manual_verified')
     or nullif(trim(p_payment_key), '') is null
     or length(p_payment_key) > 256 then
    raise exception 'DTE_PAYMENT_SIGNAL_INVALID';
  end if;

  automatic_flow := p_trigger_source in ('khipu','webpay','mercadopago','manual_verified');

  select * into a from public.appointments
   where id = p_appointment_id and tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'DTE_APPOINTMENT_NOT_FOUND'; end if;

  if p_payment_intent_id is not null then
    select * into pi from public.payment_intents
     where id = p_payment_intent_id
       and appointment_id = p_appointment_id
       and tenant_id = p_tenant_id
     for share;
    if not found or pi.status <> 'succeeded' then
      raise exception 'DTE_PAYMENT_NOT_VERIFIED';
    end if;
  elsif p_trigger_source <> 'manual_admin' then
    raise exception 'DTE_PAYMENT_INTENT_REQUIRED';
  end if;

  if p_trigger_source = 'manual_verified' then
    if p_actor_id is null
       or p_payment_intent_id is null
       or pi.provider is distinct from 'manual'
       or pi.status is distinct from 'succeeded' then
      raise exception 'DTE_MANUAL_VERIFIED_SIGNAL_INVALID';
    end if;

    if not exists (
      select 1
        from public.billing_sale_payments bsp
       where bsp.tenant_id = p_tenant_id
         and bsp.appointment_id = p_appointment_id
         and bsp.payment_intent_id = p_payment_intent_id
         and bsp.provider = 'manual'
         and bsp.status = 'VERIFIED'
         and bsp.validation_result = 'provider_verified'
         and bsp.reconciliation_status = 'NOT_REQUIRED'
         and bsp.verified_by = p_actor_id
    ) then
      raise exception 'DTE_MANUAL_PAYMENT_VERIFICATION_REQUIRED';
    end if;
  end if;

  expected_amount := round(coalesce(
    a.service_price,
    a.price,
    a.payment_required_amount,
    a.payment_paid_amount,
    case when p_payment_intent_id is not null then pi.amount else null end,
    0
  ));
  if expected_amount < 0 then raise exception 'DTE_AMOUNT_SNAPSHOT_INVALID'; end if;
  if upper(coalesce(a.currency, case when p_payment_intent_id is not null then pi.currency else 'CLP' end, '')) <> 'CLP' then
    block_reason := 'CURRENCY_NOT_SUPPORTED';
  elsif p_payment_intent_id is not null and round(pi.amount) <> round(coalesce(a.payment_paid_amount, pi.amount)) then
    block_reason := 'PAYMENT_AMOUNT_MISMATCH';
  elsif coalesce(a.payment_status, '') <> 'paid' then
    block_reason := 'PAYMENT_NOT_CONFIRMED';
  elsif lower(coalesce(a.status, '')) in ('canceled','cancelled') then
    block_reason := 'APPOINTMENT_CANCELED';
  end if;

  select * into cfg from public.dte_tenant_issuance_settings
   where tenant_id = p_tenant_id;
  cfg_found := found;

  -- The current booking API persists its validated selection in
  -- appointments.requested_document_type, then mirrors that value into
  -- tax_document_selection and invoice_requested. The validated persisted
  -- type therefore wins; legacy fields are fallbacks only when it is absent.
  selected_document_type := case
    when a.requested_document_type is not null then a.requested_document_type
    when a.tax_document_selection is not null then a.tax_document_selection
    when a.invoice_requested then 33
    else 39
  end;
  requested := case when selected_document_type = 33 then 'invoice' else 'consumer' end;
  resolved_type := selected_document_type;

  if block_reason is null and (
    (
      a.requested_document_type in (33,39) and
      a.tax_document_selection in (33,39) and
      a.requested_document_type <> a.tax_document_selection
    ) or
    (selected_document_type = 33 and not a.invoice_requested) or
    (selected_document_type = 39 and a.invoice_requested)
  ) then block_reason := 'DOCUMENT_SELECTION_CONFLICT'; end if;

  if block_reason is null and not cfg_found then block_reason := 'TENANT_DTE_NOT_CONFIGURED'; end if;
  if block_reason is null and cfg.issuance_mode <> 'automatic_on_verified_payment' then block_reason := 'AUTOMATION_DISABLED'; end if;
  if block_reason is null and not cfg.production_enabled then block_reason := 'TENANT_PRODUCTION_DISABLED'; end if;
  if block_reason is null and cfg.sii_authorization_status <> 'approved' then block_reason := 'TENANT_NOT_AUTHORIZED'; end if;
  if block_reason is null and (not cfg.certificate_ready or cfg.certificate_valid_to is null or cfg.certificate_valid_to <= now()) then block_reason := 'CERTIFICATE_NOT_READY'; end if;
  if block_reason is null and not cfg.caf_ready then block_reason := 'CAF_NOT_READY'; end if;
  if block_reason is null and not cfg.folio_ready then block_reason := 'FOLIO_NOT_READY'; end if;
  if block_reason is null and (not cfg.endpoints_ready or not cfg.storage_ready or not cfg.worker_ready or not cfg.readiness_tests_green) then block_reason := 'PRODUCTION_GATES_INCOMPLETE'; end if;
  if block_reason is null and a.tax_treatment_snapshot not in ('affected','exempt') then block_reason := 'TAX_TREATMENT_SNAPSHOT_REQUIRED'; end if;
  if block_reason is null and requested = 'invoice' and not cfg.invoice_on_request then block_reason := 'INVOICE_ON_REQUEST_DISABLED'; end if;
  if block_reason is null and requested = 'invoice' and (
    nullif(trim(a.invoice_receiver_rut), '') is null or
    nullif(trim(a.invoice_receiver_legal_name), '') is null or
    nullif(trim(a.invoice_receiver_activity), '') is null or
    nullif(trim(a.invoice_receiver_address), '') is null or
    nullif(trim(a.invoice_receiver_commune), '') is null
  ) then block_reason := 'INVOICE_RECEIVER_DATA_INCOMPLETE'; end if;
  if block_reason is null and resolved_type not in (33,39) then block_reason := 'DOCUMENT_TYPE_UNSUPPORTED'; end if;

  if block_reason is null and resolved_type = 39 then
    select c.id, c.full_name, c.rut_normalized, c.email, c.phone
      into commercial_customer
      from public.customers c
     where c.tenant_id = p_tenant_id
       and c.id = a.customer_id;
    if not found or nullif(pg_catalog.btrim(commercial_customer.full_name), '') is null then
      block_reason := 'BOLETA39_COMMERCIAL_CUSTOMER_REQUIRED';
    end if;
  end if;

  key_hash := encode(digest(concat_ws('|', p_tenant_id::text, p_payment_key, p_appointment_id::text, coalesce(resolved_type::text, 'unsupported')), 'sha256'), 'hex');
  select * into existing_intent
    from public.dte_payment_document_intents
   where tenant_id = p_tenant_id
     and (
       idempotency_key = key_hash or
       (
         p_payment_intent_id is not null and
         payment_intent_id = p_payment_intent_id and
         origin in ('automatic_payment','manual_payment')
       ) or (
         payment_key = p_payment_key and
         appointment_id = p_appointment_id and
         requested_document = requested
       )
     )
   order by (idempotency_key = key_hash) desc, created_at asc
   for update;
  if found then
    if automatic_flow and existing_intent.origin = 'automatic_payment' and
       existing_intent.status = 'PENDING' and existing_intent.resolved_dte_type = 39 then
      select c.id, c.full_name, c.rut_normalized, c.email, c.phone
        into commercial_customer
        from public.customers c
       where c.tenant_id = existing_intent.tenant_id
         and c.id = existing_intent.customer_id;
      if not found or nullif(pg_catalog.btrim(commercial_customer.full_name), '') is null then
        raise exception 'DTE_BOLETA39_COMMERCIAL_CUSTOMER_REQUIRED';
      end if;
      insert into public.dte_boleta39_commercial_customer_snapshots(
        intent_id, tenant_id, customer_id, customer_name, customer_rut,
        customer_email, customer_phone, captured_by
      ) values (
        existing_intent.id, existing_intent.tenant_id, commercial_customer.id,
        left(pg_catalog.btrim(commercial_customer.full_name), 180),
        nullif(pg_catalog.btrim(commercial_customer.rut_normalized), ''),
        nullif(left(pg_catalog.lower(pg_catalog.btrim(commercial_customer.email)), 254), ''),
        nullif(left(pg_catalog.btrim(commercial_customer.phone), 32), ''),
        null
      ) on conflict (intent_id) do nothing;
    end if;
    return existing_intent.id;
  end if;

  insert into public.dte_payment_document_intents(
    tenant_id, appointment_id, payment_intent_id, payment_key, trigger_source,
    idempotency_key, requested_document, resolved_dte_type, amount_snapshot,
    currency, appointment_snapshot, receiver_snapshot, status,
    safe_blocking_reason, created_by
  ) values (
    p_tenant_id, p_appointment_id, p_payment_intent_id, p_payment_key,
    p_trigger_source, key_hash, requested, resolved_type, expected_amount, 'CLP',
    jsonb_build_object(
      'appointmentId', a.id, 'serviceId', a.service_id, 'serviceName', a.service_name,
      'startAt', a.start_at, 'amount', expected_amount,
      'taxTreatment', a.tax_treatment_snapshot
    ),
    case when requested = 'invoice' then jsonb_build_object(
      'rut', a.invoice_receiver_rut, 'legalName', a.invoice_receiver_legal_name,
      'activity', a.invoice_receiver_activity, 'address', a.invoice_receiver_address,
      'commune', a.invoice_receiver_commune, 'city', a.invoice_receiver_city,
      'email', a.customer_email
    ) else jsonb_build_object('email', a.customer_email) end,
    case when block_reason is null then 'PENDING' else 'BLOCKED' end,
    block_reason, p_actor_id
  ) returning * into created_intent;

  if automatic_flow and created_intent.origin = 'automatic_payment' and
     created_intent.status = 'PENDING' and created_intent.resolved_dte_type = 39 then
    select c.id, c.full_name, c.rut_normalized, c.email, c.phone
      into commercial_customer
      from public.customers c
     where c.tenant_id = created_intent.tenant_id
       and c.id = created_intent.customer_id;
    if not found or nullif(pg_catalog.btrim(commercial_customer.full_name), '') is null then
      raise exception 'DTE_BOLETA39_COMMERCIAL_CUSTOMER_REQUIRED';
    end if;
    insert into public.dte_boleta39_commercial_customer_snapshots(
      intent_id, tenant_id, customer_id, customer_name, customer_rut,
      customer_email, customer_phone, captured_by
    ) values (
      created_intent.id, created_intent.tenant_id, commercial_customer.id,
      left(pg_catalog.btrim(commercial_customer.full_name), 180),
      nullif(pg_catalog.btrim(commercial_customer.rut_normalized), ''),
      nullif(left(pg_catalog.lower(pg_catalog.btrim(commercial_customer.email)), 254), ''),
      nullif(left(pg_catalog.btrim(commercial_customer.phone), 32), ''),
      null
    ) on conflict (intent_id) do nothing;
  end if;

  if automatic_flow and created_intent.origin = 'automatic_payment' then
    insert into public.dte_issuance_outbox(
      tenant_id, intent_id, status, last_safe_error, issuance_origin
    ) values (
      created_intent.tenant_id, created_intent.id,
      case when created_intent.status = 'PENDING' then 'PENDING' else 'BLOCKED' end,
      created_intent.safe_blocking_reason, 'automatic_system'
    );
  else
    insert into public.dte_issuance_outbox(tenant_id, intent_id, status, last_safe_error)
    values (
      created_intent.tenant_id, created_intent.id,
      case when created_intent.status = 'PENDING' then 'PENDING' else 'BLOCKED' end,
      created_intent.safe_blocking_reason
    );
  end if;

  insert into public.dte_document_events(tenant_id, intent_id, event_type, actor_id, safe_metadata)
  values (
    created_intent.tenant_id, created_intent.id,
    case when created_intent.status = 'PENDING' then 'ISSUANCE_QUEUED' else 'ISSUANCE_BLOCKED' end,
    p_actor_id,
    jsonb_build_object('reason', created_intent.safe_blocking_reason, 'dteType', created_intent.resolved_dte_type)
  );
  return created_intent.id;
end;
$$;

create or replace function public.dte_claim_automatic_issuance_outbox(
  p_worker_id text
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  stale record;
  claimed public.dte_issuance_outbox%rowtype;
  stale_reason text;
  stale_ambiguous boolean;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' then
    raise exception 'DTE_WORKER_ID_INVALID';
  end if;

  for stale in
    select
      o.id as outbox_id,
      o.tenant_id,
      o.intent_id,
      o.network_attempts,
      i.production_document_id,
      i.network_attempt_count,
      exists (
        select 1
          from public.dte_production_submission_attempts submission
         where submission.tenant_id = o.tenant_id
           and submission.document_id = i.production_document_id
           and submission.before_fetch_at is not null
      ) as fetch_started
      from public.dte_issuance_outbox o
      join public.dte_payment_document_intents i
        on i.tenant_id = o.tenant_id and i.id = o.intent_id
     where o.status = 'PROCESSING'
       and o.lease_expires_at is not null
       and o.lease_expires_at <= now()
       and o.issuance_origin = 'automatic_system'
       and i.trigger_source in ('khipu','webpay','mercadopago','manual_verified')
       and i.origin = 'automatic_payment'
       and i.resolved_dte_type in (33,39)
     order by o.lease_expires_at asc
     for update of o skip locked
  loop
    stale_ambiguous := stale.fetch_started or stale.network_attempts > 0 or stale.network_attempt_count > 0;
    stale_reason := case
      when stale_ambiguous then 'NETWORK_RESULT_UNKNOWN'
      else 'WORKER_LEASE_EXPIRED'
    end;

    update public.dte_payment_document_intents
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           safe_blocking_reason = stale_reason,
           network_attempt_count = case when stale_ambiguous then 1 else network_attempt_count end,
           updated_at = now()
     where tenant_id = stale.tenant_id
       and id = stale.intent_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');

    update public.dte_issuance_outbox
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           network_attempts = case when stale_ambiguous then 1 else network_attempts end,
           last_safe_error = stale_reason,
           locked_at = null,
           locked_by = null,
           claim_token = null,
           lease_expires_at = null,
           updated_at = now()
     where id = stale.outbox_id
       and tenant_id = stale.tenant_id
       and status = 'PROCESSING';

    insert into public.dte_document_events(
      tenant_id, intent_id, production_document_id, event_type, safe_metadata
    ) values (
      stale.tenant_id,
      stale.intent_id,
      stale.production_document_id,
      case when stale_ambiguous then 'SUBMISSION_AMBIGUOUS' else 'WORKER_LEASE_EXPIRED' end,
      jsonb_build_object(
        'reason', stale_reason,
        'automaticRetry', false,
        'retryRequiresExplicitAuthorization', true
      )
    );
  end loop;

  select o.*
    into claimed
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i
      on i.tenant_id = o.tenant_id and i.id = o.intent_id
    join public.dte_tenant_issuance_settings cfg
      on cfg.tenant_id = o.tenant_id
    join public.dte_production_tenant_settings production
      on production.tenant_id = o.tenant_id
   where o.status = 'PENDING'
     and i.status = 'PENDING'
     and o.available_at <= now()
     and o.issuance_origin = 'automatic_system'
     and i.trigger_source in ('khipu','webpay','mercadopago','manual_verified')
     and i.origin = 'automatic_payment'
     and i.resolved_dte_type in (33,39)
     and (
       i.trigger_source <> 'manual_verified'
       or (
         i.payment_intent_id is not null
         and i.created_by is not null
         and exists (
           select 1
             from public.payment_intents verified_pi
             join public.billing_sale_payments verified_bsp
               on verified_bsp.tenant_id = verified_pi.tenant_id
              and verified_bsp.payment_intent_id = verified_pi.id
            where verified_pi.tenant_id = i.tenant_id
              and verified_pi.id = i.payment_intent_id
              and verified_pi.appointment_id = i.appointment_id
              and verified_pi.provider = 'manual'
              and verified_pi.status = 'succeeded'
              and verified_bsp.appointment_id = i.appointment_id
              and verified_bsp.provider = 'manual'
              and verified_bsp.status = 'VERIFIED'
              and verified_bsp.validation_result = 'provider_verified'
              and verified_bsp.reconciliation_status = 'NOT_REQUIRED'
              and verified_bsp.verified_by = i.created_by
         )
       )
     )
     and o.network_attempts = 0
     and i.network_attempt_count = 0
     and cfg.production_enabled = true
     and cfg.issuance_mode = 'automatic_on_verified_payment'
     and production.enabled = true
     and production.issuance_mode = 'automatic'
     and production.sii_authorization_status = 'approved'
     and i.resolved_dte_type = any(production.authorized_types)
     and exists (
       select 1
         from public.dte_legal_activation activation
        where activation.tenant_id = i.tenant_id
          and activation.dte_type = i.resolved_dte_type
          and activation.status = 'active'
     )
     and (
       i.resolved_dte_type <> 39 or exists (
         select 1
           from public.dte_boleta39_commercial_customer_snapshots snapshot
          where snapshot.tenant_id = i.tenant_id
            and snapshot.intent_id = i.id
            and snapshot.customer_id = i.customer_id
            and nullif(pg_catalog.btrim(snapshot.customer_name), '') is not null
       )
     )
     and not exists (
       select 1
         from public.dte_production_submission_attempts submission
        where submission.tenant_id = i.tenant_id
          and submission.document_id = i.production_document_id
          and submission.before_fetch_at is not null
     )
     and not exists (
       select 1
         from public.dte_issuance_outbox active
        where active.tenant_id = o.tenant_id
          and active.status = 'PROCESSING'
     )
   order by o.created_at
   for update of o skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.dte_issuance_outbox
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = p_worker_id,
         claim_token = gen_random_uuid(),
         lease_expires_at = now() + interval '15 minutes',
         updated_at = now()
   where id = claimed.id
     and tenant_id = claimed.tenant_id
     and status = 'PENDING'
     and issuance_origin = 'automatic_system'
   returning * into claimed;

  if found then
    return next claimed;
  end if;
end;
$$;

create or replace function public.dte_mutate_automatic_issuance_claim(
  p_outbox_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_action text,
  p_production_document_id uuid default null,
  p_final_status text default null,
  p_safe_reason text default null,
  p_deterministic_attempts integer default null,
  p_event_type text default null,
  p_safe_metadata jsonb default '{}'::jsonb,
  p_submission_attempt_id uuid default null,
  p_network_milestone text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_row public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  next_document_id uuid;
  terminal_action boolean;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' or p_claim_token is null or
     p_action not in ('RENEW','PREPARING','READY','SUBMITTING','NETWORK_BOUNDARY','COMPLETE','BLOCK','AMBIGUOUS') or
     p_safe_metadata is null or pg_catalog.jsonb_typeof(p_safe_metadata) <> 'object' then
    return false;
  end if;

  select * into outbox_row from public.dte_issuance_outbox
   where id = p_outbox_id for update;
  if not found or outbox_row.status <> 'PROCESSING' or
     outbox_row.issuance_origin <> 'automatic_system' or
     outbox_row.locked_by is distinct from p_worker_id or
     outbox_row.claim_token is distinct from p_claim_token or
     outbox_row.lease_expires_at is null or
     outbox_row.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;

  select * into intent_row from public.dte_payment_document_intents
   where tenant_id = outbox_row.tenant_id and id = outbox_row.intent_id for update;
  if not found or intent_row.trigger_source not in ('khipu','webpay','mercadopago','manual_verified') or
     intent_row.origin <> 'automatic_payment' or
     intent_row.resolved_dte_type not in (33,39) then return false; end if;

  if intent_row.trigger_source = 'manual_verified' then
    if intent_row.payment_intent_id is null
       or intent_row.created_by is null
       or not exists (
         select 1
           from public.payment_intents verified_pi
           join public.billing_sale_payments verified_bsp
             on verified_bsp.tenant_id = verified_pi.tenant_id
            and verified_bsp.payment_intent_id = verified_pi.id
          where verified_pi.tenant_id = intent_row.tenant_id
            and verified_pi.id = intent_row.payment_intent_id
            and verified_pi.appointment_id = intent_row.appointment_id
            and verified_pi.provider = 'manual'
            and verified_pi.status = 'succeeded'
            and verified_bsp.appointment_id = intent_row.appointment_id
            and verified_bsp.provider = 'manual'
            and verified_bsp.status = 'VERIFIED'
            and verified_bsp.validation_result = 'provider_verified'
            and verified_bsp.reconciliation_status = 'NOT_REQUIRED'
            and verified_bsp.verified_by = intent_row.created_by
       ) then
      return false;
    end if;
  end if;

  next_document_id := coalesce(p_production_document_id, intent_row.production_document_id);
  if intent_row.production_document_id is not null and p_production_document_id is not null and
     intent_row.production_document_id <> p_production_document_id then return false; end if;
  terminal_action := p_action in ('COMPLETE','BLOCK','AMBIGUOUS');

  if p_action = 'RENEW' then
    null;
  elsif p_action = 'PREPARING' then
    if intent_row.status not in ('PENDING','PREPARING') or next_document_id is null then return false; end if;
    update public.dte_payment_document_intents set status='PREPARING',
      production_document_id=next_document_id,safe_blocking_reason=null,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id;
  elsif p_action = 'READY' then
    if intent_row.status not in ('PREPARING','READY') or next_document_id is null then return false; end if;
    update public.dte_payment_document_intents set status='READY',
      production_document_id=next_document_id,safe_blocking_reason=null,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id;
  elsif p_action = 'SUBMITTING' then
    if intent_row.status not in ('READY','SUBMITTING') or next_document_id is null or
       intent_row.network_attempt_count <> 0 or outbox_row.network_attempts <> 0 then return false; end if;
    update public.dte_payment_document_intents set status='SUBMITTING',
      production_document_id=next_document_id,safe_blocking_reason=null,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id;
  elsif p_action = 'NETWORK_BOUNDARY' then
    if intent_row.status <> 'SUBMITTING' or next_document_id is null or p_submission_attempt_id is null or
       p_network_milestone not in ('seed_before_fetch','token_before_fetch','upload_before_fetch') then return false; end if;
    update public.dte_production_submission_attempts
       set before_fetch_at=coalesce(before_fetch_at,now()),
           status=case when status='persisted' then 'uploading' else status end
     where id=p_submission_attempt_id and tenant_id=intent_row.tenant_id
       and document_id=next_document_id and status in ('persisted','uploading');
    if not found then return false; end if;
    update public.dte_payment_document_intents set network_attempt_count=1,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id and network_attempt_count in (0,1);
    update public.dte_issuance_outbox set network_attempts=1,updated_at=now()
      where id=outbox_row.id and tenant_id=outbox_row.tenant_id and network_attempts in (0,1);
  elsif p_action = 'COMPLETE' then
    if intent_row.status <> 'SUBMITTING' or p_final_status not in ('SUBMITTED','REJECTED') or
       intent_row.network_attempt_count <> 1 or outbox_row.network_attempts <> 1 then return false; end if;
    update public.dte_payment_document_intents set status=p_final_status,
      safe_blocking_reason=case when p_final_status='REJECTED'
        then left(coalesce(p_safe_reason,'SII_EXPLICIT_REJECTION'),240) else null end,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id;
    update public.dte_issuance_outbox set status='COMPLETED',last_safe_error=left(p_safe_reason,240),
      locked_at=null,locked_by=null,claim_token=null,lease_expires_at=null,updated_at=now()
      where id=outbox_row.id and tenant_id=outbox_row.tenant_id;
  elsif p_action = 'BLOCK' then
    if intent_row.network_attempt_count <> 0 or outbox_row.network_attempts <> 0 or
       p_deterministic_attempts is null or p_deterministic_attempts not between 0 and 3 then return false; end if;
    update public.dte_payment_document_intents set status='BLOCKED',
      safe_blocking_reason=left(coalesce(p_safe_reason,'DTE_AUTOMATIC_PREPARATION_FAILED'),240),
      deterministic_retry_count=p_deterministic_attempts,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id
        and status in ('PENDING','PREPARING','READY','SUBMITTING');
    if not found then return false; end if;
    update public.dte_issuance_outbox set status='BLOCKED',
      deterministic_attempts=p_deterministic_attempts,
      last_safe_error=left(coalesce(p_safe_reason,'DTE_AUTOMATIC_PREPARATION_FAILED'),240),
      locked_at=null,locked_by=null,claim_token=null,lease_expires_at=null,updated_at=now()
      where id=outbox_row.id and tenant_id=outbox_row.tenant_id;
  elsif p_action = 'AMBIGUOUS' then
    if intent_row.network_attempt_count <> 1 or outbox_row.network_attempts <> 1 then return false; end if;
    update public.dte_payment_document_intents set status='AMBIGUOUS',
      safe_blocking_reason=left(coalesce(p_safe_reason,'NETWORK_RESULT_UNKNOWN'),240),
      network_attempt_count=1,updated_at=now()
      where id=intent_row.id and tenant_id=intent_row.tenant_id
        and status in ('PENDING','PREPARING','READY','SUBMITTING');
    if not found then return false; end if;
    update public.dte_issuance_outbox set status='AMBIGUOUS',network_attempts=1,
      last_safe_error=left(coalesce(p_safe_reason,'NETWORK_RESULT_UNKNOWN'),240),
      locked_at=null,locked_by=null,claim_token=null,lease_expires_at=null,updated_at=now()
      where id=outbox_row.id and tenant_id=outbox_row.tenant_id;
  end if;

  if not terminal_action then
    update public.dte_issuance_outbox set lease_expires_at=now()+interval '15 minutes',updated_at=now()
      where id=outbox_row.id and tenant_id=outbox_row.tenant_id and status='PROCESSING'
        and locked_by=p_worker_id and claim_token=p_claim_token;
    if not found then return false; end if;
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_event_type,'')),'') is not null then
    insert into public.dte_document_events(
      tenant_id,intent_id,production_document_id,event_type,safe_metadata
    ) values (
      intent_row.tenant_id,intent_row.id,next_document_id,
      left(pg_catalog.btrim(p_event_type),120),p_safe_metadata
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
begin
  if p_actor_id is null then
    raise exception 'MANUAL_TRANSFER_ACTOR_REQUIRED';
  end if;

  perform public.assert_tenant_can_confirm_transfer(p_tenant_id);

  -- Transaction-local trust marker. The operational trigger only accepts
  -- manual payment rows while this service-role-only RPC is executing.
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
     and reconciliation_status='NOT_REQUIRED';

  if not found then
    raise exception 'MANUAL_TRANSFER_EVIDENCE_NOT_FOUND';
  end if;

  if exists (
    select 1
      from public.dte_tenant_issuance_settings automatic_settings
     where automatic_settings.tenant_id=p_tenant_id
       and automatic_settings.issuance_mode='automatic_on_verified_payment'
       and automatic_settings.production_enabled=true
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

revoke all on function public.assert_tenant_can_confirm_transfer(uuid)
  from public, anon, authenticated;
grant execute on function public.assert_tenant_can_confirm_transfer(uuid)
  to service_role;

revoke all on function public.dte_enqueue_payment_snapshot(
  uuid,uuid,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.dte_enqueue_payment_snapshot(
  uuid,uuid,uuid,text,text,uuid
) to service_role;

revoke all on function public.dte_claim_automatic_issuance_outbox(text)
  from public, anon, authenticated;
grant execute on function public.dte_claim_automatic_issuance_outbox(text)
  to service_role;

revoke all on function public.dte_mutate_automatic_issuance_claim(
  uuid,text,uuid,text,uuid,text,text,integer,text,jsonb,uuid,text
) from public, anon, authenticated;
grant execute on function public.dte_mutate_automatic_issuance_claim(
  uuid,text,uuid,text,uuid,text,text,integer,text,jsonb,uuid,text
) to service_role;

revoke all on function public.billing_record_manual_verified_payment(
  uuid,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.billing_record_manual_verified_payment(
  uuid,uuid,uuid
) to service_role;
