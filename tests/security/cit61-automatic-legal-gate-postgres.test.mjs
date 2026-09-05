import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const migrationPath =
  "migrations/202609040001_cit61_automatic_legal_gate.sql";
const migration = readFileSync(migrationPath, "utf8");
const productionRepository = readFileSync(
  "lib/dte/production/supabase-repository.ts",
  "utf8",
);

test("CIT-61 source keeps one automatic-only legal authority and least privilege", () => {
  assert.match(migration, /dte_automatic_issuance_gate_report/);
  assert.match(migration, /tenant_legal_gate_report/);
  assert.match(migration, /'dteAuthorityReady'/);
  assert.match(migration, /AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK/);
  assert.match(migration, /dte_begin_automatic_network_attempt/);
  assert.match(migration, /dte_claim_automatic_pre_network_resume_exact/);
  assert.match(migration, /POSSIBLE_DUPLICATE_DOCUMENT_REVIEW_REQUIRED/);
  assert.match(migration, /errcode = 'P6101'/);
  assert.match(
    productionRepository,
    /P6101[\s\S]*DTE_AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK/,
  );
  assert.doesNotMatch(migration, /create or replace function public\.dte_activation_gate_report/);
  assert.match(migration, /security definer\nset search_path = ''/g);
  assert.doesNotMatch(migration, /(?:net\.http|http_(?:get|post)|dblink|pg_net)/i);
});

function automaticBootstrap() {
  const source = readFileSync(
    "tests/security/dte-automatic-enqueue-claim-postgres.test.mjs",
    "utf8",
  );
  const marker = "const bootstrap = String.raw`";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf("\n`;\n", start);
  assert.ok(start >= marker.length && end > start);
  return source.slice(start, end);
}

const priorMigrations = [
  "migrations/202608050004_allow_type39_in_claim_outbox_rpcs.sql",
  "migrations/202608050005_allow_type39_in_reserve_folio.sql",
  "migrations/202608110003_enable_automatic_dte_enqueue_and_claim.sql",
  "migrations/202608240001_dte_automatic_worker_canary_fencing.sql",
  "migrations/202608260001_cit33_allow_owned_last_folio.sql",
  "migrations/202608260002_cit33_claim_owned_folio_resume.sql",
  "migrations/202608270001_dte_quarantine_automatic_issuance_exact.sql",
].map((path) => readFileSync(path, "utf8")).join("\n");

const controls = String.raw`
alter table public.dte_production_documents
  add column updated_at timestamptz not null default pg_catalog.now();
alter table public.dte_production_folio_ledger
  add column updated_at timestamptz not null default pg_catalog.now();
alter table public.dte_production_submission_attempts
  add column attempt_number integer not null default 1,
  add column request_sha256 text;
create table public.dte_production_audit(
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  document_id uuid,
  action text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);
create table public.dte_production_artifacts(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null
);
create table public.cit61_legal_control(
  tenant_id uuid primary key,
  ready boolean not null
);
create or replace function public.tenant_legal_gate_report(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select pg_catalog.jsonb_build_object(
    'ready',coalesce((select ready from public.cit61_legal_control where tenant_id=p_tenant_id),false),
    'dteAuthorityReady',coalesce((select ready from public.cit61_legal_control where tenant_id=p_tenant_id),false)
  )
$$;
create or replace function public.resolve_tenant_operational_capabilities(
  p_tenant_id uuid
)
returns jsonb language sql stable security definer set search_path=''
as $$
  select case tenant.operational_mode
    when 'internal' then
      '{"operationalMode":"internal","enqueueDte":false,"runDteWorker":false,"confirmTransfer":true,"manualDteEnqueue":true}'::jsonb
    when 'live' then
      '{"operationalMode":"live","enqueueDte":true,"runDteWorker":true,"confirmTransfer":true,"manualDteEnqueue":true}'::jsonb
    else '{}'::jsonb
  end
  from public.tenants tenant
  where tenant.id = p_tenant_id
$$;
`;

const assertions = String.raw`
begin;
do $$
declare
  tenant_a constant uuid := '61000000-0000-4000-8000-000000000001';
  tenant_b constant uuid := '61000000-0000-4000-8000-000000000002';
  appointment_a constant uuid := '62000000-0000-4000-8000-000000000001';
  payment_a constant uuid := '63000000-0000-4000-8000-000000000001';
  caf_a constant uuid := '64000000-0000-4000-8000-000000000001';
  document_a constant uuid := '65000000-0000-4000-8000-000000000001';
  tenant_manual constant uuid := '61000000-0000-4000-8000-000000000003';
  appointment_manual constant uuid := '62000000-0000-4000-8000-000000000003';
  payment_manual constant uuid := '63000000-0000-4000-8000-000000000003';
  caf_manual constant uuid := '64000000-0000-4000-8000-000000000003';
  actor_manual constant uuid := '66000000-0000-4000-8000-000000000003';
  intent_a uuid;
  intent_manual uuid;
  outbox_a public.dte_issuance_outbox%rowtype;
  outbox_manual public.dte_issuance_outbox%rowtype;
  resumed public.dte_issuance_outbox%rowtype;
  report jsonb;
  mutation_ok boolean;
  attempt_id uuid;
begin
  insert into public.tenants(id) values(tenant_a),(tenant_b);
  insert into public.cit61_legal_control values(tenant_a,false),(tenant_b,true);
  insert into public.appointments(
    id,tenant_id,service_name,service_price,payment_paid_amount,currency,
    payment_status,status,invoice_requested,requested_document_type,
    tax_document_selection,tax_treatment_snapshot,invoice_receiver_rut,
    invoice_receiver_legal_name,invoice_receiver_activity,
    invoice_receiver_address,invoice_receiver_commune,invoice_receiver_city
  ) values(
    appointment_a,tenant_a,'Consulta',1190,1190,'CLP','paid','confirmed',
    true,33,33,'affected','11111111-1','Cliente SpA','Servicios',
    'Calle 1','Santiago','Santiago'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider,provider_payment_id
  ) values(payment_a,tenant_a,appointment_a,'succeeded',1190,'CLP','webpay','wp-61');
  insert into public.billing_sale_payments(
    tenant_id,appointment_id,payment_intent_id,provider,status,
    validation_result,reconciliation_status
  ) values(
    tenant_a,appointment_a,payment_a,'webpay','VERIFIED',
    'provider_verified','NOT_REQUIRED'
  );
  insert into public.dte_tenant_issuance_settings values(
    tenant_a,'automatic_on_verified_payment','39',true,true,'approved',
    true,pg_catalog.now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_a,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values(tenant_a,33,'active');
  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state
  ) values(tenant_a,33,61001,caf_a,'available');

  intent_a := public.dte_enqueue_payment_snapshot(
    tenant_a,appointment_a,payment_a,'webpay:wp-61','webpay',null
  );
  select * into outbox_a from public.dte_issuance_outbox
   where tenant_id=tenant_a and intent_id=intent_a;
  if outbox_a.status <> 'BLOCKED'
     or outbox_a.last_safe_error <> 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
     or not exists(select 1 from public.payment_intents where id=payment_a and status='succeeded') then
    raise exception 'CIT61_ENQUEUE_DID_NOT_BLOCK_LEGAL_ONLY';
  end if;
  if exists(select 1 from public.dte_production_documents where tenant_id=tenant_a)
     or exists(select 1 from public.dte_production_folio_ledger where tenant_id=tenant_a and state<>'available') then
    raise exception 'CIT61_ENQUEUE_CREATED_FISCAL_EFFECT';
  end if;
  report := public.dte_automatic_issuance_gate_report(tenant_a,intent_a);
  if (report->>'legalReady')::boolean or (report->>'dteAuthorityReady')::boolean
     or (report->>'ready')::boolean then
    raise exception 'CIT61_LEGAL_REPORT_OPEN';
  end if;
  if (public.dte_automatic_issuance_gate_report(tenant_b,intent_a)->>'ready')::boolean then
    raise exception 'CIT61_CROSS_TENANT_REPORT_OPEN';
  end if;
  begin
    perform public.dte_claim_automatic_issuance_outbox_exact('cit61-canary',outbox_a.id);
    raise exception 'CIT61_CLOSED_CANARY_CLAIMED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE%' then raise; end if;
  end;
  if exists(
    select 1 from public.dte_claim_automatic_issuance_outbox('cit61-normal')
  ) then raise exception 'CIT61_CLOSED_NORMAL_CLAIMED'; end if;

  update public.cit61_legal_control set ready=true where tenant_id=tenant_a;
  select * into resumed
    from public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-resume',outbox_a.id
    );
  if resumed.id <> outbox_a.id or resumed.status <> 'PROCESSING' then
    raise exception 'CIT61_EXACT_RESUME_FAILED';
  end if;
  begin
    perform public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-resume-replay',outbox_a.id
    );
    raise exception 'CIT61_RESUME_REPLAY_ALLOWED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE%' then raise; end if;
  end;

  insert into public.dte_production_documents(
    id,tenant_id,dte_type,business_operation_id,status,folio,caf_id
  ) values(
    document_a,tenant_a,33,'intent:'||intent_a::text,'draft',null,null
  );
  update public.cit61_legal_control set ready=false where tenant_id=tenant_a;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    resumed.id,resumed.locked_by,resumed.claim_token,'PREPARING',document_a
  );
  if mutation_ok or not exists(
    select 1 from public.dte_payment_document_intents intent
    join public.dte_issuance_outbox outbox
      on outbox.tenant_id=intent.tenant_id and outbox.intent_id=intent.id
    where intent.id=intent_a and intent.production_document_id=document_a
      and intent.status='BLOCKED' and outbox.status='BLOCKED'
      and intent.safe_blocking_reason='AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
  ) then raise exception 'CIT61_DRAFT_NOT_PRESERVED_AT_FENCE'; end if;
  begin
    perform public.reserve_dte_production_folio(
      tenant_a,33,document_a,'intent:'||intent_a::text
    );
    raise exception 'CIT61_RESERVE_IGNORED_LEGAL_CLOSE';
  exception
    when sqlstate 'P6101' then null;
  end;
  begin
    perform public.reserve_dte_production_folio(
      tenant_b,33,document_a,'intent:'||intent_a::text
    );
    raise exception 'CIT61_CROSS_TENANT_RESERVE_OPENED';
  exception
    when sqlstate 'P6103' then null;
  end;
  if exists(
    select 1 from public.dte_production_folio_ledger
     where tenant_id=tenant_a and state<>'available'
  ) then raise exception 'CIT61_CLOSED_RESERVE_CONSUMED_FOLIO'; end if;

  update public.cit61_legal_control set ready=true where tenant_id=tenant_a;
  select * into resumed
    from public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-resume-draft',outbox_a.id
    );
  update public.dte_production_documents
     set status='ready',folio=61001,caf_id=caf_a
   where id=document_a;
  update public.dte_production_folio_ledger
     set state='reserved',document_id=document_a,
         business_operation_id='intent:'||intent_a::text,
         reserved_at=pg_catalog.now()
   where tenant_id=tenant_a and dte_type=33 and folio=61001;
  update public.dte_payment_document_intents
     set status='SUBMITTING'
   where id=intent_a;

  update public.cit61_legal_control set ready=false where tenant_id=tenant_a;
  attempt_id := public.dte_begin_automatic_network_attempt(
    resumed.id,resumed.locked_by,resumed.claim_token,document_a,
    pg_catalog.repeat('a',64)
  );
  if attempt_id is not null then raise exception 'CIT61_CLOSED_BOUNDARY_OPENED'; end if;
  if not exists(
    select 1 from public.dte_payment_document_intents intent
    join public.dte_issuance_outbox outbox
      on outbox.tenant_id=intent.tenant_id and outbox.intent_id=intent.id
    where intent.id=intent_a
      and intent.status='BLOCKED' and outbox.status='BLOCKED'
      and intent.safe_blocking_reason='AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
      and outbox.last_safe_error='AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
      and intent.network_attempt_count=0 and outbox.network_attempts=0
  ) then raise exception 'CIT61_BLOCKED_PAIR_INCOHERENT'; end if;
  if not exists(
    select 1 from public.dte_production_folio_ledger
     where tenant_id=tenant_a and document_id=document_a and state='reserved'
  ) or exists(
    select 1 from public.dte_production_submission_attempts
     where tenant_id=tenant_a and document_id=document_a
  ) then raise exception 'CIT61_CLOSED_BOUNDARY_MUTATED_FISCAL_STATE'; end if;

  update public.cit61_legal_control set ready=true where tenant_id=tenant_a;
  select * into resumed
    from public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-resume-owned',outbox_a.id
    );
  update public.dte_payment_document_intents set status='SUBMITTING'
   where id=intent_a;
  attempt_id := public.dte_begin_automatic_network_attempt(
    resumed.id,resumed.locked_by,resumed.claim_token,document_a,
    pg_catalog.repeat('b',64)
  );
  if attempt_id is null or not exists(
    select 1 from public.dte_production_submission_attempts attempt
     where attempt.id=attempt_id and attempt.tenant_id=tenant_a
       and attempt.document_id=document_a and attempt.before_fetch_at is not null
  ) or not exists(
    select 1 from public.dte_production_folio_ledger ledger
     where ledger.tenant_id=tenant_a and ledger.document_id=document_a
       and ledger.folio=61001 and ledger.state='issued'
  ) or not exists(
    select 1 from public.dte_payment_document_intents intent
    join public.dte_issuance_outbox outbox
      on outbox.tenant_id=intent.tenant_id and outbox.intent_id=intent.id
    where intent.id=intent_a and intent.network_attempt_count=1
      and outbox.network_attempts=1
  ) then raise exception 'CIT61_BOUNDARY_NOT_ATOMIC'; end if;

  update public.cit61_legal_control set ready=false where tenant_id=tenant_a;
  mutation_ok := public.dte_mutate_automatic_issuance_claim(
    resumed.id,resumed.locked_by,resumed.claim_token,'NETWORK_BOUNDARY',
    document_a,null,null,null,null,'{}'::jsonb,attempt_id,'token_before_fetch'
  );
  if mutation_ok or not exists(
    select 1 from public.dte_payment_document_intents intent
    join public.dte_issuance_outbox outbox
      on outbox.tenant_id=intent.tenant_id and outbox.intent_id=intent.id
    where intent.id=intent_a and intent.status='AMBIGUOUS'
      and outbox.status='AMBIGUOUS'
      and intent.safe_blocking_reason='AUTOMATIC_GATE_CLOSED_POST_NETWORK'
      and outbox.last_safe_error='AUTOMATIC_GATE_CLOSED_POST_NETWORK'
  ) then raise exception 'CIT61_POST_NETWORK_STATE_REPLAYABLE'; end if;

  update public.cit61_legal_control set ready=true where tenant_id=tenant_a;
  begin
    perform public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-network-replay',outbox_a.id
    );
    raise exception 'CIT61_NETWORK_EVIDENCE_REVIVED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE%' then raise; end if;
  end;

  update public.dte_payment_document_intents
     set status='BLOCKED',network_attempt_count=0,
         safe_blocking_reason='AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
   where id=intent_a;
  update public.dte_issuance_outbox
     set status='BLOCKED',network_attempts=0,
         last_safe_error='AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
         locked_at=null,locked_by=null,claim_token=null,lease_expires_at=null
   where id=outbox_a.id;
  update public.dte_production_documents set status='ready' where id=document_a;
  update public.dte_production_folio_ledger set state='reserved'
   where tenant_id=tenant_a and document_id=document_a;
  begin
    perform public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-before-fetch-replay',outbox_a.id
    );
    raise exception 'CIT61_BEFORE_FETCH_EVIDENCE_REVIVED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE%' then raise; end if;
  end;

  insert into public.tenants(id,operational_mode)
  values(tenant_manual,'internal');
  insert into public.cit61_legal_control values(tenant_manual,true);
  insert into public.appointments(
    id,tenant_id,service_name,service_price,payment_paid_amount,currency,
    payment_status,status,invoice_requested,requested_document_type,
    tax_document_selection,tax_treatment_snapshot,invoice_receiver_rut,
    invoice_receiver_legal_name,invoice_receiver_activity,
    invoice_receiver_address,invoice_receiver_commune,invoice_receiver_city
  ) values(
    appointment_manual,tenant_manual,'Consulta manual',1190,1190,'CLP',
    'paid','confirmed',true,33,33,'affected','11111111-1','Cliente SpA',
    'Servicios','Calle 1','Santiago','Santiago'
  );
  insert into public.payment_intents(
    id,tenant_id,appointment_id,status,amount,currency,provider
  ) values(
    payment_manual,tenant_manual,appointment_manual,'succeeded',1190,'CLP','manual'
  );
  insert into public.billing_sale_payments(
    tenant_id,appointment_id,payment_intent_id,provider,status,
    validation_result,reconciliation_status,verified_by
  ) values(
    tenant_manual,appointment_manual,payment_manual,'manual','VERIFIED',
    'provider_verified','NOT_REQUIRED',actor_manual
  );
  insert into public.dte_tenant_issuance_settings values(
    tenant_manual,'automatic_on_verified_payment','39',true,true,'approved',
    true,pg_catalog.now()+interval '30 days',true,true,true,true,true,true,'enabled'
  );
  insert into public.dte_production_tenant_settings
  values(tenant_manual,true,'automatic','approved',array[33,39]);
  insert into public.dte_legal_activation values(tenant_manual,33,'active');
  insert into public.dte_production_folio_ledger(
    tenant_id,dte_type,folio,caf_id,state
  ) values(tenant_manual,33,61003,caf_manual,'available');

  insert into public.dte_payment_document_intents(
    tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
    idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
    currency,appointment_snapshot,receiver_snapshot,status,created_by
  ) values(
    tenant_manual,appointment_manual,payment_manual,
    'manual_verified:'||payment_manual::text,'manual_verified',
    pg_catalog.repeat('c',64),'invoice',33,1190,'CLP','{}'::jsonb,
    '{}'::jsonb,'PENDING',actor_manual
  ) returning id into intent_manual;
  insert into public.dte_issuance_outbox(
    tenant_id,intent_id,status,issuance_origin
  ) values(tenant_manual,intent_manual,'PENDING','automatic_system');
  report := public.dte_automatic_issuance_gate_report(
    tenant_manual,intent_manual
  );
  if report->'ready' is distinct from 'true'::jsonb
     or report->'operationalModeReady' is distinct from 'true'::jsonb
     or report->'operationalCapabilityReady' is distinct from 'true'::jsonb
     or public.resolve_tenant_operational_capabilities(tenant_manual)
          ->'enqueueDte' is distinct from 'false'::jsonb
     or public.resolve_tenant_operational_capabilities(tenant_manual)
          ->'runDteWorker' is distinct from 'false'::jsonb then
    raise exception 'CIT61_MANUAL_VERIFIED_CAPABILITY_CONTRACT_BROKEN';
  end if;
  select * into outbox_manual from public.dte_issuance_outbox
   where tenant_id=tenant_manual and intent_id=intent_manual;
  perform public.dte_quarantine_automatic_issuance_exact(
    tenant_manual,outbox_manual.id,intent_manual,33,
    'POSSIBLE_DUPLICATE_DOCUMENT_REVIEW_REQUIRED'
  );
  if public.dte_retry_blocked_issuance(tenant_manual,intent_manual) then
    raise exception 'CIT61_QUARANTINE_REOPENED';
  end if;
  begin
    perform public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-quarantine-replay',outbox_manual.id
    );
    raise exception 'CIT61_QUARANTINE_RESUME_ALLOWED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE%' then raise; end if;
  end;
  update public.dte_payment_document_intents
     set safe_blocking_reason='NETWORK_RESULT_UNKNOWN'
   where id=intent_manual;
  update public.dte_issuance_outbox
     set last_safe_error='NETWORK_RESULT_UNKNOWN'
   where id=outbox_manual.id;
  if public.dte_retry_blocked_issuance(tenant_manual,intent_manual) then
    raise exception 'CIT61_NETWORK_UNKNOWN_REOPENED';
  end if;
  begin
    perform public.dte_claim_automatic_pre_network_resume_exact(
      'cit61-unknown-replay',outbox_manual.id
    );
    raise exception 'CIT61_NETWORK_UNKNOWN_RESUME_ALLOWED';
  exception when others then
    if sqlerrm not like '%DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE%' then raise; end if;
  end;

  if pg_catalog.has_function_privilege(
       'anon','public.dte_begin_automatic_network_attempt(uuid,text,uuid,uuid,text)','EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'authenticated','public.dte_claim_automatic_pre_network_resume_exact(text,uuid)','EXECUTE'
     ) or not pg_catalog.has_function_privilege(
       'service_role','public.dte_begin_automatic_network_attempt(uuid,text,uuid,uuid,text)','EXECUTE'
     ) then raise exception 'CIT61_ACL_INVALID'; end if;
end;
$$;
select 'CIT61_AUTOMATIC_LEGAL_GATE_ASSERTIONS_PASSED=31';
rollback;
`;

test("CIT-61 PostgreSQL gate blocks, isolates, resumes exactly, and preserves payment", () => {
  const database = `citaya_cit61_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", [
    "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  try {
    const run = spawnSync("docker", [
      "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", database, "-v", "ON_ERROR_STOP=1",
    ], {
      input: `${automaticBootstrap()}\n${priorMigrations}\n${controls}\n${migration}\n${assertions}`,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /CIT61_AUTOMATIC_LEGAL_GATE_ASSERTIONS_PASSED=31/);
  } finally {
    const drop = spawnSync("docker", [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${database}`,
    ], { encoding: "utf8" });
    assert.equal(drop.status, 0, drop.stderr);
  }
});
