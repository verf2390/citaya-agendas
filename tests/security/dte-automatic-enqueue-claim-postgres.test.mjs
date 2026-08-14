import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202608110003_enable_automatic_dte_enqueue_and_claim.sql";
const migration = readFileSync(migrationPath, "utf8");
const bookingRoute = readFileSync("app/api/appointments/create/route.ts", "utf8");
const cutover = readFileSync("lib/dte/cutover.ts", "utf8");
const manualClaim = readFileSync(
  "migrations/202608050004_allow_type39_in_claim_outbox_rpcs.sql",
  "utf8",
);

test("automatic DTE migration source is fail-closed, separated from manual, and idempotent", () => {
  assert.match(
    migration,
    /check \(status in \('PENDING','BLOCKED','PROCESSING','COMPLETED','CANCELED','AMBIGUOUS'\)\)/,
  );
  assert.match(
    migration,
    /set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,[\s\S]*last_safe_error = stale_reason/,
  );
  assert.match(
    migration,
    /if p_actor_id is null then\s+raise exception 'DTE_BOLETA39_CUSTOMER_SNAPSHOT_ACTOR_REQUIRED'/,
  );
  assert.match(
    migration,
    /intent_row\.trigger_source <> 'manual_admin'/,
  );
  assert.match(
    migration,
    /commercial_customer\.phone\), 32\), ''\),\s+null\s+\) on conflict \(intent_id\) do nothing/,
  );
  assert.match(
    migration,
    /when a\.requested_document_type is not null then a\.requested_document_type[\s\S]*when a\.tax_document_selection is not null then a\.tax_document_selection[\s\S]*when a\.invoice_requested then 33[\s\S]*else 39/,
  );
  assert.match(migration, /DOCUMENT_SELECTION_CONFLICT/);
  assert.match(
    bookingRoute,
    /requested_document_type: bookingTax\.requestedDocumentType,[\s\S]*tax_document_selection: bookingTax\.requestedDocumentType/,
  );
  assert.match(
    bookingRoute,
    /invoice_requested: requestedDocumentType === 33/,
  );
  assert.match(
    cutover,
    /input\.taxDocumentType === 33 \|\| input\.taxDocumentType === 39[\s\S]*input\.invoiceRequested[\s\S]*\? 33[\s\S]*: null/,
  );
  assert.match(migration, /resolved_type not in \(33,39\)/);
  assert.match(migration, /i\.resolved_dte_type in \(33,39\)/);
  assert.doesNotMatch(migration, /resolved_type not in \(33,39,41|i\.resolved_dte_type in \(33,39,41/);
  assert.match(
    migration,
    /o\.issuance_origin = 'automatic_system'[\s\S]*i\.trigger_source in \('khipu','webpay','mercadopago'\)[\s\S]*i\.origin = 'automatic_payment'/,
  );
  assert.doesNotMatch(
    migration.match(/create or replace function public\.dte_claim_automatic_issuance_outbox[\s\S]*?\n\$\$;/)?.[0] ?? "",
    /manual_admin|manual_appointment|manual_payment|manual_standalone/,
  );
  const existingBranch =
    migration.match(/if found then[\s\S]*?return existing_intent\.id;\s+end if;/)?.[0] ?? "";
  assert.match(existingBranch, /on conflict \(intent_id\) do nothing/);
  assert.doesNotMatch(existingBranch, /insert into public\.dte_issuance_outbox/);
  assert.doesNotMatch(
    migration,
    /update public\.dte_(?:tenant_issuance_settings|production_tenant_settings|legal_activation)/,
  );
});

const bootstrap = String.raw`
create extension if not exists pgcrypto;

create table public.tenants(id uuid primary key);
create table public.customers(
  id uuid primary key,
  tenant_id uuid not null,
  full_name text,
  rut_normalized text,
  email text,
  phone text
);
create table public.appointments(
  id uuid primary key,
  tenant_id uuid not null,
  customer_id uuid,
  customer_email text,
  service_id uuid,
  service_name text,
  start_at timestamptz,
  service_price numeric,
  price numeric,
  payment_required_amount numeric,
  payment_paid_amount numeric,
  payment_remaining_amount numeric,
  balance_due numeric,
  currency text,
  payment_status text,
  payment_provider text,
  payment_reference text,
  status text,
  booking_status text,
  invoice_requested boolean not null default false,
  invoice_receiver_rut text,
  invoice_receiver_legal_name text,
  invoice_receiver_activity text,
  invoice_receiver_address text,
  invoice_receiver_commune text,
  invoice_receiver_city text,
  requested_document_type integer,
  tax_document_selection integer,
  tax_treatment_snapshot text,
  updated_at timestamptz not null default now()
);
create table public.payment_intents(
  id uuid primary key,
  tenant_id uuid not null,
  appointment_id uuid not null,
  status text not null,
  amount numeric not null,
  currency text not null,
  provider text not null,
  provider_payment_id text,
  billing_payment_schedule_id uuid,
  tax_document_method_classification text,
  audit_metadata jsonb,
  reconciliation_reason text,
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.payments(
  tenant_id uuid,
  appointment_id uuid,
  payment_intent_id uuid,
  status text,
  provider text,
  currency text,
  amount numeric,
  external_reference text,
  audit_metadata jsonb,
  processed_at timestamptz,
  updated_at timestamptz default now()
);
create table public.dte_tenant_issuance_settings(
  tenant_id uuid primary key,
  issuance_mode text not null,
  consumer_document_type text not null,
  invoice_on_request boolean not null,
  production_enabled boolean not null,
  sii_authorization_status text not null,
  certificate_ready boolean not null,
  certificate_valid_to timestamptz,
  caf_ready boolean not null,
  folio_ready boolean not null,
  endpoints_ready boolean not null,
  storage_ready boolean not null,
  worker_ready boolean not null,
  readiness_tests_green boolean not null,
  deposit_tax_document_policy_status text default 'enabled'
);
create table public.dte_payment_document_intents(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  appointment_id uuid,
  payment_intent_id uuid,
  payment_key text not null,
  trigger_source text not null,
  idempotency_key text not null,
  requested_document text not null,
  resolved_dte_type integer,
  amount_snapshot bigint not null,
  currency text not null,
  appointment_snapshot jsonb not null,
  receiver_snapshot jsonb not null default '{}'::jsonb,
  immutable_snapshot jsonb not null default '{}'::jsonb,
  status text not null,
  safe_blocking_reason text,
  production_document_id uuid,
  network_attempt_count integer not null default 0,
  deterministic_retry_count integer not null default 0,
  customer_id uuid,
  origin text not null default 'automatic_payment',
  requested_by_role text,
  operational_reason text,
  original_production_document_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,idempotency_key),
  unique(tenant_id,payment_key,appointment_id,requested_document)
);
create unique index dte_one_primary_per_verified_payment
  on public.dte_payment_document_intents(tenant_id,payment_intent_id)
  where payment_intent_id is not null and origin in ('automatic_payment','manual_payment');
create table public.dte_issuance_outbox(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  intent_id uuid not null,
  status text not null default 'PENDING',
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  deterministic_attempts integer not null default 0,
  network_attempts integer not null default 0,
  last_safe_error text,
  issuance_origin text not null default 'legacy_unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,intent_id),
  constraint dte_issuance_outbox_status_check
    check(status in ('PENDING','BLOCKED','PROCESSING','COMPLETED','CANCELED'))
);
create unique index dte_issuance_one_processing_per_tenant
  on public.dte_issuance_outbox(tenant_id) where status='PROCESSING';
create function public.dte_mirror_intent_to_invoice_draft()
returns trigger language plpgsql as $$ begin return new; end; $$;
create function public.dte_mirror_boleta_intent_to_draft()
returns trigger language plpgsql as $$ begin return new; end; $$;
create table public.dte_boleta39_commercial_customer_snapshots(
  intent_id uuid primary key,
  tenant_id uuid not null,
  customer_id uuid not null,
  customer_name text not null,
  customer_rut text,
  customer_email text,
  customer_phone text,
  captured_by uuid not null,
  captured_at timestamptz not null default now(),
  unique(tenant_id,intent_id)
);
create table public.dte_document_events(
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  intent_id uuid,
  production_document_id uuid,
  event_type text not null,
  actor_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.dte_production_tenant_settings(
  tenant_id uuid primary key,
  enabled boolean not null,
  issuance_mode text not null,
  sii_authorization_status text not null,
  authorized_types integer[] not null
);
create table public.dte_legal_activation(
  tenant_id uuid not null,
  dte_type integer not null,
  status text not null,
  primary key(tenant_id,dte_type)
);
create table public.dte_production_documents(
  id uuid primary key,
  tenant_id uuid not null,
  status text,
  track_id_ciphertext text,
  track_id_fingerprint text,
  sii_status text
);
create table public.dte_production_submission_attempts(
  tenant_id uuid not null,
  document_id uuid not null,
  before_fetch_at timestamptz
);
create table public.billing_sales(
  id uuid primary key,
  tenant_id uuid not null,
  requested_document_type integer,
  paid_amount bigint not null default 0,
  total_amount bigint not null default 0,
  balance_due bigint not null default 0,
  payment_state text,
  status text,
  updated_at timestamptz default now()
);
create table public.billing_payment_schedule(
  id uuid primary key,
  tenant_id uuid not null,
  sale_id uuid not null,
  amount bigint not null,
  paid_amount bigint not null default 0,
  installment_kind text,
  status text,
  payment_intent_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.billing_sale_items(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  payment_policy_snapshot text,
  deposit_tax_document_policy_status_snapshot text
);
create table public.billing_sale_payments(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  sale_id uuid,
  appointment_id uuid,
  payment_intent_id uuid,
  schedule_id uuid,
  external_payment_reference text,
  provider text,
  amount bigint,
  currency text,
  status text,
  validation_result text,
  evidence_sha256 text,
  reconciliation_status text
);
create table public.billing_payment_schedule_events(
  tenant_id uuid,
  schedule_id uuid,
  event_type text,
  safe_reason text
);
create or replace function public.payment_audit_metadata_minimal(text,jsonb)
returns jsonb language sql immutable set search_path=public as $$select '{}'::jsonb$$;
create or replace function public.billing_create_payment_review_document(uuid,uuid,uuid,uuid,text,text)
returns uuid language sql set search_path=public as $$select gen_random_uuid()$$;
create or replace function public.test_complete_automatic_intent()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.appointment_id is not null and new.customer_id is null then
    select customer_id into new.customer_id from public.appointments
     where tenant_id=new.tenant_id and id=new.appointment_id;
  end if;
  if new.trigger_source <> 'manual_admin' then new.origin := 'automatic_payment'; end if;
  return new;
end;
$$;
create trigger test_complete_automatic_intent
before insert on public.dte_payment_document_intents
for each row execute function public.test_complete_automatic_intent();
`;

const assertions = String.raw`
begin;
do $$
declare
  tenant_id_value constant uuid := '10000000-0000-0000-0000-000000000001';
  customer_id_value constant uuid := '20000000-0000-0000-0000-000000000001';
  actor_id_value constant uuid := '30000000-0000-0000-0000-000000000001';
  appointment_one constant uuid := '40000000-0000-0000-0000-000000000001';
  appointment_two constant uuid := '40000000-0000-0000-0000-000000000002';
  appointment_three constant uuid := '40000000-0000-0000-0000-000000000003';
  appointment_conflict constant uuid := '40000000-0000-0000-0000-000000000004';
  payment_one constant uuid := '50000000-0000-0000-0000-000000000001';
  payment_two constant uuid := '50000000-0000-0000-0000-000000000002';
  payment_three constant uuid := '50000000-0000-0000-0000-000000000003';
  payment_conflict constant uuid := '50000000-0000-0000-0000-000000000004';
  appointment_unsupported constant uuid := '40000000-0000-0000-0000-000000000005';
  payment_unsupported constant uuid := '50000000-0000-0000-0000-000000000005';
  manual_intent_id constant uuid := '60000000-0000-0000-0000-000000000001';
  document_id_value constant uuid := '70000000-0000-0000-0000-000000000001';
  first_intent uuid;
  repeated_intent uuid;
  second_intent uuid;
  third_intent uuid;
  conflict_intent uuid;
  unsupported_intent uuid;
  claimed public.dte_issuance_outbox%rowtype;
  row_count_value integer;
begin
  insert into public.tenants values(tenant_id_value);
  insert into public.customers(id,tenant_id,full_name,rut_normalized,email,phone)
  values(customer_id_value,tenant_id_value,'  Cliente Sin RUT  ',null,null,null);
  insert into public.dte_tenant_issuance_settings values(
    tenant_id_value,'automatic_on_verified_payment','39',true,true,'approved',
    true,now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_id_value,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values
    (tenant_id_value,33,'active'),(tenant_id_value,39,'active');

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,payment_paid_amount,
    currency,payment_status,status,booking_status,invoice_requested,
    requested_document_type,tax_document_selection,tax_treatment_snapshot
  ) values (
    appointment_one,tenant_id_value,customer_id_value,'Consulta',1000,1000,
    'CLP','paid','confirmed','confirmed',false,39,39,'affected'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,provider_payment_id
  ) values(payment_one,tenant_id_value,appointment_one,'succeeded',1000,'CLP','webpay','payment-one');

  first_intent := public.dte_enqueue_payment_snapshot(
    tenant_id_value,appointment_one,payment_one,'webpay:payment-one','webpay',null
  );
  repeated_intent := public.dte_enqueue_payment_snapshot(
    tenant_id_value,appointment_one,payment_one,'webpay:payment-one','webpay',null
  );
  if first_intent <> repeated_intent then raise exception 'IDEMPOTENT_INTENT_ID_CHANGED'; end if;
  select count(*) into row_count_value from public.dte_payment_document_intents
   where tenant_id=tenant_id_value and payment_intent_id=payment_one;
  if row_count_value <> 1 then raise exception 'IDEMPOTENT_INTENT_COUNT_INVALID'; end if;
  select count(*) into row_count_value from public.dte_issuance_outbox where intent_id=first_intent;
  if row_count_value <> 1 then raise exception 'IDEMPOTENT_OUTBOX_COUNT_INVALID'; end if;
  select count(*) into row_count_value
    from public.dte_boleta39_commercial_customer_snapshots
   where intent_id=first_intent and customer_rut is null and captured_by is null
     and customer_name='Cliente Sin RUT';
  if row_count_value <> 1 then raise exception 'AUTOMATIC_NULL_RUT_SNAPSHOT_INVALID'; end if;

  select count(*) into row_count_value
    from public.dte_claim_manual_issuance_outbox('manual-worker-1');
  if row_count_value <> 0 then raise exception 'MANUAL_CLAIM_TOOK_AUTOMATIC_OUTBOX'; end if;

  select * into claimed from public.dte_claim_automatic_issuance_outbox('automatic-worker-1');
  if claimed.intent_id <> first_intent then raise exception 'AUTOMATIC_CLAIM_MISSED_ELIGIBLE_OUTBOX'; end if;
  update public.dte_issuance_outbox set lease_expires_at=now()-interval '1 minute'
   where id=claimed.id;
  perform public.dte_claim_automatic_issuance_outbox('automatic-worker-2');
  select count(*) into row_count_value from public.dte_payment_document_intents i
    join public.dte_issuance_outbox o on o.intent_id=i.id
   where i.id=first_intent and i.status='BLOCKED' and o.status='BLOCKED'
     and i.safe_blocking_reason='WORKER_LEASE_EXPIRED'
     and o.last_safe_error='WORKER_LEASE_EXPIRED';
  if row_count_value <> 1 then raise exception 'EXPIRED_LEASE_WITHOUT_NETWORK_NOT_BLOCKED'; end if;

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,payment_paid_amount,
    currency,payment_status,status,booking_status,invoice_requested,
    requested_document_type,tax_document_selection,tax_treatment_snapshot
  ) values (
    appointment_two,tenant_id_value,customer_id_value,'Consulta',1000,1000,
    'CLP','paid','confirmed','confirmed',false,39,39,'affected'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,provider_payment_id
  ) values(payment_two,tenant_id_value,appointment_two,'succeeded',1000,'CLP','webpay','payment-two');
  second_intent := public.dte_enqueue_payment_snapshot(
    tenant_id_value,appointment_two,payment_two,'webpay:payment-two','webpay',null
  );
  select * into claimed from public.dte_claim_automatic_issuance_outbox('automatic-worker-3');
  if claimed.intent_id <> second_intent then raise exception 'SECOND_AUTOMATIC_CLAIM_FAILED'; end if;
  insert into public.dte_production_documents(id,tenant_id,status)
  values(document_id_value,tenant_id_value,'prepared');
  update public.dte_payment_document_intents set production_document_id=document_id_value
   where id=second_intent;
  insert into public.dte_production_submission_attempts
  values(tenant_id_value,document_id_value,now());
  update public.dte_issuance_outbox set lease_expires_at=now()-interval '1 minute'
   where id=claimed.id;
  perform public.dte_claim_automatic_issuance_outbox('automatic-worker-4');
  select count(*) into row_count_value from public.dte_payment_document_intents i
    join public.dte_issuance_outbox o on o.intent_id=i.id
   where i.id=second_intent and i.status='AMBIGUOUS' and o.status='AMBIGUOUS'
     and i.safe_blocking_reason='NETWORK_RESULT_UNKNOWN'
     and o.last_safe_error='NETWORK_RESULT_UNKNOWN';
  if row_count_value <> 1 then raise exception 'EXPIRED_LEASE_WITH_NETWORK_NOT_AMBIGUOUS'; end if;
  select count(*) into row_count_value
    from public.dte_claim_automatic_issuance_outbox('automatic-worker-5');
  if row_count_value <> 0 then raise exception 'AMBIGUOUS_OUTBOX_RECLAIMED'; end if;

  insert into public.dte_payment_document_intents(
    id,tenant_id,appointment_id,payment_key,trigger_source,idempotency_key,
    requested_document,resolved_dte_type,amount_snapshot,currency,
    appointment_snapshot,status,customer_id,origin,created_by
  ) values (
    manual_intent_id,tenant_id_value,appointment_one,'manual-one','manual_admin',
    encode(digest('manual-one','sha256'),'hex'),'consumer',39,1000,'CLP','{}',
    'PENDING',customer_id_value,'manual_appointment',actor_id_value
  );
  begin
    perform public.capture_boleta39_commercial_customer_snapshot(
      tenant_id_value,manual_intent_id,null
    );
    raise exception 'MANUAL_NULL_ACTOR_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%DTE_BOLETA39_CUSTOMER_SNAPSHOT_ACTOR_REQUIRED%' then raise; end if;
  end;
  perform public.capture_boleta39_commercial_customer_snapshot(
    tenant_id_value,manual_intent_id,actor_id_value
  );
  select count(*) into row_count_value
    from public.dte_boleta39_commercial_customer_snapshots
   where intent_id=manual_intent_id and captured_by=actor_id_value;
  if row_count_value <> 1 then raise exception 'MANUAL_ACTOR_NOT_PERSISTED'; end if;
  insert into public.dte_issuance_outbox(tenant_id,intent_id,status,issuance_origin)
  values(tenant_id_value,manual_intent_id,'PENDING','manual_admin');
  select count(*) into row_count_value
    from public.dte_claim_automatic_issuance_outbox('automatic-worker-6');
  if row_count_value <> 0 then raise exception 'AUTOMATIC_CLAIM_TOOK_MANUAL_OUTBOX'; end if;

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,payment_paid_amount,
    currency,payment_status,status,booking_status,invoice_requested,
    invoice_receiver_rut,invoice_receiver_legal_name,invoice_receiver_activity,
    invoice_receiver_address,invoice_receiver_commune,invoice_receiver_city,
    requested_document_type,tax_document_selection,tax_treatment_snapshot
  ) values (
    appointment_three,tenant_id_value,customer_id_value,'Consultoría',1190,1190,
    'CLP','paid','confirmed','confirmed',true,'76543210-3','Empresa SpA','Servicios',
    'Calle 1','Santiago','Santiago',33,33,'affected'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,provider_payment_id
  ) values(payment_three,tenant_id_value,appointment_three,'succeeded',1190,'CLP','webpay','payment-three');
  third_intent := public.dte_enqueue_payment_snapshot(
    tenant_id_value,appointment_three,payment_three,'webpay:payment-three','webpay',null
  );
  select count(*) into row_count_value from public.dte_payment_document_intents
   where id=third_intent and resolved_dte_type=33 and status='PENDING';
  if row_count_value <> 1 then raise exception 'FACTURA_33_NOT_ACCEPTED'; end if;

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,payment_paid_amount,
    currency,payment_status,status,booking_status,invoice_requested,
    requested_document_type,tax_document_selection,tax_treatment_snapshot
  ) values (
    appointment_conflict,tenant_id_value,customer_id_value,'Conflicto',1000,1000,
    'CLP','paid','confirmed','confirmed',false,33,39,'affected'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,provider_payment_id
  ) values(payment_conflict,tenant_id_value,appointment_conflict,'succeeded',1000,'CLP','webpay','payment-conflict');
  conflict_intent := public.dte_enqueue_payment_snapshot(
    tenant_id_value,appointment_conflict,payment_conflict,
    'webpay:payment-conflict','webpay',null
  );
  select count(*) into row_count_value from public.dte_payment_document_intents i
    join public.dte_issuance_outbox o on o.intent_id=i.id
   where i.id=conflict_intent and i.status='BLOCKED' and o.status='BLOCKED'
     and i.safe_blocking_reason='DOCUMENT_SELECTION_CONFLICT';
  if row_count_value <> 1 then raise exception 'DOCUMENT_SELECTION_CONFLICT_NOT_BLOCKED'; end if;

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,payment_paid_amount,
    currency,payment_status,status,booking_status,invoice_requested,
    requested_document_type,tax_document_selection,tax_treatment_snapshot
  ) values (
    appointment_unsupported,tenant_id_value,customer_id_value,'No soportado',1000,1000,
    'CLP','paid','confirmed','confirmed',false,41,39,'affected'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,provider_payment_id
  ) values(payment_unsupported,tenant_id_value,appointment_unsupported,'succeeded',1000,'CLP','webpay','payment-unsupported');
  unsupported_intent := public.dte_enqueue_payment_snapshot(
    tenant_id_value,appointment_unsupported,payment_unsupported,
    'webpay:payment-unsupported','webpay',null
  );
  select count(*) into row_count_value from public.dte_payment_document_intents i
    join public.dte_issuance_outbox o on o.intent_id=i.id
   where i.id=unsupported_intent and i.resolved_dte_type=41
     and i.status='BLOCKED' and o.status='BLOCKED'
     and i.safe_blocking_reason='DOCUMENT_TYPE_UNSUPPORTED';
  if row_count_value <> 1 then raise exception 'EXPLICIT_UNSUPPORTED_TYPE_FELL_BACK_TO_LEGACY'; end if;
end;
$$;
select 'DTE_AUTOMATIC_SQL_ASSERTIONS_PASSED=19';
rollback;
`;

test("PostgreSQL transaction validates automatic 33/39 enqueue, claim, leases, actor, and idempotency", () => {
  const database = `citaya_auto_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync(
    "docker",
    [
      "exec",
      "citaya-dte-sqltest",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `create database ${database}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(create.status, 0, create.stderr);
  try {
    const run = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        "citaya-dte-sqltest",
        "psql",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `${bootstrap}\n${manualClaim}\n${migration}\n${assertions}`,
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /DTE_AUTOMATIC_SQL_ASSERTIONS_PASSED=19/);
  } finally {
    const drop = spawnSync(
      "docker",
      [
        "exec",
        "citaya-dte-sqltest",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `drop database if exists ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(drop.status, 0, drop.stderr);
  }
});
