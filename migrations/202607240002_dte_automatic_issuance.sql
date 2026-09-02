begin;

-- Automatic DTE orchestration is additive. Logical rollback: set every tenant's
-- issuance_mode='manual' and production_enabled=false, stop the worker, then
-- leave intents/events/documents in place as immutable operational evidence.

alter table public.services
  add column if not exists tax_treatment text
  check (tax_treatment in ('affected','exempt'));

alter table public.appointments
  add column if not exists invoice_requested boolean not null default false,
  add column if not exists invoice_receiver_rut text,
  add column if not exists invoice_receiver_legal_name text,
  add column if not exists invoice_receiver_activity text,
  add column if not exists invoice_receiver_address text,
  add column if not exists invoice_receiver_commune text,
  add column if not exists invoice_receiver_city text,
  add column if not exists tax_treatment_snapshot text;

create table if not exists public.dte_tenant_issuance_settings (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  issuance_mode text not null default 'manual'
    check (issuance_mode in ('manual','automatic_on_verified_payment')),
  consumer_document_type text not null default 'unsupported'
    check (consumer_document_type in ('39','41','unsupported')),
  invoice_on_request boolean not null default true,
  auto_email_delivery boolean not null default false,
  tax_treatment text not null default 'unconfigured'
    check (tax_treatment in ('affected','exempt','mixed','unconfigured')),
  production_enabled boolean not null default false,
  sii_authorization_status text not null default 'not_configured'
    check (sii_authorization_status in ('not_configured','pending','approved','rejected','suspended')),
  certificate_ready boolean not null default false,
  certificate_valid_to timestamptz,
  caf_ready boolean not null default false,
  folio_ready boolean not null default false,
  endpoints_ready boolean not null default false,
  storage_ready boolean not null default false,
  worker_ready boolean not null default false,
  readiness_tests_green boolean not null default false,
  last_readiness_check timestamptz,
  safe_blocking_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (certificate_valid_to is null or certificate_valid_to > '2000-01-01'::timestamptz)
);

create table if not exists public.dte_payment_document_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  payment_intent_id uuid references public.payment_intents(id) on delete restrict,
  payment_key text not null,
  trigger_source text not null
    check (trigger_source in ('khipu','webpay','mercadopago','manual_admin')),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  requested_document text not null check (requested_document in ('invoice','consumer')),
  resolved_dte_type integer,
  amount_snapshot bigint not null check (amount_snapshot >= 0),
  currency text not null check (currency = 'CLP'),
  appointment_snapshot jsonb not null,
  receiver_snapshot jsonb not null default '{}'::jsonb,
  status text not null check (status in (
    'PENDING','BLOCKED','PREPARING','READY','SUBMITTING','SUBMITTED',
    'ACCEPTED','REJECTED','AMBIGUOUS','DELIVERY_PENDING','DELIVERED','CANCELED'
  )),
  safe_blocking_reason text,
  production_document_id uuid references public.dte_production_documents(id) on delete restrict,
  deterministic_retry_count integer not null default 0
    check (deterministic_retry_count between 0 and 3),
  network_attempt_count integer not null default 0
    check (network_attempt_count between 0 and 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, payment_key, appointment_id, requested_document)
);

create index if not exists dte_payment_document_intents_tenant_status_idx
  on public.dte_payment_document_intents(tenant_id, status, created_at);
create index if not exists dte_payment_document_intents_appointment_idx
  on public.dte_payment_document_intents(tenant_id, appointment_id);

create table if not exists public.dte_issuance_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  intent_id uuid not null references public.dte_payment_document_intents(id) on delete restrict,
  status text not null default 'PENDING'
    check (status in ('PENDING','BLOCKED','PROCESSING','COMPLETED','CANCELED')),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  deterministic_attempts integer not null default 0
    check (deterministic_attempts between 0 and 3),
  network_attempts integer not null default 0
    check (network_attempts between 0 and 1),
  last_safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, intent_id)
);

create index if not exists dte_issuance_outbox_claim_idx
  on public.dte_issuance_outbox(status, available_at, created_at);
create unique index if not exists dte_issuance_one_processing_per_tenant
  on public.dte_issuance_outbox(tenant_id) where status = 'PROCESSING';

create table if not exists public.dte_document_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  intent_id uuid references public.dte_payment_document_intents(id) on delete restrict,
  production_document_id uuid references public.dte_production_documents(id) on delete restrict,
  event_type text not null,
  actor_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dte_document_events_tenant_intent_idx
  on public.dte_document_events(tenant_id, intent_id, created_at);

create or replace function public.dte_document_events_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'dte_document_events are append-only';
end;
$$;

drop trigger if exists dte_document_events_no_mutation on public.dte_document_events;
create trigger dte_document_events_no_mutation
before update or delete on public.dte_document_events
for each row execute function public.dte_document_events_append_only();

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
set search_path = public
as $$
declare
  a public.appointments%rowtype;
  pi public.payment_intents%rowtype;
  cfg public.dte_tenant_issuance_settings%rowtype;
  requested text;
  resolved_type integer;
  expected_amount bigint;
  block_reason text;
  key_hash text;
  existing_id uuid;
  created_id uuid;
begin
  if p_trigger_source not in ('khipu','webpay','mercadopago','manual_admin')
     or nullif(trim(p_payment_key), '') is null
     or length(p_payment_key) > 256 then
    raise exception 'DTE_PAYMENT_SIGNAL_INVALID';
  end if;

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

  requested := case when a.invoice_requested then 'invoice' else 'consumer' end;
  resolved_type := case
    when requested = 'invoice' then 33
    when cfg.consumer_document_type in ('39','41') then cfg.consumer_document_type::integer
    else null
  end;

  if block_reason is null and not found then block_reason := 'TENANT_DTE_NOT_CONFIGURED'; end if;
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
  -- Production generator currently supports factura 33 and notes 56/61 only.
  -- Boleta 39/41 stays fail-closed until schema/signature/CAF/endpoints are real.
  if block_reason is null and resolved_type not in (33) then block_reason := 'DOCUMENT_TYPE_UNSUPPORTED'; end if;

  key_hash := encode(digest(concat_ws('|', p_tenant_id::text, p_payment_key, p_appointment_id::text, coalesce(resolved_type::text, 'unsupported')), 'sha256'), 'hex');
  select id into existing_id from public.dte_payment_document_intents
   where tenant_id = p_tenant_id and idempotency_key = key_hash;
  if found then return existing_id; end if;

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
  ) returning id into created_id;

  insert into public.dte_issuance_outbox(tenant_id, intent_id, status, last_safe_error)
  values (p_tenant_id, created_id,
    case when block_reason is null then 'PENDING' else 'BLOCKED' end,
    block_reason);
  insert into public.dte_document_events(tenant_id, intent_id, event_type, actor_id, safe_metadata)
  values (p_tenant_id, created_id,
    case when block_reason is null then 'ISSUANCE_QUEUED' else 'ISSUANCE_BLOCKED' end,
    p_actor_id, jsonb_build_object('reason', block_reason, 'dteType', resolved_type));
  return created_id;
end;
$$;

create or replace function public.dte_claim_issuance_outbox(p_worker_id text)
returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = public
as $$
declare claimed public.dte_issuance_outbox%rowtype;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' then
    raise exception 'DTE_WORKER_ID_INVALID';
  end if;
  select o.* into claimed
    from public.dte_issuance_outbox o
   where o.status = 'PENDING'
     and o.available_at <= now()
     and not exists (
       select 1 from public.dte_issuance_outbox active
        where active.tenant_id = o.tenant_id and active.status = 'PROCESSING'
     )
   order by o.created_at
   for update skip locked
   limit 1;
  if not found then return; end if;
  update public.dte_issuance_outbox
     set status='PROCESSING', locked_at=now(), locked_by=p_worker_id, updated_at=now()
   where id=claimed.id and status='PENDING'
   returning * into claimed;
  return next claimed;
end;
$$;

create or replace function public.dte_mark_ambiguous_no_retry(
  p_tenant_id uuid, p_intent_id uuid, p_safe_reason text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.dte_payment_document_intents
     set status='AMBIGUOUS', safe_blocking_reason=left(p_safe_reason,240),
         network_attempt_count=1, updated_at=now()
   where id=p_intent_id and tenant_id=p_tenant_id
     and network_attempt_count=0;
  if not found then raise exception 'DTE_AMBIGUOUS_TRANSITION_INVALID'; end if;
  update public.dte_issuance_outbox
     set status='BLOCKED', network_attempts=1,
         last_safe_error='AMBIGUOUS_REQUIRES_RECONCILIATION', updated_at=now()
   where tenant_id=p_tenant_id and intent_id=p_intent_id;
  insert into public.dte_document_events(tenant_id,intent_id,event_type,safe_metadata)
  values (p_tenant_id,p_intent_id,'SUBMISSION_AMBIGUOUS',jsonb_build_object('automaticRetry',false));
end;
$$;

create or replace function public.dte_cancel_before_issuance(
  p_tenant_id uuid, p_appointment_id uuid, p_actor_id uuid
) returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.dte_payment_document_intents
     set status='CANCELED', safe_blocking_reason='APPOINTMENT_CANCELED_BEFORE_ISSUANCE', updated_at=now()
   where tenant_id=p_tenant_id and appointment_id=p_appointment_id
     and status in ('PENDING','BLOCKED','PREPARING','READY');
  get diagnostics changed = row_count;
  update public.dte_issuance_outbox o set status='CANCELED',updated_at=now()
   where o.tenant_id=p_tenant_id and o.intent_id in (
     select id from public.dte_payment_document_intents
      where tenant_id=p_tenant_id and appointment_id=p_appointment_id and status='CANCELED'
   ) and o.status in ('PENDING','BLOCKED');
  if changed > 0 then
    insert into public.dte_document_events(tenant_id,event_type,actor_id,safe_metadata)
    values (p_tenant_id,'ISSUANCE_CANCELED_BEFORE_EMISSION',p_actor_id,jsonb_build_object('appointmentId',p_appointment_id,'count',changed));
  end if;
  return changed;
end;
$$;

create or replace function public.dte_cancel_intent_on_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.status, '')) in ('canceled','cancelled')
     and lower(coalesce(old.status, '')) not in ('canceled','cancelled') then
    perform public.dte_cancel_before_issuance(new.tenant_id,new.id,null);
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_cancel_dte_intent on public.appointments;
create trigger appointments_cancel_dte_intent
after update of status on public.appointments
for each row execute function public.dte_cancel_intent_on_appointment();

-- Payment finalization remains atomic and now records the DTE intent/outbox in
-- the same transaction. The worker, never the webhook, performs preparation.
create or replace function public.finalize_verified_payment(
  p_intent_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_audit_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_changed integer;
begin
  select * into v_intent from public.payment_intents where id=p_intent_id for update;
  if not found or v_intent.provider<>p_provider or v_intent.provider_payment_id<>p_provider_payment_id then
    raise exception 'payment_intent_mismatch';
  end if;
  if v_intent.status='succeeded' then return false; end if;
  if v_intent.status not in ('pending','processing') then raise exception 'payment_intent_not_payable'; end if;
  update public.payment_intents set status='succeeded',audit_metadata=coalesce(p_audit_metadata,'{}'::jsonb),processed_at=now(),updated_at=now() where id=v_intent.id;
  update public.payments set status='paid',provider=p_provider,currency=v_intent.currency,amount=v_intent.amount,payment_intent_id=v_intent.id,audit_metadata=coalesce(p_audit_metadata,'{}'::jsonb),processed_at=now() where tenant_id=v_intent.tenant_id and appointment_id=v_intent.appointment_id and coalesce(status,'')<>'paid';
  update public.appointments set payment_status='paid',payment_provider=p_provider,payment_reference=p_provider_payment_id,payment_paid_amount=v_intent.amount,status='confirmed',booking_status='confirmed',updated_at=now() where id=v_intent.appointment_id and tenant_id=v_intent.tenant_id and coalesce(payment_status,'')<>'paid' and coalesce(status,'')<>'canceled';
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'appointment_not_payable'; end if;
  perform public.dte_enqueue_payment_snapshot(v_intent.tenant_id,v_intent.appointment_id,v_intent.id,p_provider||':'||p_provider_payment_id,p_provider,null);
  return true;
end;
$$;

create or replace function public.mark_manual_payment_and_enqueue_dte(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_provider text default 'manual'
) returns uuid language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; amount_value numeric; intent_id uuid;
begin
  if p_provider <> 'manual' then raise exception 'MANUAL_PAYMENT_PROVIDER_INVALID'; end if;
  select * into a from public.appointments where tenant_id=p_tenant_id and id=p_appointment_id for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if lower(coalesce(a.status,'')) in ('canceled','cancelled') then raise exception 'APPOINTMENT_CANCELED'; end if;
  amount_value := coalesce(a.service_price,a.price,a.payment_required_amount,a.payment_paid_amount,0);
  update public.appointments set payment_status='paid',payment_provider='manual',payment_paid_amount=amount_value,status='confirmed',booking_status='confirmed',updated_at=now() where id=a.id and tenant_id=a.tenant_id;
  intent_id := public.dte_enqueue_payment_snapshot(p_tenant_id,p_appointment_id,null,'manual:'||p_appointment_id::text,'manual_admin',p_actor_id);
  insert into public.dte_document_events(tenant_id,intent_id,event_type,actor_id,safe_metadata)
  values (p_tenant_id,intent_id,'MANUAL_PAYMENT_CONFIRMED',p_actor_id,jsonb_build_object('appointmentId',p_appointment_id,'amount',amount_value));
  return intent_id;
end;
$$;

alter table public.dte_tenant_issuance_settings enable row level security;
alter table public.dte_payment_document_intents enable row level security;
alter table public.dte_issuance_outbox enable row level security;
alter table public.dte_document_events enable row level security;

revoke all on public.dte_tenant_issuance_settings, public.dte_payment_document_intents,
  public.dte_issuance_outbox, public.dte_document_events from anon, authenticated;
grant select on public.dte_tenant_issuance_settings, public.dte_payment_document_intents,
  public.dte_issuance_outbox, public.dte_document_events to authenticated;

drop policy if exists dte_tenant_read on public.dte_tenant_issuance_settings;
create policy dte_tenant_read on public.dte_tenant_issuance_settings for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
drop policy if exists dte_intent_read on public.dte_payment_document_intents;
create policy dte_intent_read on public.dte_payment_document_intents for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
drop policy if exists dte_outbox_read on public.dte_issuance_outbox;
create policy dte_outbox_read on public.dte_issuance_outbox for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
drop policy if exists dte_event_read on public.dte_document_events;
create policy dte_event_read on public.dte_document_events for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

revoke all on function public.dte_enqueue_payment_snapshot(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.dte_claim_issuance_outbox(text) from public,anon,authenticated;
revoke all on function public.dte_mark_ambiguous_no_retry(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.dte_cancel_before_issuance(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.mark_manual_payment_and_enqueue_dte(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dte_enqueue_payment_snapshot(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.dte_claim_issuance_outbox(text) to service_role;
grant execute on function public.dte_mark_ambiguous_no_retry(uuid,uuid,text) to service_role;
grant execute on function public.dte_cancel_before_issuance(uuid,uuid,uuid) to service_role;
grant execute on function public.mark_manual_payment_and_enqueue_dte(uuid,uuid,uuid,text) to service_role;

comment on table public.dte_tenant_issuance_settings is 'Per-tenant DTE policy and persisted readiness evidence; defaults fail closed.';
comment on table public.dte_payment_document_intents is 'Immutable server-side payment/appointment snapshots and exactly-once DTE orchestration state.';
comment on table public.dte_issuance_outbox is 'Transactional outbox; network ambiguity is terminal and never automatically retried.';
comment on table public.dte_document_events is 'Append-only safe DTE audit events. No certificates, keys, raw XML or provider secrets.';

commit;
