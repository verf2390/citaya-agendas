import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const existingTest = readFileSync(
  "tests/security/dte-automatic-enqueue-claim-postgres.test.mjs",
  "utf8",
);

function extractRawStringConstant(name) {
  const marker = `const ${name} = String.raw\``;
  const start = existingTest.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name} bootstrap`);

  const bodyStart = start + marker.length;
  const end = existingTest.indexOf("\n`;", bodyStart);
  assert.notEqual(end, -1, `Missing ${name} terminator`);

  return existingTest.slice(bodyStart, end);
}

const bootstrap = extractRawStringConstant("bootstrap");

const manualClaim = readFileSync(
  "migrations/202608050004_allow_type39_in_claim_outbox_rpcs.sql",
  "utf8",
);

const automaticMigration = readFileSync(
  "migrations/202608110003_enable_automatic_dte_enqueue_and_claim.sql",
  "utf8",
);

const manualVerifiedMigration = readFileSync(
  "migrations/202608200002_manual_verified_transfer_automatic_dte.sql",
  "utf8",
);

const schemaAugment = String.raw`
alter table public.tenants
  add column lifecycle_status text not null default 'active',
  add column operational_mode text not null default 'internal';

alter table public.payment_intents
  add column idempotency_key text;

alter table public.billing_sales
  add column customer_id uuid;

alter table public.billing_sale_payments
  add column verified_by uuid;

alter table public.dte_tenant_issuance_settings
  add column boleta_payment_document_model text
    not null default 'always_issue_boleta';

create table public.billing_sale_appointments(
  tenant_id uuid not null,
  sale_id uuid not null,
  appointment_id uuid not null
);

create table public.customer_tax_profiles(
  tenant_id uuid not null,
  customer_id uuid not null,
  rut_normalized text,
  legal_name text,
  business_activity text,
  tax_address text,
  tax_commune text,
  tax_city text
);

create table public.tenant_payment_method_tax_policies(
  tenant_id uuid not null,
  provider text not null,
  classification text,
  active boolean not null default true
);

create or replace function public.resolve_tenant_operational_capabilities(
  p_tenant_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when t.id is null then
      jsonb_build_object(
        'exists', false,
        'enqueueDte', false,
        'manualDteEnqueue', false
      )

    when t.lifecycle_status <> 'active' then
      jsonb_build_object(
        'exists', true,
        'enqueueDte', false,
        'manualDteEnqueue', false
      )

    when t.operational_mode = 'live' then
      jsonb_build_object(
        'exists', true,
        'enqueueDte', true,
        'manualDteEnqueue', true
      )

    when t.operational_mode = 'internal' then
      jsonb_build_object(
        'exists', true,
        'enqueueDte', false,
        'manualDteEnqueue', true
      )

    else
      jsonb_build_object(
        'exists', true,
        'enqueueDte', false,
        'manualDteEnqueue', false
      )
  end
  from (select 1) singleton
  left join public.tenants t
    on t.id = p_tenant_id;
$$;

create or replace function public.assert_tenant_can_create_payment(
  p_tenant_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_mode text;
  tenant_lifecycle text;
begin
  select operational_mode, lifecycle_status
    into tenant_mode, tenant_lifecycle
    from public.tenants
   where id = p_tenant_id;

  if not found
     or tenant_lifecycle <> 'active'
     or tenant_mode <> 'live' then
    raise exception 'TENANT_MODE_PAYMENT_BLOCKED';
  end if;
end;
$$;

create or replace function public.assert_tenant_can_create_appointment(
  p_tenant_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  raise exception 'TENANT_MODE_APPOINTMENT_BLOCKED';
end;
$$;
`;

const triggerSetup = String.raw`
drop trigger if exists a_tenant_mode_payment_intents
  on public.payment_intents;

create trigger a_tenant_mode_payment_intents
before insert on public.payment_intents
for each row
execute function public.assert_tenant_operational_trigger();

drop trigger if exists a_tenant_mode_payments
  on public.payments;

create trigger a_tenant_mode_payments
before insert on public.payments
for each row
execute function public.assert_tenant_operational_trigger();

drop trigger if exists a_tenant_mode_billing_sale_payments
  on public.billing_sale_payments;

create trigger a_tenant_mode_billing_sale_payments
before insert on public.billing_sale_payments
for each row
execute function public.assert_tenant_operational_trigger();

drop trigger if exists payment_intents_tenant_mode_status
  on public.payment_intents;

create trigger payment_intents_tenant_mode_status
before update of status on public.payment_intents
for each row
execute function public.tenant_mode_payment_status_guard();

drop trigger if exists payments_tenant_mode_status
  on public.payments;

create trigger payments_tenant_mode_status
before update of status on public.payments
for each row
execute function public.tenant_mode_payment_status_guard();

drop trigger if exists a_tenant_mode_dte_intents
  on public.dte_payment_document_intents;

create trigger a_tenant_mode_dte_intents
before insert on public.dte_payment_document_intents
for each row
execute function public.assert_tenant_operational_trigger();

drop trigger if exists a_tenant_mode_dte_outbox
  on public.dte_issuance_outbox;

create trigger a_tenant_mode_dte_outbox
before insert on public.dte_issuance_outbox
for each row
execute function public.assert_tenant_operational_trigger();
`;

const assertions = String.raw`
begin;

do $$
declare
  tenant_id_value constant uuid :=
    '11000000-0000-0000-0000-000000000001';

  customer_id_value constant uuid :=
    '21000000-0000-0000-0000-000000000001';

  actor_id_value constant uuid :=
    '31000000-0000-0000-0000-000000000001';

  wrong_actor_id constant uuid :=
    '31000000-0000-0000-0000-000000000002';

  appointment_id_value constant uuid :=
    '41000000-0000-0000-0000-000000000001';

  sale_id_value constant uuid :=
    '51000000-0000-0000-0000-000000000001';

  schedule_id_value constant uuid :=
    '61000000-0000-0000-0000-000000000001';

  rejected_payment_id constant uuid :=
    '71000000-0000-0000-0000-000000000001';

  payment_intent_id_value uuid;
  dte_intent_id_value uuid;
  claimed public.dte_issuance_outbox%rowtype;

  row_count_value integer;
  mutate_ok boolean;
begin
  insert into public.tenants(
    id,
    lifecycle_status,
    operational_mode
  ) values (
    tenant_id_value,
    'active',
    'internal'
  );

  insert into public.customers(
    id,
    tenant_id,
    full_name,
    rut_normalized,
    email,
    phone
  ) values (
    customer_id_value,
    tenant_id_value,
    'Cliente Transferencia',
    null,
    'cliente@example.test',
    null
  );

  insert into public.dte_tenant_issuance_settings(
    tenant_id,
    issuance_mode,
    consumer_document_type,
    invoice_on_request,
    production_enabled,
    sii_authorization_status,
    certificate_ready,
    certificate_valid_to,
    caf_ready,
    folio_ready,
    endpoints_ready,
    storage_ready,
    worker_ready,
    readiness_tests_green,
    deposit_tax_document_policy_status,
    boleta_payment_document_model
  ) values (
    tenant_id_value,
    'automatic_on_verified_payment',
    '39',
    true,
    true,
    'approved',
    true,
    now() + interval '30 days',
    true,
    true,
    true,
    true,
    true,
    true,
    'enabled',
    'always_issue_boleta'
  );

  insert into public.dte_production_tenant_settings(
    tenant_id,
    enabled,
    issuance_mode,
    sii_authorization_status,
    authorized_types
  ) values (
    tenant_id_value,
    true,
    'automatic',
    'approved',
    array[33,39]
  );

  insert into public.dte_legal_activation(
    tenant_id,
    dte_type,
    status
  ) values (
    tenant_id_value,
    39,
    'active'
  );

  insert into public.appointments(
    id,
    tenant_id,
    customer_id,
    customer_email,
    service_name,
    service_price,
    payment_required_amount,
    payment_paid_amount,
    payment_remaining_amount,
    balance_due,
    currency,
    payment_status,
    status,
    booking_status,
    invoice_requested,
    requested_document_type,
    tax_document_selection,
    tax_treatment_snapshot
  ) values (
    appointment_id_value,
    tenant_id_value,
    customer_id_value,
    'cliente@example.test',
    'Optimización de laptop',
    25000,
    25000,
    0,
    25000,
    25000,
    'CLP',
    'pending',
    'pending_payment',
    'pending_payment',
    false,
    39,
    39,
    'affected'
  );

  insert into public.billing_sales(
    id,
    tenant_id,
    customer_id,
    requested_document_type,
    paid_amount,
    total_amount,
    balance_due,
    payment_state,
    status
  ) values (
    sale_id_value,
    tenant_id_value,
    customer_id_value,
    39,
    0,
    25000,
    25000,
    'PENDING',
    'PENDING'
  );

  insert into public.billing_sale_appointments(
    tenant_id,
    sale_id,
    appointment_id
  ) values (
    tenant_id_value,
    sale_id_value,
    appointment_id_value
  );

  insert into public.billing_payment_schedule(
    id,
    tenant_id,
    sale_id,
    amount,
    paid_amount,
    installment_kind,
    status
  ) values (
    schedule_id_value,
    tenant_id_value,
    sale_id_value,
    25000,
    0,
    'initial',
    'PENDING'
  );

  -- Internal tenants still cannot create arbitrary financial rows.
  begin
    insert into public.payment_intents(
      id,
      tenant_id,
      appointment_id,
      provider,
      amount,
      currency,
      status,
      provider_payment_id
    ) values (
      rejected_payment_id,
      tenant_id_value,
      appointment_id_value,
      'manual',
      25000,
      'CLP',
      'pending',
      'manual:arbitrary'
    );

    raise exception 'ARBITRARY_INTERNAL_MANUAL_PAYMENT_WAS_ALLOWED';

  exception when others then
    if sqlerrm not like '%TENANT_MODE_PAYMENT_BLOCKED%' then
      raise;
    end if;
  end;

  payment_intent_id_value :=
    public.billing_record_manual_verified_payment(
      tenant_id_value,
      appointment_id_value,
      actor_id_value
    );

  select count(*)
    into row_count_value
    from public.payment_intents pi
   where pi.id = payment_intent_id_value
     and pi.tenant_id = tenant_id_value
     and pi.appointment_id = appointment_id_value
     and pi.provider = 'manual'
     and pi.status = 'succeeded'
     and pi.amount = 25000;

  if row_count_value <> 1 then
    raise exception 'MANUAL_PAYMENT_INTENT_NOT_VERIFIED';
  end if;

  select count(*)
    into row_count_value
    from public.billing_sale_payments bsp
   where bsp.tenant_id = tenant_id_value
     and bsp.appointment_id = appointment_id_value
     and bsp.payment_intent_id = payment_intent_id_value
     and bsp.provider = 'manual'
     and bsp.status = 'VERIFIED'
     and bsp.validation_result = 'provider_verified'
     and bsp.reconciliation_status = 'NOT_REQUIRED'
     and bsp.verified_by = actor_id_value;

  if row_count_value <> 1 then
    raise exception 'MANUAL_VERIFICATION_EVIDENCE_INVALID';
  end if;

  select id
    into dte_intent_id_value
    from public.dte_payment_document_intents
   where tenant_id = tenant_id_value
     and appointment_id = appointment_id_value
     and payment_intent_id = payment_intent_id_value
     and trigger_source = 'manual_verified'
     and origin = 'automatic_payment'
     and resolved_dte_type = 39
     and status = 'PENDING';

  if dte_intent_id_value is null then
    raise exception 'MANUAL_VERIFIED_DTE_INTENT_NOT_CREATED';
  end if;

  select count(*)
    into row_count_value
    from public.dte_payment_document_intents
   where tenant_id = tenant_id_value
     and payment_intent_id = payment_intent_id_value;

  if row_count_value <> 1 then
    raise exception 'MANUAL_VERIFIED_INTENT_NOT_EXACTLY_ONCE';
  end if;

  select count(*)
    into row_count_value
    from public.dte_issuance_outbox
   where tenant_id = tenant_id_value
     and intent_id = dte_intent_id_value
     and issuance_origin = 'automatic_system'
     and status = 'PENDING';

  if row_count_value <> 1 then
    raise exception 'MANUAL_VERIFIED_OUTBOX_NOT_EXACTLY_ONCE';
  end if;

  -- The persisted actor is part of the security evidence.
  begin
    perform public.dte_enqueue_payment_snapshot(
      tenant_id_value,
      appointment_id_value,
      payment_intent_id_value,
      'manual_verified:wrong-actor',
      'manual_verified',
      wrong_actor_id
    );

    raise exception 'WRONG_VERIFICATION_ACTOR_WAS_ACCEPTED';

  exception when others then
    if sqlerrm not like '%DTE_MANUAL_PAYMENT_VERIFICATION_REQUIRED%' then
      raise;
    end if;
  end;

  select *
    into claimed
    from public.dte_claim_automatic_issuance_outbox(
      'manual-verified-worker-1'
    );

  if claimed.intent_id is distinct from dte_intent_id_value then
    raise exception 'MANUAL_VERIFIED_AUTOMATIC_CLAIM_FAILED';
  end if;

  if claimed.claim_token is null then
    raise exception 'MANUAL_VERIFIED_CLAIM_TOKEN_MISSING';
  end if;

  mutate_ok :=
    public.dte_mutate_automatic_issuance_claim(
      claimed.id,
      'manual-verified-worker-1',
      claimed.claim_token,
      'RENEW'
    );

  if mutate_ok is distinct from true then
    raise exception 'MANUAL_VERIFIED_RENEW_FAILED';
  end if;

  select count(*)
    into row_count_value
    from public.dte_issuance_outbox
   where id = claimed.id
     and tenant_id = tenant_id_value
     and status = 'PROCESSING'
     and issuance_origin = 'automatic_system'
     and network_attempts = 0;

  if row_count_value <> 1 then
    raise exception 'MANUAL_VERIFIED_CLAIM_STATE_INVALID';
  end if;
end;
$$;

select 'DTE_MANUAL_VERIFIED_SQL_ASSERTIONS_PASSED=10';

rollback;
`;

test(
  "PostgreSQL validates trusted manual transfer -> automatic DTE without external network",
  () => {
    const database =
      `citaya_manual_verified_${randomUUID().replaceAll("-", "")}`;

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
          input: [
            bootstrap,
            manualClaim,
            automaticMigration,
            schemaAugment,
            manualVerifiedMigration,
            triggerSetup,
            assertions,
          ].join("\n\n"),
          encoding: "utf8",
        },
      );

      assert.equal(
        run.status,
        0,
        `${run.stdout}\n${run.stderr}`,
      );

      assert.match(
        run.stdout,
        /DTE_MANUAL_VERIFIED_SQL_ASSERTIONS_PASSED=10/,
      );
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
  },
);
