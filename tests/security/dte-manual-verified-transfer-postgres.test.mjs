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

const noDuplicateDraftMigration = readFileSync(
  "migrations/202608220001_prevent_automatic_payment_manual_draft.sql",
  "utf8",
);

const automaticWorkerHardeningMigration = readFileSync(
  "migrations/202608240001_dte_automatic_worker_canary_fencing.sql",
  "utf8",
);

const cit35CatalogGrossMigration = readFileSync(
  "migrations/202608250001_cit35_preserve_catalog_gross_snapshot.sql",
  "utf8",
);

const schemaAugment = String.raw`
alter table public.payment_intents
  add column idempotency_key text;

alter table public.billing_sales
  add column customer_id uuid,
  add column tax_treatment_status text not null default 'AFFECTED';

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

create table public.billing_payment_schedule_allocations(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  schedule_id uuid not null,
  sale_id uuid not null,
  sale_item_id uuid not null,
  amount_from bigint not null,
  amount_to bigint not null,
  allocated_amount bigint generated always as (amount_to-amount_from) stored,
  amount_range int8range generated always as (
    int8range(amount_from,amount_to,'[)')
  ) stored
);

create table public.dte_invoice_drafts(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  billing_sale_payment_id uuid not null,
  payment_intent_id uuid not null,
  source text not null,
  status text not null,
  review_reason text
);

create table public.billing_sale_item_document_coverage(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  sale_item_id uuid not null,
  status text not null,
  coverage_source text not null,
  sale_payment_id uuid,
  payment_schedule_allocation_id uuid,
  amount_from bigint not null,
  amount_to bigint not null,
  amount_range int8range generated always as (
    int8range(amount_from,amount_to,'[)')
  ) stored
);

alter table public.billing_sale_items
  add column service_id uuid,
  add column appointment_id uuid,
  add column position integer,
  add column description text,
  add column quantity integer,
  add column unit_net_amount bigint,
  add column discount_basis_points integer,
  add column discount_amount bigint,
  add column net_amount bigint,
  add column tax_amount bigint,
  add column total_amount bigint,
  add column pricing_mode text,
  add column catalog_unit_gross_amount bigint,
  add column tax_treatment_snapshot text;

create or replace function public.dte_payment_document_policy_decision(
  p_tenant_id uuid,
  p_requested_document_type integer,
  p_payment_method text,
  p_qualifying_electronic_voucher boolean default false
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_requested_document_type = 33 then
      jsonb_build_object('action','ISSUE_FACTURA_33','blocked',false)
    when settings.boleta_payment_document_model = 'always_issue_boleta' then
      jsonb_build_object('action','ISSUE_BOLETA_39','blocked',false)
    when settings.boleta_payment_document_model = 'electronic_payment_voucher_as_boleta'
         and p_qualifying_electronic_voucher then
      jsonb_build_object(
        'action','COVERED_BY_ELECTRONIC_PAYMENT_VOUCHER',
        'blocked',false
      )
    else
      jsonb_build_object(
        'action','VOUCHER_CLASSIFICATION_REVIEW_REQUIRED',
        'blocked',true
      )
  end
  from public.dte_tenant_issuance_settings settings
  where settings.tenant_id = p_tenant_id;
$$;

create or replace function public.billing_create_payment_review_document(
  p_tenant_id uuid,
  p_sale_payment_id uuid,
  p_payment_intent_id uuid,
  p_schedule_id uuid,
  p_provider text,
  p_method_classification text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_id_value uuid;
  sale_id_value uuid;
  boleta_model_value text;
begin
  select sale_id into sale_id_value
    from public.billing_sale_payments
   where tenant_id=p_tenant_id and id=p_sale_payment_id;

  select boleta_payment_document_model into boleta_model_value
    from public.dte_tenant_issuance_settings
   where tenant_id=p_tenant_id;

  if boleta_model_value='electronic_payment_voucher_as_boleta'
     and p_method_classification='voucher_as_boleta' then
    insert into public.billing_sale_item_document_coverage(
      tenant_id,sale_id,sale_item_id,status,coverage_source,sale_payment_id,
      payment_schedule_allocation_id,amount_from,amount_to
    )
    select allocation.tenant_id,allocation.sale_id,allocation.sale_item_id,
      'ACCEPTED','ELECTRONIC_PAYMENT_VOUCHER',p_sale_payment_id,
      allocation.id,allocation.amount_from,allocation.amount_to
    from public.billing_payment_schedule_allocations allocation
    where allocation.tenant_id=p_tenant_id
      and allocation.schedule_id=p_schedule_id;
    return null;
  end if;

  insert into public.dte_invoice_drafts(
    tenant_id,sale_id,billing_sale_payment_id,payment_intent_id,
    source,status,review_reason
  ) values (
    p_tenant_id,sale_id_value,p_sale_payment_id,p_payment_intent_id,
    'payment','REVIEW_REQUIRED','MANUAL_DTE_REVIEW_REQUIRED'
  ) returning id into draft_id_value;

  return draft_id_value;
end;
$$;

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

const cit35CatalogGrossAssertions = String.raw`
begin;

do $$
declare
  tenant_id_value constant uuid :=
    'c3500000-0000-4000-8000-000000000001';
  sale_id_value constant uuid :=
    'c3500000-0000-4000-8000-000000000002';
  appointment_id_value constant uuid :=
    'c3500000-0000-4000-8000-000000000003';
  payment_intent_id_value constant uuid :=
    'c3500000-0000-4000-8000-000000000004';
  frozen_line jsonb;
begin
  insert into public.tenants(id,lifecycle_status,operational_mode)
  values(tenant_id_value,'active','internal');

  insert into public.billing_sale_items(
    tenant_id,sale_id,service_id,appointment_id,position,description,
    quantity,unit_net_amount,discount_basis_points,discount_amount,
    net_amount,tax_amount,total_amount,pricing_mode,
    catalog_unit_gross_amount,tax_treatment_snapshot,
    payment_policy_snapshot,deposit_tax_document_policy_status_snapshot
  ) values (
    tenant_id_value,sale_id_value,null,appointment_id_value,1,
    'Servicios de app minimarket',1,49950,0,0,49950,9490,59440,
    'catalog_gross',59440,'affected','full_payment','enabled'
  );

  perform pg_catalog.set_config(
    'citaya.manual_transfer_tenant_id',
    tenant_id_value::text,
    true
  );

  insert into public.billing_sale_payments(
    tenant_id,sale_id,appointment_id,payment_intent_id,
    external_payment_reference,provider,amount,currency,status,
    validation_result,reconciliation_status
  ) values (
    tenant_id_value,sale_id_value,appointment_id_value,
    payment_intent_id_value,'manual:cit35','manual',59440,'CLP','VERIFIED',
    'provider_verified','NOT_REQUIRED'
  );

  insert into public.dte_payment_document_intents(
    tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
    idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
    currency,appointment_snapshot,status,origin
  ) values (
    tenant_id_value,appointment_id_value,payment_intent_id_value,
    'manual_verified:cit35','manual_verified','cit35-catalog-gross',
    'invoice',33,59440,'CLP','{}'::jsonb,'PENDING','automatic_payment'
  ) returning immutable_snapshot#>'{lines,0}' into frozen_line;

  if frozen_line->>'pricingMode' <> 'catalog_gross'
     or (frozen_line->>'catalogUnitGrossAmount')::bigint <> 59440
     or (frozen_line->>'unitNetAmount')::bigint <> 49950
     or (frozen_line->>'taxAmount')::bigint <> 9490
     or (frozen_line->>'totalAmount')::bigint <> 59440 then
    raise exception 'CIT35_CATALOG_GROSS_SNAPSHOT_NOT_PRESERVED';
  end if;
end
$$;

rollback;
select 'CIT35_CATALOG_GROSS_PRODUCER_PASSED=1';
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
  repeated_dte_intent_id_value uuid;
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

  insert into public.billing_sale_items(
    tenant_id,
    sale_id,
    payment_policy_snapshot,
    deposit_tax_document_policy_status_snapshot
  ) values (
    tenant_id_value,
    sale_id_value,
    'full_payment',
    'enabled'
  );

  insert into public.billing_payment_schedule_allocations(
    tenant_id,
    schedule_id,
    sale_id,
    sale_item_id,
    amount_from,
    amount_to
  ) select
    tenant_id_value,
    schedule_id_value,
    sale_id_value,
    item.id,
    0,
    25000
  from public.billing_sale_items item
  where item.tenant_id=tenant_id_value
    and item.sale_id=sale_id_value;

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

  select count(*)
    into row_count_value
    from public.dte_invoice_drafts
   where tenant_id=tenant_id_value
     and payment_intent_id=payment_intent_id_value
     and source='payment'
     and status='REVIEW_REQUIRED'
     and review_reason='MANUAL_DTE_REVIEW_REQUIRED';

  if row_count_value <> 0 then
    raise exception 'AUTOMATIC_PAYMENT_CREATED_MANUAL_REVIEW_DRAFT';
  end if;

  repeated_dte_intent_id_value := public.dte_enqueue_payment_snapshot(
    tenant_id_value,
    appointment_id_value,
    payment_intent_id_value,
    'manual_verified:'||payment_intent_id_value::text,
    'manual_verified',
    actor_id_value
  );

  if repeated_dte_intent_id_value is distinct from dte_intent_id_value then
    raise exception 'MANUAL_VERIFIED_RETRY_CHANGED_INTENT';
  end if;

  select count(*) into row_count_value
    from public.dte_payment_document_intents
   where tenant_id=tenant_id_value
     and payment_intent_id=payment_intent_id_value;
  if row_count_value <> 1 then
    raise exception 'MANUAL_VERIFIED_RETRY_DUPLICATED_INTENT';
  end if;

  select count(*) into row_count_value
    from public.dte_issuance_outbox
   where tenant_id=tenant_id_value
     and intent_id=dte_intent_id_value;
  if row_count_value <> 1 then
    raise exception 'MANUAL_VERIFIED_RETRY_DUPLICATED_OUTBOX';
  end if;

  begin
    perform public.billing_record_manual_verified_payment(
      tenant_id_value,
      appointment_id_value,
      actor_id_value
    );
    raise exception 'MANUAL_VERIFIED_PAYMENT_RETRY_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%SALE_ALREADY_PAID%' then
      raise;
    end if;
  end;

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

const policyRegressionAssertions = String.raw`
begin;

do $$
declare
  manual_tenant constant uuid := '12000000-0000-0000-0000-000000000001';
  manual_customer constant uuid := '22000000-0000-0000-0000-000000000001';
  manual_actor constant uuid := '32000000-0000-0000-0000-000000000001';
  manual_appointment constant uuid := '42000000-0000-0000-0000-000000000001';
  manual_sale constant uuid := '52000000-0000-0000-0000-000000000001';
  manual_schedule constant uuid := '62000000-0000-0000-0000-000000000001';
  manual_balance_schedule constant uuid := '62000000-0000-0000-0000-000000000002';

  voucher_tenant constant uuid := '13000000-0000-0000-0000-000000000001';
  voucher_customer constant uuid := '23000000-0000-0000-0000-000000000001';
  voucher_actor constant uuid := '33000000-0000-0000-0000-000000000001';
  voucher_appointment constant uuid := '43000000-0000-0000-0000-000000000001';
  voucher_sale constant uuid := '53000000-0000-0000-0000-000000000001';
  voucher_schedule constant uuid := '63000000-0000-0000-0000-000000000001';

  payment_intent_id_value uuid;
  balance_payment_intent_id_value uuid;
  row_count_value integer;
begin
  insert into public.tenants(id,lifecycle_status,operational_mode)
  values(manual_tenant,'active','internal');

  insert into public.customers(id,tenant_id,full_name)
  values(manual_customer,manual_tenant,'Cliente Modo Manual');

  insert into public.dte_tenant_issuance_settings(
    tenant_id,issuance_mode,consumer_document_type,invoice_on_request,
    production_enabled,sii_authorization_status,certificate_ready,
    certificate_valid_to,caf_ready,folio_ready,endpoints_ready,storage_ready,
    worker_ready,readiness_tests_green,deposit_tax_document_policy_status,
    boleta_payment_document_model
  ) values (
    manual_tenant,'manual','39',true,false,'approved',true,
    now()+interval '30 days',true,true,true,true,true,true,'enabled',
    'always_issue_boleta'
  );

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,
    payment_required_amount,payment_paid_amount,payment_remaining_amount,
    balance_due,currency,payment_status,status,booking_status,
    invoice_requested,requested_document_type,tax_document_selection,
    tax_treatment_snapshot
  ) values (
    manual_appointment,manual_tenant,manual_customer,'Servicio manual',15000,
    15000,0,15000,15000,'CLP','pending','pending_payment','pending_payment',
    false,39,39,'affected'
  );

  insert into public.billing_sales(
    id,tenant_id,customer_id,requested_document_type,paid_amount,total_amount,
    balance_due,payment_state,status
  ) values (
    manual_sale,manual_tenant,manual_customer,39,0,15000,15000,'PENDING','PENDING'
  );

  insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
  values(manual_tenant,manual_sale,manual_appointment);

  insert into public.billing_payment_schedule(
    id,tenant_id,sale_id,amount,paid_amount,installment_kind,status
  ) values
    (manual_schedule,manual_tenant,manual_sale,5000,0,'initial','PENDING'),
    (manual_balance_schedule,manual_tenant,manual_sale,10000,0,'balance','PENDING');

  insert into public.billing_sale_items(
    tenant_id,sale_id,payment_policy_snapshot,
    deposit_tax_document_policy_status_snapshot
  ) values (manual_tenant,manual_sale,'deposit','enabled');

  insert into public.billing_payment_schedule_allocations(
    tenant_id,schedule_id,sale_id,sale_item_id,amount_from,amount_to
  ) select manual_tenant,manual_schedule,manual_sale,item.id,0,5000
      from public.billing_sale_items item
     where item.tenant_id=manual_tenant and item.sale_id=manual_sale
    union all
    select manual_tenant,manual_balance_schedule,manual_sale,item.id,5000,15000
      from public.billing_sale_items item
     where item.tenant_id=manual_tenant and item.sale_id=manual_sale;

  payment_intent_id_value := public.billing_record_manual_verified_payment(
    manual_tenant,manual_appointment,manual_actor
  );

  select count(*) into row_count_value
    from public.dte_invoice_drafts
   where tenant_id=manual_tenant
     and payment_intent_id=payment_intent_id_value
     and source='payment'
     and status='REVIEW_REQUIRED'
     and review_reason='MANUAL_DTE_REVIEW_REQUIRED';
  if row_count_value <> 1 then
    raise exception 'MANUAL_MODE_REVIEW_DRAFT_NOT_PRESERVED';
  end if;

  balance_payment_intent_id_value := public.billing_record_manual_verified_payment(
    manual_tenant,manual_appointment,manual_actor
  );

  select count(*) into row_count_value
    from public.dte_invoice_drafts
   where tenant_id=manual_tenant
     and payment_intent_id in (
       payment_intent_id_value,
       balance_payment_intent_id_value
     )
     and source='payment'
     and status='REVIEW_REQUIRED'
     and review_reason='MANUAL_DTE_REVIEW_REQUIRED';
  if row_count_value <> 2 then
    raise exception 'MANUAL_DEPOSIT_TRANCHES_NOT_PRESERVED';
  end if;

  if exists (
    select 1 from public.dte_payment_document_intents
     where tenant_id=manual_tenant
       and payment_intent_id in (
         payment_intent_id_value,
         balance_payment_intent_id_value
       )
  ) then
    raise exception 'MANUAL_MODE_CREATED_AUTOMATIC_INTENT';
  end if;

  begin
    perform public.billing_record_manual_verified_payment(
      manual_tenant,manual_appointment,manual_actor
    );
    raise exception 'MANUAL_MODE_RETRY_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%SALE_ALREADY_PAID%' then
      raise;
    end if;
  end;

  select count(*) into row_count_value
    from public.dte_invoice_drafts
   where tenant_id=manual_tenant;
  if row_count_value <> 2 then
    raise exception 'MANUAL_MODE_RETRY_DUPLICATED_DRAFT';
  end if;

  insert into public.tenants(id,lifecycle_status,operational_mode)
  values(voucher_tenant,'active','internal');

  insert into public.customers(id,tenant_id,full_name)
  values(voucher_customer,voucher_tenant,'Cliente Voucher');

  insert into public.dte_tenant_issuance_settings(
    tenant_id,issuance_mode,consumer_document_type,invoice_on_request,
    production_enabled,sii_authorization_status,certificate_ready,
    certificate_valid_to,caf_ready,folio_ready,endpoints_ready,storage_ready,
    worker_ready,readiness_tests_green,deposit_tax_document_policy_status,
    boleta_payment_document_model
  ) values (
    voucher_tenant,'automatic_on_verified_payment','39',true,true,'approved',true,
    now()+interval '30 days',true,true,true,true,true,true,'enabled',
    'electronic_payment_voucher_as_boleta'
  );

  insert into public.dte_production_tenant_settings(
    tenant_id,enabled,issuance_mode,sii_authorization_status,authorized_types
  ) values (
    voucher_tenant,true,'automatic','approved',array[33,39]
  );

  insert into public.tenant_payment_method_tax_policies(
    tenant_id,provider,classification,active
  ) values(voucher_tenant,'manual','voucher_as_boleta',true);

  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,
    payment_required_amount,payment_paid_amount,payment_remaining_amount,
    balance_due,currency,payment_status,status,booking_status,
    invoice_requested,requested_document_type,tax_document_selection,
    tax_treatment_snapshot
  ) values (
    voucher_appointment,voucher_tenant,voucher_customer,'Servicio voucher',12000,
    12000,0,12000,12000,'CLP','pending','pending_payment','pending_payment',
    false,39,39,'affected'
  );

  insert into public.billing_sales(
    id,tenant_id,customer_id,requested_document_type,paid_amount,total_amount,
    balance_due,payment_state,status
  ) values (
    voucher_sale,voucher_tenant,voucher_customer,39,0,12000,12000,'PENDING','PENDING'
  );

  insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
  values(voucher_tenant,voucher_sale,voucher_appointment);

  insert into public.billing_payment_schedule(
    id,tenant_id,sale_id,amount,paid_amount,installment_kind,status
  ) values (
    voucher_schedule,voucher_tenant,voucher_sale,12000,0,'initial','PENDING'
  );

  insert into public.billing_sale_items(
    tenant_id,sale_id,payment_policy_snapshot,
    deposit_tax_document_policy_status_snapshot
  ) values (voucher_tenant,voucher_sale,'full_payment','enabled');

  insert into public.billing_payment_schedule_allocations(
    tenant_id,schedule_id,sale_id,sale_item_id,amount_from,amount_to
  ) select voucher_tenant,voucher_schedule,voucher_sale,item.id,0,12000
      from public.billing_sale_items item
     where item.tenant_id=voucher_tenant and item.sale_id=voucher_sale;

  payment_intent_id_value := public.billing_record_manual_verified_payment(
    voucher_tenant,voucher_appointment,voucher_actor
  );

  if exists (
    select 1 from public.dte_invoice_drafts
     where tenant_id=voucher_tenant
       and payment_intent_id=payment_intent_id_value
  ) or exists (
    select 1 from public.dte_payment_document_intents
     where tenant_id=voucher_tenant
       and payment_intent_id=payment_intent_id_value
  ) then
    raise exception 'VOUCHER_AS_BOLETA_CREATED_DUPLICATE_DTE_PATH';
  end if;

  select count(*) into row_count_value
    from public.billing_sale_item_document_coverage coverage
   where coverage.tenant_id=voucher_tenant
     and coverage.coverage_source='ELECTRONIC_PAYMENT_VOUCHER'
     and coverage.status='ACCEPTED';
  if row_count_value <> 1 then
    raise exception 'VOUCHER_AS_BOLETA_COVERAGE_NOT_PRESERVED';
  end if;
end;
$$;

select 'DTE_PAYMENT_DOCUMENT_PATH_REGRESSIONS_PASSED=3';

rollback;
`;

const providerRegressionAssertions = String.raw`
begin;

do $$
declare
  scenario record;
  provider_value text;
  production_mode_value text;
  expects_automatic boolean;
  tenant_id_value uuid;
  customer_id_value uuid;
  appointment_id_value uuid;
  sale_id_value uuid;
  schedule_id_value uuid;
  payment_intent_id_value uuid;
  provider_payment_id_value text;
  finalize_result boolean;
  dte_intent_id_value uuid;
  row_count_value integer;
begin
  for scenario in
    select * from (values
      ('webpay'::text,'automatic'::text,true),
      ('khipu'::text,'automatic'::text,true),
      ('mercadopago'::text,'automatic'::text,true),
      ('webpay'::text,'manual'::text,false)
    ) as cases(provider,production_mode,expects_automatic)
  loop
    provider_value := scenario.provider;
    production_mode_value := scenario.production_mode;
    expects_automatic := scenario.expects_automatic;
    tenant_id_value := gen_random_uuid();
    customer_id_value := gen_random_uuid();
    appointment_id_value := gen_random_uuid();
    sale_id_value := gen_random_uuid();
    schedule_id_value := gen_random_uuid();
    payment_intent_id_value := gen_random_uuid();
    provider_payment_id_value :=
      provider_value||':'||production_mode_value||':offline-regression';

    insert into public.tenants(id,lifecycle_status,operational_mode)
    values(tenant_id_value,'active','live');

    insert into public.customers(id,tenant_id,full_name)
    values(customer_id_value,tenant_id_value,'Cliente '||provider_value);

    insert into public.dte_tenant_issuance_settings(
      tenant_id,issuance_mode,consumer_document_type,invoice_on_request,
      production_enabled,sii_authorization_status,certificate_ready,
      certificate_valid_to,caf_ready,folio_ready,endpoints_ready,storage_ready,
      worker_ready,readiness_tests_green,deposit_tax_document_policy_status,
      boleta_payment_document_model
    ) values (
      tenant_id_value,'automatic_on_verified_payment','39',true,true,'approved',true,
      now()+interval '30 days',true,true,true,true,true,true,'enabled',
      'always_issue_boleta'
    );

    insert into public.dte_production_tenant_settings(
      tenant_id,enabled,issuance_mode,sii_authorization_status,authorized_types
    ) values (
      tenant_id_value,true,production_mode_value,'approved',array[33,39]
    );

    insert into public.appointments(
      id,tenant_id,customer_id,service_name,service_price,
      payment_required_amount,payment_paid_amount,payment_remaining_amount,
      balance_due,currency,payment_status,status,booking_status,
      invoice_requested,requested_document_type,tax_document_selection,
      tax_treatment_snapshot
    ) values (
      appointment_id_value,tenant_id_value,customer_id_value,
      'Servicio '||provider_value,18000,18000,0,18000,18000,'CLP','pending',
      'pending_payment','pending_payment',false,39,39,'affected'
    );

    insert into public.billing_sales(
      id,tenant_id,customer_id,requested_document_type,paid_amount,total_amount,
      balance_due,payment_state,status
    ) values (
      sale_id_value,tenant_id_value,customer_id_value,39,0,18000,18000,
      'PENDING','PENDING'
    );

    insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
    values(tenant_id_value,sale_id_value,appointment_id_value);

    insert into public.billing_payment_schedule(
      id,tenant_id,sale_id,amount,paid_amount,installment_kind,status
    ) values (
      schedule_id_value,tenant_id_value,sale_id_value,18000,0,'initial','PENDING'
    );

    insert into public.billing_sale_items(
      tenant_id,sale_id,payment_policy_snapshot,
      deposit_tax_document_policy_status_snapshot
    ) values (tenant_id_value,sale_id_value,'full_payment','enabled');

    insert into public.billing_payment_schedule_allocations(
      tenant_id,schedule_id,sale_id,sale_item_id,amount_from,amount_to
    ) select tenant_id_value,schedule_id_value,sale_id_value,item.id,0,18000
        from public.billing_sale_items item
       where item.tenant_id=tenant_id_value and item.sale_id=sale_id_value;

    insert into public.payment_intents(
      id,tenant_id,appointment_id,billing_payment_schedule_id,status,amount,
      currency,provider,provider_payment_id,tax_document_method_classification,
      idempotency_key,audit_metadata
    ) values (
      payment_intent_id_value,tenant_id_value,appointment_id_value,
      schedule_id_value,'pending',18000,'CLP',provider_value,
      provider_payment_id_value,'requires_boleta',
      provider_value||':'||production_mode_value||':offline-regression','{}'
    );

    insert into public.payments(
      tenant_id,appointment_id,payment_intent_id,status,provider,currency,
      amount,external_reference
    ) values (
      tenant_id_value,appointment_id_value,payment_intent_id_value,'pending',
      provider_value,'CLP',18000,provider_payment_id_value
    );

    finalize_result := public.finalize_verified_payment(
      payment_intent_id_value,
      provider_value,
      provider_payment_id_value,
      '{}'
    );
    if finalize_result is distinct from true then
      raise exception '% automatic finalization failed',provider_value;
    end if;

    dte_intent_id_value := null;
    select id into dte_intent_id_value
      from public.dte_payment_document_intents
     where tenant_id=tenant_id_value
       and payment_intent_id=payment_intent_id_value
       and trigger_source=provider_value;
    if expects_automatic then
      if dte_intent_id_value is null then
        raise exception '% automatic intent missing',provider_value;
      end if;

      select count(*) into row_count_value
        from public.dte_issuance_outbox
       where tenant_id=tenant_id_value and intent_id=dte_intent_id_value;
      if row_count_value <> 1 then
        raise exception '% automatic outbox count invalid',provider_value;
      end if;

      if exists (
        select 1 from public.dte_invoice_drafts
         where tenant_id=tenant_id_value
           and payment_intent_id=payment_intent_id_value
      ) then
        raise exception '% created manual review draft',provider_value;
      end if;
    else
      if dte_intent_id_value is not null or exists (
        select 1
          from public.dte_issuance_outbox outbox
          join public.dte_payment_document_intents intent
            on intent.tenant_id=outbox.tenant_id and intent.id=outbox.intent_id
         where intent.tenant_id=tenant_id_value
           and intent.payment_intent_id=payment_intent_id_value
      ) then
        raise exception 'PRODUCTION_MANUAL_KILL_SWITCH_ENQUEUED_AUTOMATIC_DTE';
      end if;

      select count(*) into row_count_value
        from public.dte_invoice_drafts
       where tenant_id=tenant_id_value
         and payment_intent_id=payment_intent_id_value
         and source='payment'
         and status='REVIEW_REQUIRED'
         and review_reason='MANUAL_DTE_REVIEW_REQUIRED';
      if row_count_value <> 1 then
        raise exception 'PRODUCTION_MANUAL_REVIEW_DRAFT_NOT_PRESERVED';
      end if;
    end if;

    finalize_result := public.finalize_verified_payment(
      payment_intent_id_value,
      provider_value,
      provider_payment_id_value,
      '{}'
    );
    if finalize_result is distinct from false then
      raise exception '% replay did not return false',provider_value;
    end if;

    select count(*) into row_count_value
      from public.dte_payment_document_intents
     where tenant_id=tenant_id_value
       and payment_intent_id=payment_intent_id_value;
    if row_count_value <> (case when expects_automatic then 1 else 0 end) then
      raise exception '% replay duplicated intent',provider_value;
    end if;

    select count(*) into row_count_value
      from public.dte_invoice_drafts
     where tenant_id=tenant_id_value
       and payment_intent_id=payment_intent_id_value;
    if row_count_value <> (case when expects_automatic then 0 else 1 end) then
      raise exception '% replay changed review draft count',provider_value;
    end if;
  end loop;
end;
$$;

select 'DTE_PROVIDER_DOCUMENT_PATH_REGRESSIONS_PASSED=4';

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
            cit35CatalogGrossMigration,
            manualVerifiedMigration,
            noDuplicateDraftMigration,
            automaticWorkerHardeningMigration,
            triggerSetup,
            cit35CatalogGrossAssertions,
            assertions,
            policyRegressionAssertions,
            providerRegressionAssertions,
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
        /CIT35_CATALOG_GROSS_PRODUCER_PASSED=1/,
      );
      assert.match(
        run.stdout,
        /DTE_MANUAL_VERIFIED_SQL_ASSERTIONS_PASSED=10/,
      );
      assert.match(
        run.stdout,
        /DTE_PAYMENT_DOCUMENT_PATH_REGRESSIONS_PASSED=3/,
      );
      assert.match(
        run.stdout,
        /DTE_PROVIDER_DOCUMENT_PATH_REGRESSIONS_PASSED=4/,
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
