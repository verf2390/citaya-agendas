import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202608110003_enable_automatic_dte_enqueue_and_claim.sql";
const migration = readFileSync(migrationPath, "utf8");
const hardeningPath =
  "migrations/202608240001_dte_automatic_worker_canary_fencing.sql";
const hardening = readFileSync(hardeningPath, "utf8");
const ownedLastFolioPath =
  "migrations/202608260001_cit33_allow_owned_last_folio.sql";
const ownedLastFolio = readFileSync(ownedLastFolioPath, "utf8");
const ownedFolioResumePath =
  "migrations/202608260002_cit33_claim_owned_folio_resume.sql";
const ownedFolioResume = readFileSync(ownedFolioResumePath, "utf8");
const quarantinePath =
  "migrations/202608270001_dte_quarantine_automatic_issuance_exact.sql";
const quarantine = readFileSync(quarantinePath, "utf8");
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

test("automatic worker hardening has exact canary, gate and crash fences", () => {
  assert.match(hardening, /dte_claim_automatic_issuance_outbox_exact/);
  assert.match(hardening, /DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE/);
  assert.match(hardening, /dte_automatic_issuance_gate_open/);
  assert.match(hardening, /AUTOMATIC_GATE_CLOSED_PRE_NETWORK/);
  assert.match(hardening, /PRE_NETWORK_CRASH_STATE_PRESERVED/);
  assert.match(hardening, /i\.production_document_id is null/);
  assert.match(hardening, /i\.resolved_dte_type in \(33,39\)/);
  assert.doesNotMatch(hardening, /i\.resolved_dte_type in \(33,39,41\)/);
});

test("CIT-33 owned-last-folio exception is narrow, fail-closed, and offline", () => {
  assert.match(ownedLastFolio, /i\.production_document_id is not null/);
  assert.match(ownedLastFolio, /activation_report\.value -> 'foliosAvailable' = 'false'::jsonb/);
  assert.match(ownedLastFolio, /document\.dte_type in \(33,39\)/);
  assert.match(ownedLastFolio, /ledger\.document_id = document\.id/);
  assert.match(ownedLastFolio, /ledger\.business_operation_id = document\.business_operation_id/);
  assert.match(ownedLastFolio, /ledger\.state = 'reserved'/);
  assert.match(ownedLastFolio, /ledger\.state = 'issued'/);
  assert.match(ownedLastFolio, /security definer[\s\S]*set search_path = ''/);
  assert.match(
    ownedLastFolio,
    /revoke all on function public\.dte_automatic_issuance_gate_open\(uuid, uuid\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(ownedLastFolio, /document\.dte_type in \(33,39,41/);
  assert.doesNotMatch(
    ownedLastFolio,
    /(?:net\.http|http_(?:get|post)|dblink|pg_net)/i,
  );
});

test("CIT-33 owned-folio resume claim is exact, atomic, and least-privilege", () => {
  assert.match(ownedFolioResume, /dte_claim_automatic_owned_folio_resume_exact/);
  assert.match(ownedFolioResume, /returns setof public\.dte_issuance_outbox/);
  assert.match(ownedFolioResume, /security definer[\s\S]*set search_path = ''/);
  assert.match(ownedFolioResume, /pg_advisory_xact_lock/);
  assert.match(ownedFolioResume, /for update/);
  assert.match(ownedFolioResume, /AUTOMATIC_GATE_CLOSED_PRE_NETWORK/);
  assert.match(ownedFolioResume, /AUTOMATIC_OWNED_FOLIO_RESUME_CLAIMED/);
  assert.match(ownedFolioResume, /public\.dte_automatic_issuance_gate_open/);
  assert.match(ownedFolioResume, /possible_relation_count <> 1/);
  assert.match(ownedFolioResume, /submission\.document_id = document_row\.id/);
  assert.match(ownedFolioResume, /claim_token = pg_catalog\.gen_random_uuid\(\)/);
  assert.match(
    ownedFolioResume,
    /revoke all on function public\.dte_claim_automatic_owned_folio_resume_exact\([\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute[\s\S]*to service_role/,
  );
  assert.doesNotMatch(ownedFolioResume, /skip locked|for stale in/);
  assert.doesNotMatch(
    ownedFolioResume,
    /(?:net\.http|http_(?:get|post)|dblink|pg_net)/i,
  );
});

test("automatic quarantine is exact, pre-network, and least-privilege", () => {
  assert.match(quarantine, /dte_quarantine_automatic_issuance_exact/);
  assert.match(quarantine, /returns setof public\.dte_issuance_outbox/);
  assert.match(quarantine, /security definer[\s\S]*set search_path = ''/);
  assert.match(quarantine, /pg_advisory_xact_lock/);
  assert.equal((quarantine.match(/for update/g) ?? []).length, 2);
  assert.match(quarantine, /POSSIBLE_DUPLICATE_DOCUMENT_REVIEW_REQUIRED/);
  assert.match(quarantine, /AUTOMATIC_ISSUANCE_QUARANTINED/);
  assert.match(quarantine, /business_operation_id = expected_business_operation_id/);
  assert.match(quarantine, /event\.event_type like '%NETWORK_BOUNDARY%'/);
  assert.match(quarantine, /active\.status = 'PROCESSING'/);
  assert.match(
    quarantine,
    /revoke all on function public\.dte_quarantine_automatic_issuance_exact\([\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute[\s\S]*to service_role/,
  );
  assert.doesNotMatch(quarantine, /set\s+network_attempts\s*=\s*[1-9]/i);
  assert.doesNotMatch(quarantine, /set\s+network_attempt_count\s*=\s*[1-9]/i);
  assert.doesNotMatch(quarantine, /set\s+deterministic_(?:attempts|retry_count)\s*=/i);
  assert.doesNotMatch(quarantine, /insert into public\.dte_production_/i);
  assert.doesNotMatch(
    quarantine,
    /(?:reserve_folio|net\.http|http_(?:get|post)|dblink|pg_net)/i,
  );
});

const bootstrap = String.raw`
create extension if not exists pgcrypto;

create table public.tenants(
  id uuid primary key,
  lifecycle_status text not null default 'active',
  operational_mode text not null default 'live'
);
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
  dte_type integer,
  business_operation_id text,
  status text,
  folio integer,
  caf_id uuid,
  track_id_ciphertext text,
  track_id_fingerprint text,
  sii_status text
);
create table public.dte_production_folio_ledger(
  tenant_id uuid not null,
  dte_type integer not null,
  folio integer not null,
  caf_id uuid not null,
  state text not null,
  document_id uuid,
  business_operation_id text,
  reserved_at timestamptz,
  issued_at timestamptz,
  primary key(tenant_id,dte_type,folio)
);
create table public.dte_production_submission_attempts(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,
  before_fetch_at timestamptz,
  status text not null default 'persisted'
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
  reconciliation_status text,
  verified_by uuid
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
create or replace function public.dte_tenant_operational_readiness(uuid)
returns table(ready_for_issuance boolean)
language sql set search_path=public as $$select true$$;
create or replace function public.dte_activation_gate_report(uuid,integer,boolean)
returns jsonb
language sql set search_path=public as $$select '{"ready":true}'::jsonb$$;
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
  insert into public.dte_production_submission_attempts(
    tenant_id,document_id,before_fetch_at,status
  ) values(tenant_id_value,document_id_value,now(),'uploading');
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

const hardeningAssertions = String.raw`
begin;
do $$
declare
  tenant_id_value constant uuid := '11000000-0000-4000-8000-000000000001';
  auto_a constant uuid := '21000000-0000-4000-8000-000000000001';
  auto_b constant uuid := '21000000-0000-4000-8000-000000000002';
  auto_crash constant uuid := '21000000-0000-4000-8000-000000000003';
  auto_ambiguous constant uuid := '21000000-0000-4000-8000-000000000004';
  auto_pre_gate constant uuid := '21000000-0000-4000-8000-000000000005';
  auto_post_gate constant uuid := '21000000-0000-4000-8000-000000000006';
  auto_mid_gate constant uuid := '21000000-0000-4000-8000-000000000007';
  auto_operational_gate constant uuid := '21000000-0000-4000-8000-000000000008';
  manual_intent constant uuid := '31000000-0000-4000-8000-000000000001';
  outbox_a constant uuid := '41000000-0000-4000-8000-000000000001';
  outbox_b constant uuid := '41000000-0000-4000-8000-000000000002';
  outbox_crash constant uuid := '41000000-0000-4000-8000-000000000003';
  outbox_ambiguous constant uuid := '41000000-0000-4000-8000-000000000004';
  outbox_pre_gate constant uuid := '41000000-0000-4000-8000-000000000005';
  outbox_post_gate constant uuid := '41000000-0000-4000-8000-000000000006';
  outbox_mid_gate constant uuid := '41000000-0000-4000-8000-000000000007';
  outbox_operational_gate constant uuid := '41000000-0000-4000-8000-000000000008';
  manual_outbox constant uuid := '51000000-0000-4000-8000-000000000001';
  crash_document constant uuid := '61000000-0000-4000-8000-000000000001';
  ambiguous_document constant uuid := '61000000-0000-4000-8000-000000000002';
  post_document constant uuid := '61000000-0000-4000-8000-000000000003';
  mid_document constant uuid := '61000000-0000-4000-8000-000000000004';
  crash_attempt constant uuid := '71000000-0000-4000-8000-000000000001';
  ambiguous_attempt constant uuid := '71000000-0000-4000-8000-000000000002';
  post_attempt constant uuid := '71000000-0000-4000-8000-000000000003';
  mid_attempt constant uuid := '71000000-0000-4000-8000-000000000004';
  claimed public.dte_issuance_outbox%rowtype;
  row_count_value integer;
  mutation_ok boolean;
begin
  insert into public.tenants values(tenant_id_value);
  insert into public.dte_tenant_issuance_settings values(
    tenant_id_value,'automatic_on_verified_payment','39',true,true,'approved',
    true,now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_id_value,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values
    (tenant_id_value,33,'active'),(tenant_id_value,39,'active');

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values
    (auto_a,tenant_id_value,'auto-a','webpay','auto-a','invoice',33,1190,'CLP','{}','PENDING','automatic_payment'),
    (auto_b,tenant_id_value,'auto-b','webpay','auto-b','invoice',33,1190,'CLP','{}','PENDING','automatic_payment'),
    (manual_intent,tenant_id_value,'manual-a','manual_admin','manual-a','invoice',33,1190,'CLP','{}','PENDING','manual_appointment');
  insert into public.dte_issuance_outbox(id,tenant_id,intent_id,status,issuance_origin)
  values
    (outbox_a,tenant_id_value,auto_a,'PENDING','automatic_system'),
    (outbox_b,tenant_id_value,auto_b,'PENDING','automatic_system'),
    (manual_outbox,tenant_id_value,manual_intent,'PENDING','manual_admin');

  begin
    perform public.dte_claim_automatic_issuance_outbox_exact(
      'auto-invalid','99999999-9999-4999-8999-999999999999'
    );
    raise exception 'INVALID_TARGET_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE%' then raise; end if;
  end;
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where id in (outbox_a,outbox_b) and status='PENDING';
  if row_count_value <> 2 then raise exception 'INVALID_TARGET_FELL_BACK'; end if;

  begin
    perform public.dte_claim_automatic_issuance_outbox_exact(
      'auto-manual',manual_outbox
    );
    raise exception 'MANUAL_ORIGIN_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE%' then raise; end if;
  end;

  select * into claimed
    from public.dte_claim_automatic_issuance_outbox_exact('auto-target-b',outbox_b);
  if claimed.id <> outbox_b or claimed.intent_id <> auto_b then
    raise exception 'EXACT_TARGET_CLAIMED_WRONG_ROW';
  end if;
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where id=outbox_a and status='PENDING';
  if row_count_value <> 1 then raise exception 'EXACT_TARGET_CLAIMED_OLDEST'; end if;
  begin
    perform public.dte_claim_automatic_issuance_outbox_exact(
      'auto-target-b-race',outbox_b
    );
    raise exception 'EXACT_TARGET_DOUBLE_CLAIMED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE%' then raise; end if;
  end;
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where tenant_id=tenant_id_value and status='PROCESSING';
  if row_count_value <> 1 then raise exception 'CONCURRENT_CLAIM_FENCE_FAILED'; end if;

  update public.dte_issuance_outbox
     set lease_expires_at=now()-interval '1 minute'
   where id=outbox_b;
  perform public.dte_claim_manual_issuance_outbox('manual-isolation');
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where id=outbox_b and status='PROCESSING' and claim_token is not null;
  if row_count_value <> 1 then raise exception 'MANUAL_STALE_TOUCHED_AUTOMATIC'; end if;

  perform public.dte_claim_automatic_issuance_outbox('auto-stale-b');
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where id=outbox_b and status='BLOCKED'
     and last_safe_error='WORKER_LEASE_EXPIRED'
     and locked_by is null and claim_token is null and lease_expires_at is null;
  if row_count_value <> 1 then raise exception 'AUTOMATIC_STALE_NOT_BLOCKED'; end if;
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where id=outbox_a and status='PROCESSING';
  if row_count_value <> 1 then raise exception 'GLOBAL_CLAIM_DID_NOT_TAKE_REMAINING_AUTO'; end if;
  update public.dte_issuance_outbox
     set lease_expires_at=now()-interval '1 minute'
   where id=outbox_a;
  perform public.dte_claim_automatic_issuance_outbox('auto-stale-a');

  select * into claimed
    from public.dte_claim_manual_issuance_outbox('manual-claim');
  if claimed.id <> manual_outbox then raise exception 'MANUAL_CLAIM_FAILED'; end if;
  update public.dte_issuance_outbox
     set lease_expires_at=now()-interval '1 minute'
   where id=manual_outbox;
  perform public.dte_claim_automatic_issuance_outbox('auto-manual-stale-isolation');
  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where id=manual_outbox and status='PROCESSING';
  if row_count_value <> 1 then raise exception 'AUTOMATIC_STALE_TOUCHED_MANUAL'; end if;
  perform public.dte_claim_manual_issuance_outbox('manual-stale-owner');

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin,
    production_document_id
  ) values(
    auto_crash,tenant_id_value,'auto-crash','webpay','auto-crash','invoice',
    33,1190,'CLP','{}','SUBMITTING','automatic_payment',crash_document
  );
  insert into public.dte_production_documents(id,tenant_id,status)
  values(crash_document,tenant_id_value,'ready');
  insert into public.dte_production_submission_attempts(
    id,tenant_id,document_id,before_fetch_at,status
  ) values(crash_attempt,tenant_id_value,crash_document,null,'persisted');
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin,locked_by,claim_token,
    lease_expires_at
  ) values(
    outbox_crash,tenant_id_value,auto_crash,'PROCESSING','automatic_system',
    'crashed-auto','81000000-0000-4000-8000-000000000001',
    now()-interval '1 minute'
  );
  perform public.dte_claim_automatic_issuance_outbox('auto-crash-recovery');
  select count(*) into row_count_value
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i on i.id=o.intent_id
   where o.id=outbox_crash and o.status='BLOCKED' and i.status='BLOCKED'
     and o.last_safe_error='PRE_NETWORK_CRASH_STATE_PRESERVED'
     and i.safe_blocking_reason='PRE_NETWORK_CRASH_STATE_PRESERVED';
  if row_count_value <> 1 then raise exception 'PRE_NETWORK_CRASH_NOT_PRESERVED'; end if;
  mutation_ok := public.dte_retry_blocked_issuance(tenant_id_value,auto_crash);
  if mutation_ok then raise exception 'PRE_NETWORK_CRASH_WAS_REQUEUED'; end if;

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin,
    production_document_id,network_attempt_count
  ) values(
    auto_ambiguous,tenant_id_value,'auto-ambiguous','webpay','auto-ambiguous',
    'invoice',33,1190,'CLP','{}','SUBMITTING','automatic_payment',
    ambiguous_document,1
  );
  insert into public.dte_production_documents(id,tenant_id,status)
  values(ambiguous_document,tenant_id_value,'ready');
  insert into public.dte_production_submission_attempts(
    id,tenant_id,document_id,before_fetch_at,status
  ) values(ambiguous_attempt,tenant_id_value,ambiguous_document,now(),'uploading');
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin,locked_by,claim_token,
    lease_expires_at,network_attempts
  ) values(
    outbox_ambiguous,tenant_id_value,auto_ambiguous,'PROCESSING','automatic_system',
    'ambiguous-auto','81000000-0000-4000-8000-000000000002',
    now()-interval '1 minute',1
  );
  perform public.dte_claim_automatic_issuance_outbox('auto-ambiguous-recovery');
  select count(*) into row_count_value
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i on i.id=o.intent_id
   where o.id=outbox_ambiguous and o.status='AMBIGUOUS' and i.status='AMBIGUOUS'
     and o.last_safe_error='NETWORK_RESULT_UNKNOWN';
  if row_count_value <> 1 then raise exception 'NETWORK_STATE_NOT_AMBIGUOUS'; end if;

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values(
    auto_pre_gate,tenant_id_value,'auto-pre-gate','webpay','auto-pre-gate',
    'invoice',33,1190,'CLP','{}','PENDING','automatic_payment'
  );
  insert into public.dte_issuance_outbox(id,tenant_id,intent_id,status,issuance_origin)
  values(outbox_pre_gate,tenant_id_value,auto_pre_gate,'PENDING','automatic_system');
  select * into claimed from public.dte_claim_automatic_issuance_outbox_exact(
    'auto-pre-gate-worker',outbox_pre_gate
  );
  update public.dte_tenant_issuance_settings
     set issuance_mode='manual' where tenant_id=tenant_id_value;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'RENEW'
  );
  if mutation_ok then raise exception 'PRE_NETWORK_GATE_ALLOWED_MUTATION'; end if;
  select count(*) into row_count_value
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i on i.id=o.intent_id
   where o.id=outbox_pre_gate and o.status='BLOCKED' and i.status='BLOCKED'
     and o.network_attempts=0 and i.network_attempt_count=0
     and o.last_safe_error='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     and o.claim_token is null;
  if row_count_value <> 1 then raise exception 'PRE_NETWORK_GATE_DID_NOT_BLOCK'; end if;
  update public.dte_tenant_issuance_settings
     set issuance_mode='automatic_on_verified_payment' where tenant_id=tenant_id_value;

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values(
    auto_operational_gate,tenant_id_value,'auto-operational-gate','webpay',
    'auto-operational-gate','invoice',33,1190,'CLP','{}','PENDING','automatic_payment'
  );
  insert into public.dte_issuance_outbox(id,tenant_id,intent_id,status,issuance_origin)
  values(
    outbox_operational_gate,tenant_id_value,auto_operational_gate,
    'PENDING','automatic_system'
  );
  select * into claimed from public.dte_claim_automatic_issuance_outbox_exact(
    'auto-operational-gate-worker',outbox_operational_gate
  );
  update public.tenants set operational_mode='demo' where id=tenant_id_value;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'RENEW'
  );
  if mutation_ok then raise exception 'OPERATIONAL_MODE_GATE_ALLOWED_MUTATION'; end if;
  select count(*) into row_count_value from public.dte_issuance_outbox
   where id=outbox_operational_gate and status='BLOCKED'
     and network_attempts=0 and last_safe_error='AUTOMATIC_GATE_CLOSED_PRE_NETWORK';
  if row_count_value <> 1 then raise exception 'OPERATIONAL_MODE_GATE_DID_NOT_BLOCK'; end if;
  update public.tenants set operational_mode='live' where id=tenant_id_value;

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values(
    auto_mid_gate,tenant_id_value,'auto-mid-gate','webpay','auto-mid-gate',
    'invoice',33,1190,'CLP','{}','PENDING','automatic_payment'
  );
  insert into public.dte_issuance_outbox(id,tenant_id,intent_id,status,issuance_origin)
  values(outbox_mid_gate,tenant_id_value,auto_mid_gate,'PENDING','automatic_system');
  insert into public.dte_production_documents(id,tenant_id,status)
  values(mid_document,tenant_id_value,'ready');
  select * into claimed from public.dte_claim_automatic_issuance_outbox_exact(
    'auto-mid-gate-worker',outbox_mid_gate
  );
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'PREPARING',mid_document
  );
  if not mutation_ok then raise exception 'MID_GATE_PREPARING_FAILED'; end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'READY',mid_document
  );
  if not mutation_ok then raise exception 'MID_GATE_READY_FAILED'; end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'SUBMITTING',mid_document
  );
  if not mutation_ok then raise exception 'MID_GATE_SUBMITTING_FAILED'; end if;
  insert into public.dte_production_submission_attempts(
    id,tenant_id,document_id,before_fetch_at,status
  ) values(mid_attempt,tenant_id_value,mid_document,null,'persisted');
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'NETWORK_BOUNDARY',
    mid_document,null,null,null,null,'{}',mid_attempt,'seed_before_fetch'
  );
  if not mutation_ok then raise exception 'MID_GATE_FIRST_BOUNDARY_FAILED'; end if;
  update public.dte_tenant_issuance_settings
     set issuance_mode='manual' where tenant_id=tenant_id_value;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'NETWORK_BOUNDARY',
    mid_document,null,null,null,null,'{}',mid_attempt,'token_before_fetch'
  );
  if mutation_ok then raise exception 'MID_GATE_SECOND_BOUNDARY_ALLOWED'; end if;
  select count(*) into row_count_value
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i on i.id=o.intent_id
   where o.id=outbox_mid_gate and o.status='AMBIGUOUS' and i.status='AMBIGUOUS'
     and o.network_attempts=1 and i.network_attempt_count=1
     and o.last_safe_error='AUTOMATIC_GATE_CLOSED_POST_NETWORK';
  if row_count_value <> 1 then raise exception 'MID_GATE_NOT_AMBIGUOUS'; end if;
  update public.dte_tenant_issuance_settings
     set issuance_mode='automatic_on_verified_payment' where tenant_id=tenant_id_value;

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values(
    auto_post_gate,tenant_id_value,'auto-post-gate','webpay','auto-post-gate',
    'invoice',33,1190,'CLP','{}','PENDING','automatic_payment'
  );
  insert into public.dte_issuance_outbox(id,tenant_id,intent_id,status,issuance_origin)
  values(outbox_post_gate,tenant_id_value,auto_post_gate,'PENDING','automatic_system');
  insert into public.dte_production_documents(id,tenant_id,status)
  values(post_document,tenant_id_value,'ready');
  select * into claimed from public.dte_claim_automatic_issuance_outbox_exact(
    'auto-post-gate-worker',outbox_post_gate
  );
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'PREPARING',post_document
  );
  if not mutation_ok then raise exception 'PREPARING_MUTATION_FAILED'; end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'READY',post_document
  );
  if not mutation_ok then raise exception 'READY_MUTATION_FAILED'; end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'SUBMITTING',post_document
  );
  if not mutation_ok then raise exception 'SUBMITTING_MUTATION_FAILED'; end if;
  insert into public.dte_production_submission_attempts(
    id,tenant_id,document_id,before_fetch_at,status
  ) values(post_attempt,tenant_id_value,post_document,null,'persisted');
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'NETWORK_BOUNDARY',
    post_document,null,null,null,null,'{}',post_attempt,'upload_before_fetch'
  );
  if not mutation_ok then raise exception 'NETWORK_BOUNDARY_MUTATION_FAILED'; end if;
  update public.dte_tenant_issuance_settings
     set issuance_mode='manual' where tenant_id=tenant_id_value;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'COMPLETE',
    post_document,'SUBMITTED'
  );
  if not mutation_ok then raise exception 'POST_NETWORK_TERMINAL_PERSISTENCE_BLOCKED'; end if;
  select count(*) into row_count_value
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i on i.id=o.intent_id
    join public.dte_production_submission_attempts s
      on s.document_id=i.production_document_id
   where o.id=outbox_post_gate and o.status='COMPLETED' and i.status='SUBMITTED'
     and o.network_attempts=1 and i.network_attempt_count=1
     and s.before_fetch_at is not null;
  if row_count_value <> 1 then raise exception 'POST_NETWORK_EVIDENCE_NOT_PERSISTED'; end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'NETWORK_BOUNDARY',
    post_document,null,null,null,null,'{}',post_attempt,'upload_before_fetch'
  );
  if mutation_ok then raise exception 'SECOND_NETWORK_BOUNDARY_ALLOWED'; end if;
end;
$$;
select 'DTE_AUTOMATIC_HARDENING_SQL_ASSERTIONS_PASSED=15';
rollback;
`;

const ownedLastFolioAssertions = String.raw`
begin;

create table public.cit33_activation_controls(
  tenant_id uuid primary key,
  certificate_current jsonb not null default 'true'::jsonb
);

create or replace function public.dte_activation_gate_report(
  p_tenant_id uuid,
  p_dte_type integer,
  p_global_feature_enabled boolean
) returns jsonb
language sql
stable
set search_path = ''
as $$
  with gates as (
    select pg_catalog.jsonb_build_object(
      'issuerDataExact', true,
      'issuerLegalNameMatch', true,
      'issuerResolutionConfigured', true,
      'typeAuthorized', true,
      'certificateCurrent', coalesce(
        (
          select controls.certificate_current
            from public.cit33_activation_controls controls
           where controls.tenant_id = p_tenant_id
        ),
        'true'::jsonb
      ),
      'certificateKeyMatch', true,
      'certificateRutMatch', true,
      'officialTrustAnchor', true,
      'authenticTypeCaf', true,
      'foliosAvailable', exists (
        select 1
          from public.dte_production_folio_ledger ledger
         where ledger.tenant_id = p_tenant_id
           and ledger.dte_type = p_dte_type
           and ledger.state = 'available'
      ),
      'tenantAwareLedger', true,
      'privateStorage', true,
      'productionEndpoints', true,
      'officialXsd', true,
      'xmlDsig', true,
      'workerConfigured', true,
      'migrationsApplied', true,
      'offlinePreflightComplete', true,
      'documentEngineReady', p_dte_type in (33,39),
      'globalFeatureEnabled', p_global_feature_enabled
    ) as value
  )
  select gates.value || pg_catalog.jsonb_build_object(
    'ready', not exists (
      select 1
        from pg_catalog.jsonb_each(gates.value) entry
       where entry.value is distinct from 'true'::jsonb
    )
  )
  from gates;
$$;

do $$
declare
  tenant_id_value constant uuid := '12000000-0000-4000-8000-000000000001';
  other_tenant_id constant uuid := '12000000-0000-4000-8000-000000000002';
  intent_id_value constant uuid := '22000000-0000-4000-8000-000000000001';
  outbox_id_value constant uuid := '32000000-0000-4000-8000-000000000001';
  document_id_value constant uuid := '42000000-0000-4000-8000-000000000001';
  other_document_id constant uuid := '42000000-0000-4000-8000-000000000002';
  caf_id_value constant uuid := '52000000-0000-4000-8000-000000000001';
  type39_customer_id constant uuid := '62000000-0000-4000-8000-000000000001';
  type39_actor_id constant uuid := '62000000-0000-4000-8000-000000000002';
  type39_intent_id constant uuid := '22000000-0000-4000-8000-000000000039';
  type39_outbox_id constant uuid := '32000000-0000-4000-8000-000000000039';
  type39_document_id constant uuid := '42000000-0000-4000-8000-000000000039';
  type39_caf_id constant uuid := '52000000-0000-4000-8000-000000000039';
  claim public.dte_issuance_outbox%rowtype;
  report jsonb;
  mutation_ok boolean;
  row_count_value integer;
begin
  insert into public.tenants(id) values(tenant_id_value),(other_tenant_id);
  insert into public.dte_tenant_issuance_settings values(
    tenant_id_value,'automatic_on_verified_payment','39',true,true,'approved',
    true,now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_id_value,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values(tenant_id_value,33,'active');
  insert into public.cit33_activation_controls
  values(tenant_id_value,'true'::jsonb);

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values(
    intent_id_value,tenant_id_value,'cit33-owned-last','webpay',
    'cit33-owned-last','invoice',33,1190,'CLP','{}','PENDING',
    'automatic_payment'
  );
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin
  ) values(
    outbox_id_value,tenant_id_value,intent_id_value,'PENDING','automatic_system'
  );
  insert into public.dte_production_documents(
    id,tenant_id,dte_type,business_operation_id,status,folio,caf_id
  ) values
    (document_id_value,tenant_id_value,33,'intent:cit33-owned','draft',null,null),
    (other_document_id,tenant_id_value,33,'intent:cit33-other','draft',null,null);
  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state
  ) values(tenant_id_value,33,40017,caf_id_value,'available');

  report := public.dte_activation_gate_report(tenant_id_value,33,true);
  if report -> 'ready' <> 'true'::jsonb
     or report -> 'foliosAvailable' <> 'true'::jsonb then
    raise exception 'CIT33_INITIAL_REPORT_NOT_READY';
  end if;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then
    raise exception 'CIT33_INITIAL_LAST_FOLIO_GATE_CLOSED';
  end if;

  select * into claim
    from public.dte_claim_automatic_issuance_outbox_exact(
      'cit33-worker',outbox_id_value
    );
  if claim.id <> outbox_id_value then
    raise exception 'CIT33_INITIAL_CLAIM_FAILED';
  end if;

  update public.dte_production_folio_ledger
     set state='reserved',document_id=document_id_value,
         business_operation_id='intent:cit33-owned',reserved_at=now()
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;

  report := public.dte_activation_gate_report(tenant_id_value,33,true);
  if report -> 'ready' <> 'false'::jsonb
     or report -> 'foliosAvailable' <> 'false'::jsonb then
    raise exception 'CIT33_EXHAUSTED_REPORT_SHAPE_INVALID';
  end if;
  select pg_catalog.count(*) into row_count_value
    from pg_catalog.jsonb_each(report) entry
   where entry.key not in ('ready','foliosAvailable')
     and entry.value is distinct from 'true'::jsonb;
  if row_count_value <> 0 then
    raise exception 'CIT33_REPORT_HAS_NON_FOLIO_FAILURE';
  end if;

  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then
    raise exception 'CIT33_NO_OWN_DOCUMENT_GATE_OPENED';
  end if;
  begin
    mutation_ok := public.dte_mutate_automatic_issuance_claim(
      claim.id,claim.locked_by,claim.claim_token,'RENEW'
    );
    if mutation_ok then raise exception 'CIT33_NO_OWN_DOCUMENT_MUTATION_ALLOWED'; end if;
    select pg_catalog.count(*) into row_count_value
      from public.dte_issuance_outbox outbox
      join public.dte_payment_document_intents intent on intent.id=outbox.intent_id
     where outbox.id=outbox_id_value
       and outbox.status='BLOCKED'
       and intent.status='BLOCKED'
       and outbox.last_safe_error='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
       and intent.safe_blocking_reason='AUTOMATIC_GATE_CLOSED_PRE_NETWORK';
    if row_count_value <> 1 then
      raise exception 'CIT33_NO_OWN_DOCUMENT_NOT_BLOCKED';
    end if;
    raise exception 'CIT33_ROLLBACK_EXPECTED_NO_DOCUMENT';
  exception when raise_exception then
    if sqlerrm <> 'CIT33_ROLLBACK_EXPECTED_NO_DOCUMENT' then raise; end if;
  end;

  update public.dte_payment_document_intents
     set production_document_id=document_id_value,status='PREPARING'
   where id=intent_id_value;
  update public.dte_production_folio_ledger
     set document_id=other_document_id,
         business_operation_id='intent:cit33-other'
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then
    raise exception 'CIT33_OTHER_RESERVATION_GATE_OPENED';
  end if;
  begin
    mutation_ok := public.dte_mutate_automatic_issuance_claim(
      claim.id,claim.locked_by,claim.claim_token,'RENEW'
    );
    if mutation_ok then raise exception 'CIT33_OTHER_RESERVATION_MUTATION_ALLOWED'; end if;
    select pg_catalog.count(*) into row_count_value
      from public.dte_issuance_outbox outbox
      join public.dte_payment_document_intents intent on intent.id=outbox.intent_id
     where outbox.id=outbox_id_value
       and outbox.status='BLOCKED'
       and intent.status='BLOCKED'
       and outbox.last_safe_error='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
       and intent.safe_blocking_reason='AUTOMATIC_GATE_CLOSED_PRE_NETWORK';
    if row_count_value <> 1 then
      raise exception 'CIT33_OTHER_RESERVATION_NOT_BLOCKED';
    end if;
    raise exception 'CIT33_ROLLBACK_EXPECTED_OTHER_RESERVATION';
  exception when raise_exception then
    if sqlerrm <> 'CIT33_ROLLBACK_EXPECTED_OTHER_RESERVATION' then raise; end if;
  end;

  update public.dte_production_folio_ledger
     set document_id=document_id_value,
         business_operation_id='intent:cit33-owned'
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then
    raise exception 'CIT33_OWN_DRAFT_RESERVATION_GATE_CLOSED';
  end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'RENEW'
  );
  if not mutation_ok then
    raise exception 'CIT33_OWN_RESERVED_MUTATION_BLOCKED';
  end if;

  update public.dte_production_documents
     set tenant_id=other_tenant_id where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_DOCUMENT_TENANT_MISMATCH_ALLOWED'; end if;
  update public.dte_production_documents
     set tenant_id=tenant_id_value where id=document_id_value;

  update public.dte_production_folio_ledger
     set tenant_id=other_tenant_id
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_LEDGER_TENANT_MISMATCH_ALLOWED'; end if;
  update public.dte_production_folio_ledger
     set tenant_id=tenant_id_value
   where tenant_id=other_tenant_id and dte_type=33 and folio=40017;

  update public.dte_production_documents
     set dte_type=39 where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_DOCUMENT_TYPE_MISMATCH_ALLOWED'; end if;
  update public.dte_production_documents
     set dte_type=33 where id=document_id_value;

  update public.dte_payment_document_intents
     set resolved_dte_type=41 where id=intent_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_UNSUPPORTED_TYPE_ALLOWED'; end if;
  update public.dte_payment_document_intents
     set resolved_dte_type=33 where id=intent_id_value;

  update public.dte_production_documents
     set folio=40018 where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_DRAFT_FOLIO_MISMATCH_ALLOWED'; end if;
  update public.dte_production_documents
     set folio=null where id=document_id_value;

  update public.dte_production_documents
     set caf_id='52000000-0000-4000-8000-000000000099'
   where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_DRAFT_CAF_MISMATCH_ALLOWED'; end if;
  update public.dte_production_documents
     set caf_id=null where id=document_id_value;

  update public.dte_production_documents
     set business_operation_id=' ' where id=document_id_value;
  update public.dte_production_folio_ledger
     set business_operation_id=' '
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_EMPTY_BUSINESS_OPERATION_ALLOWED'; end if;
  update public.dte_production_documents
     set business_operation_id='intent:cit33-owned' where id=document_id_value;
  update public.dte_production_folio_ledger
     set business_operation_id='intent:cit33-wrong'
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_BUSINESS_OPERATION_MISMATCH_ALLOWED'; end if;
  update public.dte_production_folio_ledger
     set business_operation_id='intent:cit33-owned'
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;

  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state,document_id,business_operation_id
  ) values(
    tenant_id_value,33,40018,caf_id_value,'reserved',document_id_value,
    'intent:cit33-duplicate'
  );
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_AMBIGUOUS_DOCUMENT_OWNERSHIP_ALLOWED'; end if;
  delete from public.dte_production_folio_ledger
   where tenant_id=tenant_id_value and dte_type=33 and folio=40018;

  update public.dte_production_documents
     set status='prepared',folio=null,caf_id=null where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_PREPARED_WITHOUT_FOLIO_CAF_ALLOWED'; end if;
  update public.dte_production_documents
     set folio=40017,caf_id=caf_id_value where id=document_id_value;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_PREPARED_MATCHING_RESERVATION_BLOCKED'; end if;

  update public.dte_production_documents
     set status='submitting' where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_RESERVED_SUBMITTING_DOCUMENT_ALLOWED'; end if;
  update public.dte_production_folio_ledger
     set state='issued',issued_at=now()
   where tenant_id=tenant_id_value and dte_type=33 and folio=40017;
  update public.dte_production_documents
     set status='ready' where id=document_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_ISSUED_READY_DOCUMENT_ALLOWED'; end if;
  update public.dte_production_documents
     set status='submitting' where id=document_id_value;
  update public.dte_payment_document_intents
     set status='SUBMITTING' where id=intent_id_value;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_OWN_ISSUED_SUBMITTING_GATE_CLOSED'; end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'RENEW'
  );
  if not mutation_ok then
    raise exception 'CIT33_OWN_ISSUED_MUTATION_BLOCKED';
  end if;

  update public.cit33_activation_controls
     set certificate_current='"invalid"'::jsonb where tenant_id=tenant_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then
    raise exception 'CIT33_INVALID_NON_FOLIO_GATE_ALLOWED';
  end if;

  update public.cit33_activation_controls
     set certificate_current='false'::jsonb where tenant_id=tenant_id_value;
  report := public.dte_activation_gate_report(tenant_id_value,33,true);
  if report -> 'certificateCurrent' <> 'false'::jsonb
     or report -> 'ready' <> 'false'::jsonb then
    raise exception 'CIT33_OTHER_FALSE_GATE_REPORT_INVALID';
  end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'RENEW'
  );
  if mutation_ok then
    raise exception 'CIT33_NON_FOLIO_FALSE_GATE_ALLOWED';
  end if;
  select pg_catalog.count(*) into row_count_value
    from public.dte_issuance_outbox outbox
    join public.dte_payment_document_intents intent on intent.id=outbox.intent_id
   where outbox.id=outbox_id_value
     and outbox.status='BLOCKED'
     and intent.status='BLOCKED'
     and outbox.last_safe_error='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     and intent.safe_blocking_reason='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     and outbox.network_attempts=0
     and intent.network_attempt_count=0;
  if row_count_value <> 1 then
    raise exception 'CIT33_OTHER_GATE_DID_NOT_BLOCK_PRE_NETWORK';
  end if;

  -- Material regression for the production bug's DTE 39 path, including its
  -- mandatory commercial-customer snapshot gate. Everything remains local and
  -- stops before NETWORK_BOUNDARY.
  update public.cit33_activation_controls
     set certificate_current='true'::jsonb where tenant_id=tenant_id_value;
  insert into public.dte_legal_activation values(tenant_id_value,39,'active');
  insert into public.customers(id,tenant_id,full_name)
  values(type39_customer_id,tenant_id_value,'Cliente Boleta 39');
  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,
    origin,customer_id
  ) values(
    type39_intent_id,tenant_id_value,'cit33-type39-owned-last','webpay',
    'cit33-type39-owned-last','consumer',39,1000,'CLP','{}','PENDING',
    'automatic_payment',type39_customer_id
  );
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin
  ) values(
    type39_outbox_id,tenant_id_value,type39_intent_id,'PENDING',
    'automatic_system'
  );
  insert into public.dte_production_documents(
    id,tenant_id,dte_type,business_operation_id,status,folio,caf_id
  ) values(
    type39_document_id,tenant_id_value,39,'intent:cit33-type39-owned',
    'draft',null,null
  );
  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state
  ) values(tenant_id_value,39,50001,type39_caf_id,'available');

  select pg_catalog.count(*) into row_count_value
    from public.dte_payment_document_intents intent
   where intent.id=type39_intent_id
     and intent.tenant_id=tenant_id_value
     and intent.resolved_dte_type=39
     and intent.customer_id=type39_customer_id
     and intent.production_document_id is null;
  if row_count_value <> 1 then
    raise exception 'CIT33_TYPE39_INTENT_FIXTURE_INVALID';
  end if;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,type39_intent_id
  ) then
    raise exception 'CIT33_TYPE39_WITHOUT_SNAPSHOT_GATE_OPENED';
  end if;

  insert into public.dte_boleta39_commercial_customer_snapshots(
    intent_id,tenant_id,customer_id,customer_name,customer_rut,
    customer_email,customer_phone,captured_by
  ) values(
    type39_intent_id,tenant_id_value,type39_customer_id,'Cliente Boleta 39',
    null,'cliente39@example.test',null,type39_actor_id
  );
  select pg_catalog.count(*) into row_count_value
    from public.dte_production_folio_ledger ledger
   where ledger.tenant_id=tenant_id_value
     and ledger.dte_type=39
     and ledger.state='available';
  if row_count_value <> 1 then
    raise exception 'CIT33_TYPE39_INITIAL_AVAILABLE_FOLIO_COUNT_INVALID';
  end if;
  report := public.dte_activation_gate_report(tenant_id_value,39,true);
  if report -> 'ready' <> 'true'::jsonb
     or report -> 'foliosAvailable' <> 'true'::jsonb then
    raise exception 'CIT33_TYPE39_INITIAL_REPORT_NOT_READY';
  end if;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,type39_intent_id
  ) then
    raise exception 'CIT33_TYPE39_VALID_SNAPSHOT_GATE_CLOSED';
  end if;

  select * into claim
    from public.dte_claim_automatic_issuance_outbox_exact(
      'cit33-type39-worker',type39_outbox_id
    );
  if claim.id <> type39_outbox_id or claim.intent_id <> type39_intent_id then
    raise exception 'CIT33_TYPE39_EXACT_CLAIM_FAILED';
  end if;

  update public.dte_production_folio_ledger
     set state='reserved',document_id=type39_document_id,
         business_operation_id='intent:cit33-type39-owned',reserved_at=now()
   where tenant_id=tenant_id_value and dte_type=39 and folio=50001;
  report := public.dte_activation_gate_report(tenant_id_value,39,true);
  if report -> 'ready' <> 'false'::jsonb
     or report -> 'foliosAvailable' <> 'false'::jsonb then
    raise exception 'CIT33_TYPE39_LAST_FOLIO_REPORT_INVALID';
  end if;

  update public.dte_payment_document_intents
     set production_document_id=type39_document_id,status='PREPARING'
   where id=type39_intent_id and tenant_id=tenant_id_value;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,type39_intent_id
  ) then
    raise exception 'CIT33_TYPE39_OWN_DRAFT_RESERVATION_GATE_CLOSED';
  end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'RENEW'
  );
  if not mutation_ok then
    raise exception 'CIT33_TYPE39_OWN_RESERVED_RENEW_BLOCKED';
  end if;

  update public.dte_production_documents
     set status='prepared',folio=50001,caf_id=type39_caf_id
   where id=type39_document_id and tenant_id=tenant_id_value;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,type39_intent_id
  ) then
    raise exception 'CIT33_TYPE39_PREPARED_RESERVATION_GATE_CLOSED';
  end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'READY',type39_document_id
  );
  if not mutation_ok then
    raise exception 'CIT33_TYPE39_READY_MUTATION_BLOCKED';
  end if;
  update public.dte_production_documents
     set status='ready' where id=type39_document_id and tenant_id=tenant_id_value;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'SUBMITTING',type39_document_id
  );
  if not mutation_ok then
    raise exception 'CIT33_TYPE39_SUBMITTING_MUTATION_BLOCKED';
  end if;

  update public.dte_production_documents
     set status='submitting'
   where id=type39_document_id and tenant_id=tenant_id_value;
  update public.dte_production_folio_ledger
     set state='issued',issued_at=now()
   where tenant_id=tenant_id_value and dte_type=39 and folio=50001;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,type39_intent_id
  ) then
    raise exception 'CIT33_TYPE39_OWN_ISSUED_SUBMITTING_GATE_CLOSED';
  end if;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claim.id,claim.locked_by,claim.claim_token,'RENEW'
  );
  if not mutation_ok then
    raise exception 'CIT33_TYPE39_OWN_ISSUED_RENEW_BLOCKED';
  end if;

  select pg_catalog.count(*) into row_count_value
    from public.dte_payment_document_intents intent
    join public.dte_issuance_outbox outbox
      on outbox.tenant_id=intent.tenant_id and outbox.intent_id=intent.id
   where intent.id=type39_intent_id
     and intent.status='SUBMITTING'
     and intent.network_attempt_count=0
     and outbox.id=type39_outbox_id
     and outbox.status='PROCESSING'
     and outbox.network_attempts=0
     and not exists (
       select 1
         from public.dte_production_submission_attempts submission
        where submission.tenant_id=intent.tenant_id
          and submission.document_id=type39_document_id
          and submission.before_fetch_at is not null
     );
  if row_count_value <> 1 then
    raise exception 'CIT33_TYPE39_PRE_NETWORK_EVIDENCE_INVALID';
  end if;
end;
$$;

select 'CIT33_OWNED_LAST_FOLIO_SQL_ASSERTIONS_PASSED=47';
rollback;
`;

const ownedFolioResumeAssertions = String.raw`
begin;

create table public.cit33_resume_activation_controls(
  tenant_id uuid primary key,
  certificate_current jsonb not null default 'true'::jsonb
);

create or replace function public.dte_activation_gate_report(
  p_tenant_id uuid,
  p_dte_type integer,
  p_global_feature_enabled boolean
) returns jsonb
language sql
stable
set search_path = ''
as $$
  with gates as (
    select pg_catalog.jsonb_build_object(
      'issuerDataExact', true,
      'issuerLegalNameMatch', true,
      'issuerResolutionConfigured', true,
      'typeAuthorized', true,
      'certificateCurrent', coalesce(
        (
          select controls.certificate_current
            from public.cit33_resume_activation_controls controls
           where controls.tenant_id = p_tenant_id
        ),
        'true'::jsonb
      ),
      'certificateKeyMatch', true,
      'certificateRutMatch', true,
      'officialTrustAnchor', true,
      'authenticTypeCaf', true,
      'foliosAvailable', exists (
        select 1
          from public.dte_production_folio_ledger ledger
         where ledger.tenant_id = p_tenant_id
           and ledger.dte_type = p_dte_type
           and ledger.state = 'available'
      ),
      'tenantAwareLedger', true,
      'privateStorage', true,
      'productionEndpoints', true,
      'officialXsd', true,
      'xmlDsig', true,
      'workerConfigured', true,
      'migrationsApplied', true,
      'offlinePreflightComplete', true,
      'documentEngineReady', p_dte_type in (33,39),
      'globalFeatureEnabled', p_global_feature_enabled
    ) as value
  )
  select gates.value || pg_catalog.jsonb_build_object(
    'ready', not exists (
      select 1
        from pg_catalog.jsonb_each(gates.value) entry
       where entry.value is distinct from 'true'::jsonb
    )
  )
  from gates;
$$;

create or replace function public.cit33_expect_owned_resume_failure(
  p_outbox_id uuid
) returns void
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform public.dte_claim_automatic_owned_folio_resume_exact(
      'cit33-resume-negative',
      p_outbox_id
    );
    raise exception 'CIT33_EXPECTED_RESUME_FAILURE_NOT_RAISED';
  exception when others then
    if sqlerrm not like 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_%' then
      raise;
    end if;
  end;
end;
$$;

do $$
declare
  tenant_id_value constant uuid := '13000000-0000-4000-8000-000000000001';
  other_tenant_id constant uuid := '13000000-0000-4000-8000-000000000002';
  customer_id_value constant uuid := '23000000-0000-4000-8000-000000000001';
  actor_id_value constant uuid := '23000000-0000-4000-8000-000000000002';
  intent_id_value constant uuid := '33000000-0000-4000-8000-000000000001';
  other_intent_id constant uuid := '33000000-0000-4000-8000-000000000002';
  outbox_id_value constant uuid := '43000000-0000-4000-8000-000000000001';
  other_outbox_id constant uuid := '43000000-0000-4000-8000-000000000002';
  document_id_value constant uuid := '53000000-0000-4000-8000-000000000001';
  other_document_id constant uuid := '53000000-0000-4000-8000-000000000002';
  caf_id_value constant uuid := '63000000-0000-4000-8000-000000000001';
  claimed public.dte_issuance_outbox%rowtype;
  mutation_ok boolean;
  row_count_value integer;
begin
  insert into public.tenants(id) values(tenant_id_value),(other_tenant_id);
  insert into public.customers(id,tenant_id,full_name)
  values(customer_id_value,tenant_id_value,'Cliente Recuperación 39');
  insert into public.dte_tenant_issuance_settings values(
    tenant_id_value,'automatic_on_verified_payment','39',true,true,'approved',
    true,now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_id_value,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values(tenant_id_value,39,'active');
  insert into public.cit33_resume_activation_controls
  values(tenant_id_value,'true'::jsonb);

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,
    safe_blocking_reason,production_document_id,deterministic_retry_count,
    network_attempt_count,origin,customer_id
  ) values(
    intent_id_value,tenant_id_value,'cit33-resume-39','webpay',
    'cit33-resume-39','consumer',39,1000,'CLP','{}','BLOCKED',
    'AUTOMATIC_GATE_CLOSED_PRE_NETWORK',document_id_value,1,0,
    'automatic_payment',customer_id_value
  ),(
    other_intent_id,tenant_id_value,'cit33-resume-other','webpay',
    'cit33-resume-other','consumer',39,1000,'CLP','{}','PENDING',
    null,null,0,0,'automatic_payment',customer_id_value
  );
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin,deterministic_attempts,
    network_attempts,last_safe_error
  ) values(
    outbox_id_value,tenant_id_value,intent_id_value,'BLOCKED',
    'automatic_system',1,0,'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
  ),(
    other_outbox_id,tenant_id_value,other_intent_id,'PENDING',
    'automatic_system',0,0,null
  );
  insert into public.dte_production_documents(
    id,tenant_id,dte_type,business_operation_id,status,folio,caf_id
  ) values(
    document_id_value,tenant_id_value,39,'intent:cit33-resume-39',
    'draft',null,null
  ),(
    other_document_id,tenant_id_value,39,'intent:cit33-resume-other',
    'draft',null,null
  );
  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state,document_id,
    business_operation_id,reserved_at
  ) values(
    tenant_id_value,39,40017,caf_id_value,'reserved',document_id_value,
    'intent:cit33-resume-39',now()
  );
  insert into public.dte_boleta39_commercial_customer_snapshots(
    intent_id,tenant_id,customer_id,customer_name,customer_email,captured_by
  ) values(
    intent_id_value,tenant_id_value,customer_id_value,
    'Cliente Recuperación 39','resume39@example.test',actor_id_value
  );

  select pg_catalog.count(*) into row_count_value
    from public.dte_production_folio_ledger ledger
   where ledger.tenant_id=tenant_id_value
     and ledger.dte_type=39
     and ledger.state='available';
  if row_count_value <> 0 then
    raise exception 'CIT33_RESUME_AVAILABLE_FOLIO_PRESENT';
  end if;
  if not public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then
    raise exception 'CIT33_RESUME_OWNED_GATE_CLOSED';
  end if;

  begin
    perform public.dte_claim_automatic_issuance_outbox_exact(
      'cit33-normal-claim',outbox_id_value
    );
    raise exception 'CIT33_NORMAL_CLAIM_ACCEPTED_EXISTING_DOCUMENT';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE%' then raise; end if;
  end;

  perform public.cit33_expect_owned_resume_failure(
    '99999999-9999-4999-8999-999999999999'
  );
  select pg_catalog.count(*) into row_count_value
    from public.dte_issuance_outbox
   where id in (outbox_id_value,other_outbox_id)
     and status in ('BLOCKED','PENDING');
  if row_count_value <> 2 then
    raise exception 'CIT33_RESUME_WRONG_TARGET_TOUCHED_OUTBOX';
  end if;

  update public.dte_payment_document_intents
     set safe_blocking_reason='OTHER_REASON' where id=intent_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_payment_document_intents
     set safe_blocking_reason='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
   where id=intent_id_value;
  update public.dte_issuance_outbox
     set last_safe_error='OTHER_REASON' where id=outbox_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_issuance_outbox
     set last_safe_error='AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
   where id=outbox_id_value;

  update public.dte_payment_document_intents
     set network_attempt_count=1 where id=intent_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_payment_document_intents
     set network_attempt_count=0 where id=intent_id_value;
  update public.dte_issuance_outbox
     set network_attempts=1 where id=outbox_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_issuance_outbox
     set network_attempts=0 where id=outbox_id_value;
  update public.dte_issuance_outbox
     set deterministic_attempts=3 where id=outbox_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_issuance_outbox
     set deterministic_attempts=1 where id=outbox_id_value;

  insert into public.dte_production_submission_attempts(
    tenant_id,document_id,before_fetch_at,status
  ) values(tenant_id_value,document_id_value,null,'persisted');
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  delete from public.dte_production_submission_attempts
   where tenant_id=tenant_id_value and document_id=document_id_value;

  update public.dte_production_documents
     set tenant_id=other_tenant_id where id=document_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_production_documents
     set tenant_id=tenant_id_value where id=document_id_value;
  update public.dte_production_documents
     set dte_type=33 where id=document_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_production_documents
     set dte_type=39 where id=document_id_value;
  update public.dte_payment_document_intents
     set production_document_id=other_document_id where id=intent_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_payment_document_intents
     set production_document_id=document_id_value where id=intent_id_value;

  update public.dte_production_folio_ledger
     set document_id=other_document_id
   where tenant_id=tenant_id_value and dte_type=39 and folio=40017;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_production_folio_ledger
     set document_id=document_id_value
   where tenant_id=tenant_id_value and dte_type=39 and folio=40017;
  update public.dte_production_folio_ledger
     set business_operation_id='intent:cit33-wrong-operation'
   where tenant_id=tenant_id_value and dte_type=39 and folio=40017;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_production_folio_ledger
     set business_operation_id='intent:cit33-resume-39'
   where tenant_id=tenant_id_value and dte_type=39 and folio=40017;

  update public.dte_production_documents
     set folio=40018 where id=document_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_production_documents
     set folio=null where id=document_id_value;
  update public.dte_production_documents
     set caf_id='63000000-0000-4000-8000-000000000099'
   where id=document_id_value;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_production_documents
     set caf_id=null where id=document_id_value;

  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state,document_id,business_operation_id
  ) values(
    tenant_id_value,39,40018,caf_id_value,'reserved',document_id_value,
    'intent:cit33-second-relation'
  );
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  delete from public.dte_production_folio_ledger
   where tenant_id=tenant_id_value and dte_type=39 and folio=40018;

  update public.cit33_resume_activation_controls
     set certificate_current='false'::jsonb where tenant_id=tenant_id_value;
  if public.dte_automatic_issuance_gate_open(
    tenant_id_value,intent_id_value
  ) then raise exception 'CIT33_RESUME_OTHER_FALSE_GATE_OPENED'; end if;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.cit33_resume_activation_controls
     set certificate_current='true'::jsonb where tenant_id=tenant_id_value;

  update public.dte_issuance_outbox
     set status='PROCESSING' where id=other_outbox_id;
  perform public.cit33_expect_owned_resume_failure(outbox_id_value);
  update public.dte_issuance_outbox
     set status='PENDING' where id=other_outbox_id;

  select * into claimed
    from public.dte_claim_automatic_owned_folio_resume_exact(
      'cit33-owned-resume-worker',outbox_id_value
    );
  if claimed.id <> outbox_id_value
     or claimed.intent_id <> intent_id_value
     or claimed.status <> 'PROCESSING'
     or claimed.locked_by <> 'cit33-owned-resume-worker'
     or claimed.claim_token is null
     or claimed.locked_at is null
     or claimed.lease_expires_at not between
       now()+interval '14 minutes' and now()+interval '16 minutes'
     or claimed.last_safe_error is not null
     or claimed.network_attempts <> 0
     or claimed.deterministic_attempts <> 1 then
    raise exception 'CIT33_RESUME_CLAIM_RESULT_INVALID';
  end if;

  select pg_catalog.count(*) into row_count_value
    from public.dte_payment_document_intents intent
   where intent.id=intent_id_value
     and intent.status='PENDING'
     and intent.safe_blocking_reason is null
     and intent.production_document_id=document_id_value
     and intent.network_attempt_count=0
     and intent.deterministic_retry_count=1;
  if row_count_value <> 1 then
    raise exception 'CIT33_RESUME_INTENT_MUTATION_INVALID';
  end if;
  select pg_catalog.count(*) into row_count_value
    from public.dte_production_documents document
   where document.id=document_id_value
     and document.tenant_id=tenant_id_value
     and document.dte_type=39
     and document.business_operation_id='intent:cit33-resume-39'
     and document.status='draft'
     and document.folio is null
     and document.caf_id is null;
  if row_count_value <> 1 then
    raise exception 'CIT33_RESUME_DOCUMENT_CHANGED';
  end if;
  select pg_catalog.count(*) into row_count_value
    from public.dte_production_folio_ledger ledger
   where ledger.tenant_id=tenant_id_value
     and ledger.dte_type=39
     and ledger.folio=40017
     and ledger.caf_id=caf_id_value
     and ledger.state='reserved'
     and ledger.document_id=document_id_value
     and ledger.business_operation_id='intent:cit33-resume-39';
  if row_count_value <> 1 then
    raise exception 'CIT33_RESUME_LEDGER_CHANGED';
  end if;

  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    claimed.id,claimed.locked_by,claimed.claim_token,'RENEW'
  );
  if not mutation_ok then
    raise exception 'CIT33_RESUME_INITIAL_RENEW_BLOCKED';
  end if;
  select pg_catalog.count(*) into row_count_value
    from public.dte_issuance_outbox outbox
    join public.dte_payment_document_intents intent
      on intent.tenant_id=outbox.tenant_id and intent.id=outbox.intent_id
   where outbox.id=outbox_id_value
     and outbox.status='PROCESSING'
     and outbox.network_attempts=0
     and intent.status='PENDING'
     and intent.network_attempt_count=0
     and not exists (
       select 1
         from public.dte_production_submission_attempts submission
        where submission.tenant_id=intent.tenant_id
          and submission.document_id=document_id_value
     )
     and not exists (
       select 1
         from public.dte_document_events event
        where event.tenant_id=intent.tenant_id
          and event.intent_id=intent.id
          and event.event_type like '%NETWORK_BOUNDARY%'
     );
  if row_count_value <> 1 then
    raise exception 'CIT33_RESUME_PRE_NETWORK_STATE_INVALID';
  end if;
  select pg_catalog.count(*) into row_count_value
    from public.dte_document_events event
   where event.tenant_id=tenant_id_value
     and event.intent_id=intent_id_value
     and event.production_document_id=document_id_value
     and event.event_type='AUTOMATIC_OWNED_FOLIO_RESUME_CLAIMED'
     and event.safe_metadata @> '{"automaticRetry":false,"exactTarget":true,"ownedFolioResume":true,"folioReused":40017,"additionalFolioReserved":false,"networkBoundaryCrossed":false}'::jsonb
     and not (event.safe_metadata ? 'claimToken');
  if row_count_value <> 1 then
    raise exception 'CIT33_RESUME_SAFE_EVENT_INVALID';
  end if;
  select pg_catalog.count(*) into row_count_value
    from public.dte_issuance_outbox
   where id=other_outbox_id and status='PENDING'
     and locked_by is null and claim_token is null;
  if row_count_value <> 1 then
    raise exception 'CIT33_RESUME_FELL_BACK_TO_OTHER_OUTBOX';
  end if;
end;
$$;

select 'CIT33_OWNED_FOLIO_RESUME_SQL_ASSERTIONS_PASSED=28';
rollback;
`;

const quarantineAssertions = String.raw`
begin;

create or replace function public.test_expect_automatic_quarantine_failure(
  p_tenant_id uuid,
  p_outbox_id uuid,
  p_intent_id uuid,
  p_dte_type integer,
  p_reason text,
  p_expected_error text default 'DTE_AUTOMATIC_QUARANTINE_NOT_ELIGIBLE'
) returns void
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform public.dte_quarantine_automatic_issuance_exact(
      p_tenant_id,
      p_outbox_id,
      p_intent_id,
      p_dte_type,
      p_reason
    );
    raise exception 'DTE_QUARANTINE_TEST_UNEXPECTED_SUCCESS';
  exception when others then
    if sqlerrm not like '%' || p_expected_error || '%' then
      raise;
    end if;
  end;
end;
$$;

do $$
declare
  tenant_id_value constant uuid := '91000000-0000-4000-8000-000000000001';
  other_tenant_id constant uuid := '91000000-0000-4000-8000-000000000002';
  intent_id_value constant uuid := '92000000-0000-4000-8000-000000000001';
  outbox_id_value constant uuid := '93000000-0000-4000-8000-000000000001';
  processing_intent constant uuid := '92000000-0000-4000-8000-000000000002';
  processing_outbox constant uuid := '93000000-0000-4000-8000-000000000002';
  document_id_value constant uuid := '94000000-0000-4000-8000-000000000001';
  submission_id_value constant uuid := '95000000-0000-4000-8000-000000000001';
  reason_value constant text := 'POSSIBLE_DUPLICATE_DOCUMENT_REVIEW_REQUIRED';
  quarantined public.dte_issuance_outbox%rowtype;
  row_count_value bigint;
  ledger_count_before bigint;
  document_count_before bigint;
  submission_count_before bigint;
begin
  insert into public.tenants(id,lifecycle_status,operational_mode)
  values
    (tenant_id_value,'active','live'),
    (other_tenant_id,'active','live');
  insert into public.dte_tenant_issuance_settings values(
    tenant_id_value,'automatic_on_verified_payment','39',true,true,'approved',
    true,pg_catalog.now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_id_value,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values(tenant_id_value,33,'active');

  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,
    origin,deterministic_retry_count,network_attempt_count
  ) values(
    intent_id_value,tenant_id_value,'quarantine-payment','webpay',
    'quarantine-intent','invoice',33,59440,'CLP','{}','PENDING',
    'automatic_payment',2,0
  );
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin,deterministic_attempts,
    network_attempts
  ) values(
    outbox_id_value,tenant_id_value,intent_id_value,'PENDING',
    'automatic_system',2,0
  );
  insert into public.dte_document_events(
    tenant_id,intent_id,event_type,safe_metadata
  ) values(
    tenant_id_value,intent_id_value,'ISSUANCE_QUEUED',
    pg_catalog.jsonb_build_object('dteType',33)
  );

  -- Exact identifiers, type and allowlisted reason.
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,'93000000-0000-4000-8000-000000000099',
    intent_id_value,33,reason_value
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,
    '92000000-0000-4000-8000-000000000099',33,reason_value
  );
  perform public.test_expect_automatic_quarantine_failure(
    other_tenant_id,outbox_id_value,intent_id_value,33,reason_value
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,39,reason_value
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,'ARBITRARY_REASON',
    'DTE_AUTOMATIC_QUARANTINE_REASON_INVALID'
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,null,reason_value,
    'DTE_AUTOMATIC_QUARANTINE_INPUT_INVALID'
  );

  -- Every mutable eligibility field fails closed without changing attempts.
  update public.dte_issuance_outbox set status='BLOCKED' where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set status='PENDING' where id=outbox_id_value;

  update public.dte_payment_document_intents set status='BLOCKED' where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents set status='PENDING' where id=intent_id_value;

  update public.dte_issuance_outbox set issuance_origin='manual_admin' where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set issuance_origin='automatic_system' where id=outbox_id_value;

  update public.dte_payment_document_intents set origin='manual_payment' where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents set origin='automatic_payment' where id=intent_id_value;

  update public.dte_payment_document_intents set trigger_source='manual_admin' where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents set trigger_source='webpay' where id=intent_id_value;

  update public.dte_issuance_outbox set network_attempts=1 where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set network_attempts=0 where id=outbox_id_value;

  update public.dte_payment_document_intents set network_attempt_count=1 where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents set network_attempt_count=0 where id=intent_id_value;

  insert into public.dte_production_documents(
    id,tenant_id,dte_type,business_operation_id,status
  ) values(document_id_value,tenant_id_value,33,'unrelated:document','draft');
  update public.dte_payment_document_intents
     set production_document_id=document_id_value where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents
     set production_document_id=null where id=intent_id_value;
  delete from public.dte_production_documents where id=document_id_value;

  update public.dte_issuance_outbox set locked_at=pg_catalog.now() where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set locked_at=null where id=outbox_id_value;

  update public.dte_issuance_outbox set locked_by='unexpected-lock' where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set locked_by=null where id=outbox_id_value;

  update public.dte_issuance_outbox
     set claim_token='96000000-0000-4000-8000-000000000001' where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set claim_token=null where id=outbox_id_value;

  update public.dte_issuance_outbox
     set lease_expires_at=pg_catalog.now()+interval '15 minutes' where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set lease_expires_at=null where id=outbox_id_value;

  update public.dte_issuance_outbox set deterministic_attempts=3 where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set deterministic_attempts=2 where id=outbox_id_value;

  update public.dte_payment_document_intents
     set deterministic_retry_count=3 where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents
     set deterministic_retry_count=2 where id=intent_id_value;

  update public.dte_issuance_outbox
     set last_safe_error='EXISTING_ERROR' where id=outbox_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_issuance_outbox set last_safe_error=null where id=outbox_id_value;

  update public.dte_payment_document_intents
     set safe_blocking_reason='EXISTING_REASON' where id=intent_id_value;
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  update public.dte_payment_document_intents
     set safe_blocking_reason=null where id=intent_id_value;

  -- Tenant concurrency is a distinct conflict and never touches the target.
  insert into public.dte_payment_document_intents(
    id,tenant_id,payment_key,trigger_source,idempotency_key,requested_document,
    resolved_dte_type,amount_snapshot,currency,appointment_snapshot,status,origin
  ) values(
    processing_intent,tenant_id_value,'processing-payment','webpay',
    'processing-intent','invoice',33,1000,'CLP','{}','PREPARING',
    'automatic_payment'
  );
  insert into public.dte_issuance_outbox(
    id,tenant_id,intent_id,status,issuance_origin,locked_at,locked_by,
    claim_token,lease_expires_at
  ) values(
    processing_outbox,tenant_id_value,processing_intent,'PROCESSING',
    'automatic_system',pg_catalog.now(),'other-worker',
    '96000000-0000-4000-8000-000000000002',
    pg_catalog.now()+interval '15 minutes'
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value,
    'DTE_AUTOMATIC_QUARANTINE_CONFLICT'
  );
  delete from public.dte_issuance_outbox where id=processing_outbox;
  delete from public.dte_payment_document_intents where id=processing_intent;

  -- Persisted advancement/network evidence fails closed.
  insert into public.dte_document_events(
    tenant_id,intent_id,event_type,safe_metadata
  ) values(
    tenant_id_value,intent_id_value,'UPLOAD_NETWORK_BOUNDARY',
    '{"networkBoundaryCrossed":true}'::jsonb
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  delete from public.dte_document_events
   where tenant_id=tenant_id_value and intent_id=intent_id_value
     and event_type='UPLOAD_NETWORK_BOUNDARY';

  insert into public.dte_production_documents(
    id,tenant_id,dte_type,business_operation_id,status
  ) values(
    document_id_value,tenant_id_value,33,
    'intent:'||intent_id_value::text,'draft'
  );
  insert into public.dte_production_submission_attempts(
    id,tenant_id,document_id,before_fetch_at,status
  ) values(
    submission_id_value,tenant_id_value,document_id_value,null,'persisted'
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  delete from public.dte_production_submission_attempts where id=submission_id_value;
  delete from public.dte_production_documents where id=document_id_value;

  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state,business_operation_id
  ) values(
    tenant_id_value,33,101,'97000000-0000-4000-8000-000000000001',
    'reserved','intent:'||intent_id_value::text
  );
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  delete from public.dte_production_folio_ledger
   where tenant_id=tenant_id_value and dte_type=33 and folio=101;

  -- Unrelated production state is preserved by the successful exact target.
  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state,business_operation_id
  ) values(
    tenant_id_value,33,102,'97000000-0000-4000-8000-000000000002',
    'available',null
  );
  select pg_catalog.count(*) into ledger_count_before
    from public.dte_production_folio_ledger;
  select pg_catalog.count(*) into document_count_before
    from public.dte_production_documents;
  select pg_catalog.count(*) into submission_count_before
    from public.dte_production_submission_attempts;

  select * into quarantined
    from public.dte_quarantine_automatic_issuance_exact(
      tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
    );
  if quarantined.id <> outbox_id_value or quarantined.status <> 'BLOCKED' then
    raise exception 'DTE_QUARANTINE_RETURN_ROW_INVALID';
  end if;

  select pg_catalog.count(*) into row_count_value
    from public.dte_payment_document_intents intent
    join public.dte_issuance_outbox outbox
      on outbox.tenant_id=intent.tenant_id and outbox.intent_id=intent.id
   where intent.id=intent_id_value
     and intent.tenant_id=tenant_id_value
     and intent.status='BLOCKED'
     and intent.safe_blocking_reason=reason_value
     and intent.network_attempt_count=0
     and intent.deterministic_retry_count=2
     and intent.production_document_id is null
     and outbox.id=outbox_id_value
     and outbox.status='BLOCKED'
     and outbox.last_safe_error=reason_value
     and outbox.network_attempts=0
     and outbox.deterministic_attempts=2
     and outbox.locked_at is null
     and outbox.locked_by is null
     and outbox.claim_token is null
     and outbox.lease_expires_at is null;
  if row_count_value <> 1 then
    raise exception 'DTE_QUARANTINE_HAPPY_PATH_STATE_INVALID';
  end if;

  select pg_catalog.count(*) into row_count_value
    from public.dte_document_events event
   where event.tenant_id=tenant_id_value
     and event.intent_id=intent_id_value
     and event.production_document_id is null
     and event.event_type='AUTOMATIC_ISSUANCE_QUARANTINED'
     and event.safe_metadata = pg_catalog.jsonb_build_object(
       'reason',reason_value,
       'exactTarget',true,
       'automaticRetry',false,
       'networkBoundaryCrossed',false,
       'productionDocumentCreated',false,
       'dteType',33
     );
  if row_count_value <> 1 then
    raise exception 'DTE_QUARANTINE_SAFE_EVENT_INVALID';
  end if;

  if (select pg_catalog.count(*) from public.dte_production_folio_ledger)
       <> ledger_count_before
     or (select pg_catalog.count(*) from public.dte_production_documents)
       <> document_count_before
     or (select pg_catalog.count(*) from public.dte_production_submission_attempts)
       <> submission_count_before then
    raise exception 'DTE_QUARANTINE_PRODUCTION_STATE_CHANGED';
  end if;
  if exists (
    select 1 from public.dte_document_events event
     where event.tenant_id=tenant_id_value
       and event.intent_id=intent_id_value
       and (
         event.event_type like '%NETWORK_BOUNDARY%'
         or event.safe_metadata @> '{"networkBoundaryCrossed":true}'::jsonb
       )
  ) then
    raise exception 'DTE_QUARANTINE_NETWORK_BOUNDARY_CREATED';
  end if;

  -- Idempotency is fail-closed: the second call changes nothing and emits no event.
  perform public.test_expect_automatic_quarantine_failure(
    tenant_id_value,outbox_id_value,intent_id_value,33,reason_value
  );
  select pg_catalog.count(*) into row_count_value
    from public.dte_document_events event
   where event.tenant_id=tenant_id_value
     and event.intent_id=intent_id_value
     and event.event_type='AUTOMATIC_ISSUANCE_QUARANTINED';
  if row_count_value <> 1 then
    raise exception 'DTE_QUARANTINE_EVENT_DUPLICATED';
  end if;

  -- The real normal exact/global claim RPCs cannot select a BLOCKED target.
  begin
    perform public.dte_claim_automatic_issuance_outbox_exact(
      'quarantine-claim-test',outbox_id_value
    );
    raise exception 'DTE_QUARANTINE_EXACT_CLAIM_ACCEPTED_BLOCKED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE%' then raise; end if;
  end;
  select pg_catalog.count(*) into row_count_value
    from public.dte_claim_automatic_issuance_outbox('quarantine-global-test');
  if row_count_value <> 0 then
    raise exception 'DTE_QUARANTINE_GLOBAL_CLAIM_ACCEPTED_BLOCKED';
  end if;

  -- New SECURITY DEFINER entrypoint is service-role only.
  if pg_catalog.has_function_privilege(
       'public',
       'public.dte_quarantine_automatic_issuance_exact(uuid,uuid,uuid,integer,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.dte_quarantine_automatic_issuance_exact(uuid,uuid,uuid,integer,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.dte_quarantine_automatic_issuance_exact(uuid,uuid,uuid,integer,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.dte_quarantine_automatic_issuance_exact(uuid,uuid,uuid,integer,text)',
       'EXECUTE'
     ) then
    raise exception 'DTE_QUARANTINE_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$$;

select 'DTE_AUTOMATIC_QUARANTINE_SQL_ASSERTIONS_PASSED=31';
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
        input: `${bootstrap}\n${manualClaim}\n${migration}\n${hardening}\n${ownedLastFolio}\n${ownedFolioResume}\n${quarantine}\n${assertions}\n${hardeningAssertions}\n${ownedLastFolioAssertions}\n${ownedFolioResumeAssertions}\n${quarantineAssertions}`,
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /DTE_AUTOMATIC_SQL_ASSERTIONS_PASSED=19/);
    assert.match(run.stdout, /DTE_AUTOMATIC_HARDENING_SQL_ASSERTIONS_PASSED=15/);
    assert.match(run.stdout, /CIT33_OWNED_LAST_FOLIO_SQL_ASSERTIONS_PASSED=47/);
    assert.match(run.stdout, /CIT33_OWNED_FOLIO_RESUME_SQL_ASSERTIONS_PASSED=28/);
    assert.match(run.stdout, /DTE_AUTOMATIC_QUARANTINE_SQL_ASSERTIONS_PASSED=31/);
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
