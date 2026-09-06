import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

function extractRawStringConstant(source, name) {
  const marker = `const ${name} = String.raw\``;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name}`);
  const bodyStart = start + marker.length;
  const end = source.indexOf("\n`;", bodyStart);
  assert.notEqual(end, -1, `Missing ${name} terminator`);
  return source.slice(bodyStart, end);
}

const automaticTest = readFileSync(
  "tests/security/dte-automatic-enqueue-claim-postgres.test.mjs",
  "utf8",
);
const manualTest = readFileSync(
  "tests/security/dte-manual-verified-transfer-postgres.test.mjs",
  "utf8",
);
const accountingMigration = readFileSync(
  "migrations/202608020004_payment_policy_accounting.sql",
  "utf8",
);

const bootstrap = extractRawStringConstant(automaticTest, "bootstrap");
const schemaAugment = extractRawStringConstant(manualTest, "schemaAugment");
const triggerSetup = extractRawStringConstant(manualTest, "triggerSetup");
const unappliedStart = accountingMigration.indexOf(
  "create or replace function public.billing_record_unapplied_provider_payment(",
);
const unappliedEnd = accountingMigration.indexOf("end$$;", unappliedStart);
assert.ok(unappliedStart >= 0 && unappliedEnd > unappliedStart);
const unappliedFunction = accountingMigration.slice(
  unappliedStart,
  unappliedEnd + "end$$;".length,
);

const migrations = [
  "migrations/202608050004_allow_type39_in_claim_outbox_rpcs.sql",
  "migrations/202608110003_enable_automatic_dte_enqueue_and_claim.sql",
  "migrations/202608250001_cit35_preserve_catalog_gross_snapshot.sql",
  "migrations/202608200002_manual_verified_transfer_automatic_dte.sql",
  "migrations/202608220001_prevent_automatic_payment_manual_draft.sql",
  "migrations/202608240001_dte_automatic_worker_canary_fencing.sql",
].map((path) => readFileSync(path, "utf8"));

const cit66Migration = readFileSync(
  "migrations/202609050002_cit66_manual_mercadopago_verification.sql",
  "utf8",
);

const testSchemaAugment = String.raw`
alter table public.billing_sale_payments
  add column verified_at timestamptz not null default now();
`;

const assertions = String.raw`
begin;

do $$
declare
  v_tenant_a constant uuid := '10000000-0000-4000-8000-000000000066';
  v_tenant_b constant uuid := '20000000-0000-4000-8000-000000000066';
  v_actor_id constant uuid := '30000000-0000-4000-8000-000000000066';
  v_customer_id constant uuid := '40000000-0000-4000-8000-000000000066';
  v_appointment_id constant uuid := '50000000-0000-4000-8000-000000000066';
  v_sale_id constant uuid := '60000000-0000-4000-8000-000000000066';
  v_schedule_id constant uuid := '70000000-0000-4000-8000-000000000066';
  v_payment_intent_id constant uuid := '80000000-0000-4000-8000-000000000066';
  v_webhook_appointment_id constant uuid := '51000000-0000-4000-8000-000000000066';
  v_webhook_sale_id constant uuid := '61000000-0000-4000-8000-000000000066';
  v_webhook_schedule_id constant uuid := '71000000-0000-4000-8000-000000000066';
  v_webhook_intent_id constant uuid := '81000000-0000-4000-8000-000000000066';
  v_preference_id constant text := 'MP-PREFERENCE-CIT66';
  v_real_payment_id constant text := '660000001';
  v_webhook_preference_id constant text := 'MP-PREFERENCE-CIT66-WEBHOOK';
  v_webhook_payment_id constant text := '660000002';
  v_evidence jsonb;
  v_webhook_evidence jsonb;
  v_original_intent_audit jsonb;
  v_original_payment_audit jsonb;
  v_original_verified_by uuid;
  v_original_verified_at timestamptz;
  v_original_evidence_sha256 text;
  v_outcome text;
  v_transitioned boolean;
  v_row_count integer;
begin
  v_evidence := jsonb_build_object(
    'payment_id',v_real_payment_id,
    'status','approved',
    'date_approved','2026-09-05T12:00:00Z',
    'transaction_amount',18500,
    'currency_id','CLP',
    'external_reference',v_payment_intent_id::text,
    'verification_source','admin_mercadopago_lookup',
    'discarded_payload',jsonb_build_object('payer_email','private@example.invalid')
  );

  insert into public.tenants(id,lifecycle_status,operational_mode)
  values
    (v_tenant_a,'active','live'),
    (v_tenant_b,'active','live');
  insert into public.customers(id,tenant_id,full_name)
  values(v_customer_id,v_tenant_a,'Cliente CIT-66');
  insert into public.dte_tenant_issuance_settings(
    tenant_id,issuance_mode,consumer_document_type,invoice_on_request,
    production_enabled,sii_authorization_status,certificate_ready,
    certificate_valid_to,caf_ready,folio_ready,endpoints_ready,storage_ready,
    worker_ready,readiness_tests_green,deposit_tax_document_policy_status,
    boleta_payment_document_model
  ) values (
    v_tenant_a,'automatic_on_verified_payment','39',true,true,'approved',true,
    now()+interval '30 days',true,true,true,true,true,true,'enabled',
    'always_issue_boleta'
  );
  insert into public.dte_production_tenant_settings(
    tenant_id,enabled,issuance_mode,sii_authorization_status,authorized_types
  ) values(v_tenant_a,true,'automatic','approved',array[33,39]);
  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,
    payment_required_amount,payment_paid_amount,payment_remaining_amount,
    balance_due,currency,payment_status,payment_provider,status,booking_status,
    invoice_requested,requested_document_type,tax_document_selection,
    tax_treatment_snapshot
  ) values (
    v_appointment_id,v_tenant_a,v_customer_id,'Servicio CIT-66',18500,
    18500,0,18500,18500,'CLP','pending','mercadopago',
    'pending_payment','pending_payment',false,39,39,'affected'
  );
  insert into public.billing_sales(
    id,tenant_id,customer_id,requested_document_type,paid_amount,total_amount,
    balance_due,payment_state,status
  ) values(v_sale_id,v_tenant_a,v_customer_id,39,0,18500,18500,'PENDING','PENDING');
  insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
  values(v_tenant_a,v_sale_id,v_appointment_id);
  insert into public.billing_payment_schedule(
    id,tenant_id,sale_id,amount,paid_amount,installment_kind,status
  ) values(v_schedule_id,v_tenant_a,v_sale_id,18500,0,'initial','PENDING');
  insert into public.billing_sale_items(
    tenant_id,sale_id,payment_policy_snapshot,
    deposit_tax_document_policy_status_snapshot
  ) values(v_tenant_a,v_sale_id,'full_payment','enabled');
  insert into public.billing_payment_schedule_allocations(
    tenant_id,schedule_id,sale_id,sale_item_id,amount_from,amount_to
  ) select v_tenant_a,v_schedule_id,v_sale_id,item.id,0,18500
      from public.billing_sale_items item
     where item.tenant_id=v_tenant_a and item.sale_id=v_sale_id;
  insert into public.payment_intents(
    id,tenant_id,appointment_id,billing_payment_schedule_id,status,amount,
    currency,provider,provider_payment_id,tax_document_method_classification,
    idempotency_key,audit_metadata
  ) values (
    v_payment_intent_id,v_tenant_a,v_appointment_id,v_schedule_id,'pending',18500,
    'CLP','mercadopago',v_preference_id,'requires_boleta','cit66-intent','{}'
  );
  insert into public.payments(
    tenant_id,appointment_id,payment_intent_id,status,provider,currency,
    amount,external_reference
  ) values(
    v_tenant_a,v_appointment_id,v_payment_intent_id,'pending','mercadopago','CLP',
    18500,v_preference_id
  );

  begin
    perform public.billing_confirm_manually_verified_mercadopago_payment(
      v_tenant_b,v_appointment_id,v_payment_intent_id,v_preference_id,v_real_payment_id,
      18500,v_actor_id,v_evidence
    );
    raise exception 'CIT66_EXPECTED_TENANT_REJECTION';
  exception when others then
    if sqlerrm='CIT66_EXPECTED_TENANT_REJECTION'
       or position('MERCADOPAGO_MANUAL_VERIFICATION_INTENT_MISMATCH' in sqlerrm)=0 then
      raise;
    end if;
  end;

  v_outcome := public.billing_confirm_manually_verified_mercadopago_payment(
    v_tenant_a,v_appointment_id,v_payment_intent_id,v_preference_id,v_real_payment_id,
    18500,v_actor_id,v_evidence
  );
  if v_outcome is distinct from 'transitioned' then
    raise exception 'CIT66_FIRST_CONFIRMATION_FAILED';
  end if;
  if not exists(
    select 1 from public.payment_intents
     where id=v_payment_intent_id and tenant_id=v_tenant_a and status='succeeded'
       and provider_payment_id=v_preference_id
       and verified_provider_payment_id=v_real_payment_id
       and audit_metadata->>'payment_id'=v_real_payment_id
       and audit_metadata->>'verification_source'='admin_mercadopago_lookup'
       and not (audit_metadata ? 'discarded_payload')
  ) then raise exception 'CIT66_INTENT_EVIDENCE_INVALID';end if;
  if not exists(
    select 1 from public.billing_sale_payments
     where tenant_id=v_tenant_a and payment_intent_id=v_payment_intent_id
       and provider='mercadopago' and status='VERIFIED'
       and validation_result='provider_verified'
       and reconciliation_status='NOT_REQUIRED'
       and verified_by=v_actor_id and verified_at is not null
  ) then raise exception 'CIT66_ACTOR_EVIDENCE_MISSING';end if;

  v_outcome := public.billing_confirm_manually_verified_mercadopago_payment(
    v_tenant_a,v_appointment_id,v_payment_intent_id,v_preference_id,v_real_payment_id,
    18500,v_actor_id,v_evidence
  );
  if v_outcome is distinct from 'replay' then
    raise exception 'CIT66_REPLAY_RESULT_INVALID';
  end if;

  select count(*) into v_row_count from public.billing_sale_payments
   where tenant_id=v_tenant_a and payment_intent_id=v_payment_intent_id;
  if v_row_count<>1 then raise exception 'CIT66_DUPLICATE_SALE_PAYMENT';end if;
  select count(*) into v_row_count from public.billing_payment_schedule_events
   where tenant_id=v_tenant_a and schedule_id=v_schedule_id and event_type='PAID';
  if v_row_count<>1 then raise exception 'CIT66_DUPLICATE_PAID_EVENT';end if;
  select count(*) into v_row_count from public.dte_payment_document_intents
   where tenant_id=v_tenant_a and payment_intent_id=v_payment_intent_id
     and trigger_source='mercadopago';
  if v_row_count<>1 then raise exception 'CIT66_DTE_INTENT_COUNT_INVALID';end if;
  select count(*) into v_row_count from public.dte_issuance_outbox outbox
   join public.dte_payment_document_intents intent
     on intent.tenant_id=outbox.tenant_id and intent.id=outbox.intent_id
   where intent.tenant_id=v_tenant_a and intent.payment_intent_id=v_payment_intent_id;
  if v_row_count<>1 then raise exception 'CIT66_DTE_OUTBOX_COUNT_INVALID';end if;
  if exists(select 1 from public.dte_production_documents where tenant_id=v_tenant_a)
     or exists(select 1 from public.dte_production_folio_ledger where tenant_id=v_tenant_a) then
    raise exception 'CIT66_TOUCHED_DOCUMENT_OR_FOLIO';
  end if;

  -- The provider transaction namespace is tenant-scoped: the same Mercado Pago
  -- Payment ID is valid for another tenant, but not twice for one tenant/provider.
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,
    provider_payment_id,verified_provider_payment_id,idempotency_key,audit_metadata
  ) values (
    '82000000-0000-4000-8000-000000000066',v_tenant_b,
    '52000000-0000-4000-8000-000000000066','pending',18500,'CLP',
    'mercadopago','MP-PREFERENCE-TENANT-B',v_real_payment_id,
    'cit66-index-tenant-b','{}'
  );
  select count(*) into v_row_count
    from public.payment_intents
   where provider='mercadopago'
     and verified_provider_payment_id=v_real_payment_id
     and tenant_id in (v_tenant_a,v_tenant_b);
  if v_row_count<>2 then
    raise exception 'CIT66_VERIFIED_PAYMENT_ID_NOT_TENANT_SCOPED';
  end if;
  begin
    insert into public.payment_intents(
      id,tenant_id,appointment_id,status,amount,currency,provider,
      provider_payment_id,verified_provider_payment_id,idempotency_key,audit_metadata
    ) values (
      '83000000-0000-4000-8000-000000000066',v_tenant_a,
      '53000000-0000-4000-8000-000000000066','pending',18500,'CLP',
      'mercadopago','MP-PREFERENCE-TENANT-A-DUPLICATE',v_real_payment_id,
      'cit66-index-tenant-a-duplicate','{}'
    );
    raise exception 'CIT66_EXPECTED_SAME_TENANT_DUPLICATE_REJECTION';
  exception when unique_violation then
    null;
  end;

  -- Simulate an existing webhook verification. The subsequent manual lookup may
  -- backfill only the real Payment ID and must preserve the original evidence.
  v_webhook_evidence := jsonb_build_object(
    'payment_id',v_webhook_payment_id,
    'status','approved',
    'date_approved','2026-09-05T13:00:00Z',
    'transaction_amount',18500,
    'currency_id','CLP',
    'external_reference',v_webhook_intent_id::text
  );
  insert into public.appointments(
    id,tenant_id,customer_id,service_name,service_price,
    payment_required_amount,payment_paid_amount,payment_remaining_amount,
    balance_due,currency,payment_status,payment_provider,status,booking_status,
    invoice_requested,requested_document_type,tax_document_selection,
    tax_treatment_snapshot
  ) values (
    v_webhook_appointment_id,v_tenant_a,v_customer_id,'Servicio webhook CIT-66',18500,
    18500,0,18500,18500,'CLP','pending','mercadopago',
    'pending_payment','pending_payment',false,39,39,'affected'
  );
  insert into public.billing_sales(
    id,tenant_id,customer_id,requested_document_type,paid_amount,total_amount,
    balance_due,payment_state,status
  ) values (
    v_webhook_sale_id,v_tenant_a,v_customer_id,39,0,18500,18500,'PENDING','PENDING'
  );
  insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
  values(v_tenant_a,v_webhook_sale_id,v_webhook_appointment_id);
  insert into public.billing_payment_schedule(
    id,tenant_id,sale_id,amount,paid_amount,installment_kind,status
  ) values(v_webhook_schedule_id,v_tenant_a,v_webhook_sale_id,18500,0,'initial','PENDING');
  insert into public.billing_sale_items(
    tenant_id,sale_id,payment_policy_snapshot,
    deposit_tax_document_policy_status_snapshot
  ) values(v_tenant_a,v_webhook_sale_id,'full_payment','enabled');
  insert into public.billing_payment_schedule_allocations(
    tenant_id,schedule_id,sale_id,sale_item_id,amount_from,amount_to
  ) select v_tenant_a,v_webhook_schedule_id,v_webhook_sale_id,item.id,0,18500
      from public.billing_sale_items item
     where item.tenant_id=v_tenant_a and item.sale_id=v_webhook_sale_id;
  insert into public.payment_intents(
    id,tenant_id,appointment_id,billing_payment_schedule_id,status,amount,
    currency,provider,provider_payment_id,tax_document_method_classification,
    idempotency_key,audit_metadata
  ) values (
    v_webhook_intent_id,v_tenant_a,v_webhook_appointment_id,v_webhook_schedule_id,
    'pending',18500,'CLP','mercadopago',v_webhook_preference_id,
    'requires_boleta','cit66-webhook-intent','{}'
  );
  insert into public.payments(
    tenant_id,appointment_id,payment_intent_id,status,provider,currency,
    amount,external_reference
  ) values(
    v_tenant_a,v_webhook_appointment_id,v_webhook_intent_id,'pending',
    'mercadopago','CLP',18500,v_webhook_preference_id
  );

  v_transitioned := public.finalize_verified_payment(
    v_webhook_intent_id,'mercadopago',v_webhook_preference_id,v_webhook_evidence
  );
  if v_transitioned is distinct from true then
    raise exception 'CIT66_WEBHOOK_FIXTURE_DID_NOT_TRANSITION';
  end if;
  select audit_metadata into v_original_intent_audit
    from public.payment_intents
   where id=v_webhook_intent_id and tenant_id=v_tenant_a;
  select audit_metadata into v_original_payment_audit
    from public.payments
   where payment_intent_id=v_webhook_intent_id and tenant_id=v_tenant_a;
  select verified_by,verified_at,evidence_sha256
    into v_original_verified_by,v_original_verified_at,v_original_evidence_sha256
    from public.billing_sale_payments
   where payment_intent_id=v_webhook_intent_id and tenant_id=v_tenant_a;
  if v_original_verified_by is not null then
    raise exception 'CIT66_WEBHOOK_ACTOR_FIXTURE_INVALID';
  end if;

  v_outcome := public.billing_confirm_manually_verified_mercadopago_payment(
    v_tenant_a,v_webhook_appointment_id,v_webhook_intent_id,
    v_webhook_preference_id,v_webhook_payment_id,18500,v_actor_id,
    v_webhook_evidence || jsonb_build_object(
      'verification_source','admin_mercadopago_lookup'
    )
  );
  if v_outcome is distinct from 'replay' then
    raise exception 'CIT66_WEBHOOK_MANUAL_REPLAY_RESULT_INVALID';
  end if;
  if not exists(
    select 1
      from public.payment_intents intent
      join public.payments payment
        on payment.tenant_id=intent.tenant_id
       and payment.payment_intent_id=intent.id
      join public.billing_sale_payments sale_payment
        on sale_payment.tenant_id=intent.tenant_id
       and sale_payment.payment_intent_id=intent.id
     where intent.id=v_webhook_intent_id
       and intent.tenant_id=v_tenant_a
       and intent.verified_provider_payment_id=v_webhook_payment_id
       and intent.audit_metadata=v_original_intent_audit
       and payment.audit_metadata=v_original_payment_audit
       and sale_payment.verified_by is not distinct from v_original_verified_by
       and sale_payment.verified_at is not distinct from v_original_verified_at
       and sale_payment.evidence_sha256 is not distinct from v_original_evidence_sha256
  ) then
    raise exception 'CIT66_WEBHOOK_REPLAY_REWROTE_PROVENANCE';
  end if;
end;
$$;

select 'CIT66_MANUAL_MERCADOPAGO_POSTGRES_PASSED=1';
rollback;
`;

test("PostgreSQL keeps CIT-66 atomic, tenant-scoped, idempotent and on the existing DTE path", () => {
  const database = `citaya_cit66_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync(
    "docker",
    [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `create database ${database}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(create.status, 0, create.stderr);

  try {
    const run = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      {
        input: [
          bootstrap,
          migrations[0],
          migrations[1],
          schemaAugment,
          migrations[2],
          migrations[3],
          migrations[4],
          migrations[5],
          testSchemaAugment,
          unappliedFunction,
          triggerSetup,
          cit66Migration,
          assertions,
        ].join("\n\n"),
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /CIT66_MANUAL_MERCADOPAGO_POSTGRES_PASSED=1/);
  } finally {
    const drop = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `drop database if exists ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(drop.status, 0, drop.stderr);
  }
});
