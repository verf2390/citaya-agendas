import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202608310001_cit42_reconcile_billing_accepted_dte.sql";

const migration = readFileSync(migrationPath, "utf8");

test("CIT-42 migration is local-only, exact and least-privilege", () => {
  assert.match(
    migration,
    /billing_reconcile_accepted_production_dte/,
  );

  assert.match(
    migration,
    /intent_row\.origin <> 'automatic_payment'/,
  );

  assert.match(
    migration,
    /intent_row\.resolved_dte_type not in \(33,39\)/,
  );

  assert.match(
    migration,
    /intent_row\.status not in \('ACCEPTED','ACCEPTED_WITH_OBJECTIONS'\)/,
  );

  assert.match(
    migration,
    /payment_schedule_allocation_id/,
  );

  assert.match(
    migration,
    /schedule_row\.payment_intent_id is distinct from intent_row\.payment_intent_id/,
  );

  assert.match(
    migration,
    /from public\.billing_payment_schedule\s+where[\s\S]*?for update/,
  );

  assert.match(
    migration,
    /production_document_id/,
  );

  assert.match(
    migration,
    /document_relation_status/,
  );

  assert.match(
    migration,
    /'VALIDATED'/,
  );

  assert.match(
    migration,
    /BILLING_COVERAGE_RECONCILIATION_BLOCKED/,
  );

  assert.match(
    migration,
    /revoke all on function public\.billing_reconcile_accepted_production_dte/,
  );

  assert.doesNotMatch(
    migration,
    /set reconciliation_status = 'NOT_REQUIRED'/,
  );

  assert.doesNotMatch(
    migration,
    /billing_schedule_allocation_insert_guard/,
  );

  assert.doesNotMatch(
    migration,
    /(?:customer_id|date_trunc|interval\s+'|created_at\s*(?:=|<|>))/i,
  );

  assert.doesNotMatch(
    migration,
    /(?:net\.http|http_get|http_post|dblink|pg_net|reserve_folio|dte_issuance_outbox|dte_production_submission_attempts|dte_production_cafs|dte_production_folio_ledger)/i,
  );
});

const bootstrap = String.raw`
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

do $$
begin
  if not exists(
    select 1 from pg_roles where rolname='anon'
  ) then
    create role anon nologin;
  end if;

  if not exists(
    select 1 from pg_roles where rolname='authenticated'
  ) then
    create role authenticated nologin;
  end if;

  if not exists(
    select 1 from pg_roles where rolname='service_role'
  ) then
    create role service_role nologin;
  end if;
end
$$;

create table public.appointments(
  id uuid primary key,
  tenant_id uuid not null,
  tax_treatment_status text not null default 'PENDING',
  updated_at timestamptz not null default now()
);

create table public.payment_intents(
  id uuid primary key,
  tenant_id uuid not null,
  appointment_id uuid not null,
  unique(tenant_id,id)
);

create table public.billing_sales(
  id uuid primary key,
  tenant_id uuid not null,
  requested_document_type integer not null,
  total_amount bigint not null,
  documented_amount bigint not null default 0,
  pending_documentation_amount bigint not null default 0,
  document_status text not null default 'UNCOVERED',
  tax_treatment_status text not null default 'PENDING',
  updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);

create table public.billing_sale_items(
  id uuid primary key,
  tenant_id uuid not null,
  sale_id uuid not null,
  total_amount bigint not null,
  tax_treatment_snapshot text not null default 'affected',
  unique(tenant_id,sale_id,id)
);

create table public.billing_payment_schedule(
  id uuid primary key,
  tenant_id uuid not null,
  sale_id uuid not null,
  payment_intent_id uuid,
  amount bigint not null,
  paid_amount bigint not null,
  status text not null,
  unique(tenant_id,id),
  foreign key(tenant_id,sale_id)
    references public.billing_sales(tenant_id,id)
);

create table public.billing_payment_schedule_allocations(
  id uuid primary key,
  tenant_id uuid not null,
  schedule_id uuid not null,
  sale_id uuid not null,
  sale_item_id uuid not null,
  position integer not null,
  amount_from bigint not null,
  amount_to bigint not null,
  allocated_amount bigint generated always as (
    amount_to-amount_from
  ) stored,
  amount_range int8range generated always as (
    int8range(amount_from,amount_to,'[)')
  ) stored,
  unique(tenant_id,id),
  foreign key(tenant_id,schedule_id)
    references public.billing_payment_schedule(tenant_id,id),
  foreign key(tenant_id,sale_id,sale_item_id)
    references public.billing_sale_items(tenant_id,sale_id,id)
);

create table public.billing_sale_payments(
  id uuid primary key,
  tenant_id uuid not null,
  sale_id uuid not null,
  appointment_id uuid,
  payment_intent_id uuid not null,
  schedule_id uuid,
  status text not null,
  validation_result text not null,
  reconciliation_status text not null,
  amount bigint not null,
  unique(tenant_id,id),
  unique(tenant_id,payment_intent_id),
  foreign key(tenant_id,sale_id)
    references public.billing_sales(tenant_id,id),
  foreign key(tenant_id,schedule_id)
    references public.billing_payment_schedule(tenant_id,id)
);

create table public.dte_production_documents(
  id uuid primary key,
  tenant_id uuid not null,
  dte_type integer not null,
  total_amount bigint not null,
  sii_status text,
  unique(tenant_id,id)
);

create table public.dte_payment_document_intents(
  id uuid primary key,
  tenant_id uuid not null,
  production_document_id uuid,
  origin text not null,
  resolved_dte_type integer,
  status text not null,
  payment_intent_id uuid,
  amount_snapshot bigint not null,
  safe_blocking_reason text,
  updated_at timestamptz not null default now()
);

create table public.billing_sale_appointments(
  tenant_id uuid not null,
  sale_id uuid not null,
  appointment_id uuid not null,
  primary key(tenant_id,sale_id,appointment_id)
);

create table public.billing_sale_item_document_coverage(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  sale_item_id uuid not null,
  dte_type integer not null,
  amount_from bigint not null,
  amount_to bigint not null,
  amount_range int8range generated always as (
    int8range(amount_from,amount_to,'[)')
  ) stored,
  status text not null default 'PLANNED',
  coverage_source text not null default 'DTE',
  sale_payment_id uuid,
  related_coverage_id uuid,
  document_relation_status text not null default 'UNCONFIGURED',
  draft_id uuid,
  production_document_id uuid,
  payment_schedule_allocation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_coverage_source_shape check (
    (
      coverage_source='DTE'
      and (
        draft_id is not null
        or production_document_id is not null
      )
    )
    or (
      coverage_source='ELECTRONIC_PAYMENT_VOUCHER'
      and dte_type=39
      and sale_payment_id is not null
      and draft_id is null
      and production_document_id is null
    )
  ),
  foreign key(tenant_id,sale_id,sale_item_id)
    references public.billing_sale_items(tenant_id,sale_id,id),
  foreign key(tenant_id,sale_payment_id)
    references public.billing_sale_payments(tenant_id,id),
  foreign key(tenant_id,payment_schedule_allocation_id)
    references public.billing_payment_schedule_allocations(tenant_id,id),
  foreign key(tenant_id,production_document_id)
    references public.dte_production_documents(tenant_id,id),
  exclude using gist(
    tenant_id with =,
    sale_item_id with =,
    amount_range with &&
  ) where(status <> 'VOID')
);

create unique index billing_coverage_one_per_schedule_allocation
  on public.billing_sale_item_document_coverage(
    tenant_id,
    payment_schedule_allocation_id
  )
  where payment_schedule_allocation_id is not null
    and status <> 'VOID';

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

create or replace function public.billing_private_reference_guard()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_table_name='billing_sale_payments' then
    if not exists(
      select 1
      from public.payment_intents payment_intent
      where payment_intent.id=new.payment_intent_id
        and payment_intent.tenant_id=new.tenant_id
        and payment_intent.appointment_id
          is not distinct from new.appointment_id
    ) then
      raise exception 'BILLING_PAYMENT_TENANT_MISMATCH';
    end if;
  elsif tg_table_name='billing_sale_item_document_coverage' then
    if not exists(
      select 1
      from public.billing_sale_items item
      where item.tenant_id=new.tenant_id
        and item.sale_id=new.sale_id
        and item.id=new.sale_item_id
        and new.amount_to<=item.total_amount
    ) then
      raise exception 'BILLING_COVERAGE_ITEM_TENANT_OR_AMOUNT_MISMATCH';
    end if;
    if new.dte_type in(33,39) and exists(
      select 1
      from public.billing_sale_items item
      where item.tenant_id=new.tenant_id
        and item.id=new.sale_item_id
        and item.tax_treatment_snapshot='exempt'
    ) then
      raise exception 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED';
    end if;
    if new.production_document_id is not null and not exists(
      select 1
      from public.dte_production_documents document
      where document.id=new.production_document_id
        and document.tenant_id=new.tenant_id
        and document.dte_type=new.dte_type
    ) then
      raise exception 'BILLING_COVERAGE_DOCUMENT_MISMATCH';
    end if;
    if new.sale_payment_id is not null and not exists(
      select 1
      from public.billing_sale_payments payment
      where payment.id=new.sale_payment_id
        and payment.tenant_id=new.tenant_id
        and payment.sale_id=new.sale_id
    ) then
      raise exception 'BILLING_COVERAGE_PAYMENT_MISMATCH';
    end if;
  end if;
  return new;
end
$$;

create trigger billing_sale_payments_reference_guard
before insert or update
on public.billing_sale_payments
for each row
execute function public.billing_private_reference_guard();

create trigger billing_document_coverage_reference_guard
before insert or update
on public.billing_sale_item_document_coverage
for each row
execute function public.billing_private_reference_guard();

create or replace function public.billing_refresh_documentation_totals()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_documented bigint;
begin
  select coalesce(sum(amount_to-amount_from),0)
    into v_documented
    from public.billing_sale_item_document_coverage
   where tenant_id=new.tenant_id
     and sale_id=new.sale_id
     and status='ACCEPTED';

  update public.billing_sales
     set documented_amount=v_documented,
         pending_documentation_amount=total_amount-v_documented,
         document_status=case
           when v_documented=0 then 'UNCOVERED'
           when v_documented=total_amount then 'COVERED'
           else 'PARTIALLY_COVERED'
         end,
         updated_at=now()
   where tenant_id=new.tenant_id
     and id=new.sale_id;

  return new;
end
$$;

create trigger billing_refresh_documentation_totals
after insert or update
on public.billing_sale_item_document_coverage
for each row
execute function public.billing_refresh_documentation_totals();
`;

const assertions = String.raw`
begin;

do $$
declare
  t constant uuid :=
    '10000000-0000-4000-8000-000000000001';

  actor constant uuid :=
    '10000000-0000-4000-8000-000000000002';

  sale33 constant uuid :=
    '20000000-0000-4000-8000-000000000033';
  item33 constant uuid :=
    '30000000-0000-4000-8000-000000000033';
  schedule33 constant uuid :=
    '40000000-0000-4000-8000-000000000033';
  allocation33 constant uuid :=
    '50000000-0000-4000-8000-000000000033';
  payment_intent33 constant uuid :=
    '60000000-0000-4000-8000-000000000033';
  sale_payment33 constant uuid :=
    '70000000-0000-4000-8000-000000000033';
  document33 constant uuid :=
    '80000000-0000-4000-8000-000000000033';
  intent33 constant uuid :=
    '90000000-0000-4000-8000-000000000033';
  appointment33 constant uuid :=
    'a0000000-0000-4000-8000-000000000033';

  sale39 constant uuid :=
    '20000000-0000-4000-8000-000000000039';
  item39 constant uuid :=
    '30000000-0000-4000-8000-000000000039';
  schedule39 constant uuid :=
    '40000000-0000-4000-8000-000000000039';
  allocation39 constant uuid :=
    '50000000-0000-4000-8000-000000000039';
  payment_intent39 constant uuid :=
    '60000000-0000-4000-8000-000000000039';
  sale_payment39 constant uuid :=
    '70000000-0000-4000-8000-000000000039';
  document39 constant uuid :=
    '80000000-0000-4000-8000-000000000039';
  intent39 constant uuid :=
    '90000000-0000-4000-8000-000000000039';
  appointment39 constant uuid :=
    'a0000000-0000-4000-8000-000000000039';

  conflict_sale constant uuid :=
    '21000000-0000-4000-8000-000000000001';
  conflict_item constant uuid :=
    '31000000-0000-4000-8000-000000000001';
  conflict_schedule constant uuid :=
    '41000000-0000-4000-8000-000000000001';
  conflict_allocation constant uuid :=
    '51000000-0000-4000-8000-000000000001';
  conflict_payment_intent constant uuid :=
    '61000000-0000-4000-8000-000000000001';
  conflict_sale_payment constant uuid :=
    '71000000-0000-4000-8000-000000000001';
  conflict_document constant uuid :=
    '81000000-0000-4000-8000-000000000001';
  wrong_document constant uuid :=
    '81000000-0000-4000-8000-000000000099';
  conflict_intent constant uuid :=
    '91000000-0000-4000-8000-000000000001';

  atomic_sale constant uuid :=
    '22000000-0000-4000-8000-000000000042';
  atomic_item_one constant uuid :=
    '32000000-0000-4000-8000-000000000041';
  atomic_item_two constant uuid :=
    '32000000-0000-4000-8000-000000000042';
  atomic_schedule constant uuid :=
    '42000000-0000-4000-8000-000000000042';
  atomic_allocation_one constant uuid :=
    '52000000-0000-4000-8000-000000000041';
  atomic_allocation_two constant uuid :=
    '52000000-0000-4000-8000-000000000042';
  atomic_payment_intent constant uuid :=
    '62000000-0000-4000-8000-000000000042';
  atomic_sale_payment constant uuid :=
    '72000000-0000-4000-8000-000000000042';
  atomic_document constant uuid :=
    '82000000-0000-4000-8000-000000000042';
  atomic_prior_document constant uuid :=
    '82000000-0000-4000-8000-000000000043';
  atomic_intent constant uuid :=
    '92000000-0000-4000-8000-000000000042';

  bad_schedule_sale constant uuid :=
    '23000000-0000-4000-8000-000000000042';
  bad_schedule_item constant uuid :=
    '33000000-0000-4000-8000-000000000042';
  bad_schedule constant uuid :=
    '43000000-0000-4000-8000-000000000042';
  bad_schedule_allocation constant uuid :=
    '53000000-0000-4000-8000-000000000042';
  bad_schedule_payment_intent constant uuid :=
    '63000000-0000-4000-8000-000000000042';
  bad_schedule_sale_payment constant uuid :=
    '73000000-0000-4000-8000-000000000042';
  bad_schedule_document constant uuid :=
    '83000000-0000-4000-8000-000000000042';
  bad_schedule_intent constant uuid :=
    '93000000-0000-4000-8000-000000000042';

  manual_document constant uuid :=
    '84000000-0000-4000-8000-000000000042';
  manual_intent constant uuid :=
    '94000000-0000-4000-8000-000000000042';

  submitted_document constant uuid :=
    '82000000-0000-4000-8000-000000000001';
  submitted_intent constant uuid :=
    '92000000-0000-4000-8000-000000000001';

  rejected_document constant uuid :=
    '83000000-0000-4000-8000-000000000001';
  rejected_intent constant uuid :=
    '93000000-0000-4000-8000-000000000001';

  n integer;
  v text;
  documented bigint;
  pending bigint;
begin
  if pg_catalog.has_function_privilege(
       'anon',
       'public.billing_reconcile_accepted_production_dte(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.billing_reconcile_accepted_production_dte(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.billing_reconcile_accepted_production_dte(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'CIT42_INTERNAL_HELPER_PERMISSION_LEAK';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.dte_reconcile_intent_status(uuid,uuid,text,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.dte_reconcile_intent_status(uuid,uuid,text,text,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.dte_reconcile_intent_status(uuid,uuid,text,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'CIT42_RPC_PERMISSIONS_INVALID';
  end if;

  if exists(
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname in(
        'billing_reconcile_accepted_production_dte',
        'dte_reconcile_intent_status'
      )
      and not procedure.prosecdef
  ) or (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname in(
        'billing_reconcile_accepted_production_dte',
        'dte_reconcile_intent_status'
      )
      and procedure.proconfig @> array['search_path=""']::text[]
  ) <> 2 then
    raise exception 'CIT42_SECURITY_DEFINER_CONFIGURATION_INVALID';
  end if;

  ----------------------------------------------------------
  -- FACTURA 33
  ----------------------------------------------------------

  insert into public.appointments
    (id,tenant_id,tax_treatment_status)
  values
    (appointment33,t,'PENDING');

  insert into public.billing_sales(
    id,tenant_id,requested_document_type,total_amount,
    documented_amount,pending_documentation_amount,
    document_status,tax_treatment_status
  ) values(
    sale33,t,33,5000,0,5000,'UNCOVERED','PENDING'
  );

  insert into public.billing_sale_items
    (id,tenant_id,sale_id,total_amount)
  values
    (item33,t,sale33,5000);

  insert into public.billing_sale_appointments
    (tenant_id,sale_id,appointment_id)
  values
    (t,sale33,appointment33);

  insert into public.billing_payment_schedule
    (id,tenant_id,sale_id,payment_intent_id,amount,paid_amount,status)
  values
    (schedule33,t,sale33,null,5000,0,'PENDING');

  insert into public.billing_payment_schedule_allocations(
    id,tenant_id,schedule_id,sale_id,sale_item_id,
    position,amount_from,amount_to
  ) values(
    allocation33,t,schedule33,sale33,item33,1,0,5000
  );

  update public.billing_payment_schedule
  set payment_intent_id=payment_intent33,
      paid_amount=amount,
      status='PAID'
  where id=schedule33;

  insert into public.payment_intents
    (id,tenant_id,appointment_id)
  values
    (payment_intent33,t,appointment33);

  insert into public.billing_sale_payments(
    id,tenant_id,sale_id,appointment_id,
    payment_intent_id,schedule_id,
    status,validation_result,reconciliation_status,amount
  ) values(
    sale_payment33,t,sale33,appointment33,
    payment_intent33,schedule33,
    'VERIFIED','provider_verified','NOT_REQUIRED',5000
  );

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values
    (document33,t,33,5000,'accepted');

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    intent33,t,document33,'automatic_payment',
    33,'SUBMITTED',payment_intent33,5000
  );

  perform public.dte_reconcile_intent_status(
    t,document33,'ACCEPTED','accepted',actor
  );

  select
    document_status,
    documented_amount,
    pending_documentation_amount
  into v,documented,pending
  from public.billing_sales
  where id=sale33;

  if v <> 'COVERED'
     or documented <> 5000
     or pending <> 0 then
    raise exception 'CIT42_FACTURA33_NOT_COVERED';
  end if;

  if not exists(
    select 1
    from public.billing_sales
    where id=sale33
      and tax_treatment_status='READY'
  ) or not exists(
    select 1
    from public.billing_sale_payments
    where id=sale_payment33
      and reconciliation_status='NOT_REQUIRED'
  ) or not exists(
    select 1
    from public.appointments
    where id=appointment33
      and tax_treatment_status='READY'
  ) then
    raise exception 'CIT42_FACTURA33_TAX_STATUS_NOT_READY';
  end if;

  perform public.dte_reconcile_intent_status(
    t,document33,'ACCEPTED','accepted',actor
  );

  select count(*)
  into n
  from public.billing_sale_item_document_coverage
  where tenant_id=t
    and sale_id=sale33
    and production_document_id=document33
    and status='ACCEPTED';

  if n <> 1 then
    raise exception 'CIT42_FACTURA33_IDEMPOTENCY_FAILED';
  end if;

  select count(*)
  into n
  from public.dte_document_events
  where tenant_id=t
    and intent_id=intent33
    and production_document_id=document33
    and event_type='BILLING_COVERAGE_RECONCILED';

  if n <> 1 then
    raise exception 'CIT42_FACTURA33_EVENT_IDEMPOTENCY_FAILED';
  end if;

  ----------------------------------------------------------
  -- BOLETA 39
  ----------------------------------------------------------

  insert into public.appointments
    (id,tenant_id,tax_treatment_status)
  values
    (appointment39,t,'PENDING');

  insert into public.billing_sales(
    id,tenant_id,requested_document_type,total_amount,
    documented_amount,pending_documentation_amount,
    document_status,tax_treatment_status
  ) values(
    sale39,t,39,5000,0,5000,'UNCOVERED','PENDING'
  );

  insert into public.billing_sale_items
    (id,tenant_id,sale_id,total_amount)
  values
    (item39,t,sale39,5000);

  insert into public.billing_sale_appointments
    (tenant_id,sale_id,appointment_id)
  values
    (t,sale39,appointment39);

  insert into public.billing_payment_schedule
    (id,tenant_id,sale_id,payment_intent_id,amount,paid_amount,status)
  values
    (schedule39,t,sale39,null,5000,0,'PENDING');

  insert into public.billing_payment_schedule_allocations(
    id,tenant_id,schedule_id,sale_id,sale_item_id,
    position,amount_from,amount_to
  ) values(
    allocation39,t,schedule39,sale39,item39,1,0,5000
  );

  update public.billing_payment_schedule
  set payment_intent_id=payment_intent39,
      paid_amount=amount,
      status='PAID'
  where id=schedule39;

  insert into public.payment_intents
    (id,tenant_id,appointment_id)
  values
    (payment_intent39,t,appointment39);

  insert into public.billing_sale_payments(
    id,tenant_id,sale_id,appointment_id,
    payment_intent_id,schedule_id,
    status,validation_result,reconciliation_status,amount
  ) values(
    sale_payment39,t,sale39,appointment39,
    payment_intent39,schedule39,
    'VERIFIED','provider_verified','REVIEW_REQUIRED',5000
  );

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values
    (document39,t,39,5000,'accepted_with_observations');

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    intent39,t,document39,'automatic_payment',
    39,'SUBMITTED',payment_intent39,5000
  );

  perform public.dte_reconcile_intent_status(
    t,document39,'ACCEPTED_WITH_OBJECTIONS',
    'accepted_with_observations',actor
  );

  select
    document_status,
    documented_amount,
    pending_documentation_amount
  into v,documented,pending
  from public.billing_sales
  where id=sale39;

  if v <> 'COVERED'
     or documented <> 5000
     or pending <> 0 then
    raise exception 'CIT42_BOLETA39_NOT_COVERED';
  end if;

  if not exists(
    select 1
    from public.dte_payment_document_intents
    where id=intent39
      and status='ACCEPTED_WITH_OBJECTIONS'
  ) or not exists(
    select 1
    from public.billing_sale_payments
    where id=sale_payment39
      and reconciliation_status='REVIEW_REQUIRED'
  ) or not exists(
    select 1
    from public.billing_sales
    where id=sale39
      and tax_treatment_status='READY'
  ) or not exists(
    select 1
    from public.appointments
    where id=appointment39
      and tax_treatment_status='READY'
  ) then
    raise exception 'CIT42_BOLETA39_REVIEW_PROVENANCE_NOT_PRESERVED';
  end if;

  perform public.dte_reconcile_intent_status(
    t,document39,'ACCEPTED_WITH_OBJECTIONS',
    'accepted_with_observations',actor
  );

  select count(*)
  into n
  from public.billing_sale_item_document_coverage
  where tenant_id=t
    and sale_id=sale39
    and production_document_id=document39
    and status='ACCEPTED';

  if n <> 1 then
    raise exception 'CIT42_BOLETA39_IDEMPOTENCY_FAILED';
  end if;

  select count(*)
  into n
  from public.dte_document_events
  where tenant_id=t
    and intent_id=intent39
    and production_document_id=document39
    and event_type='BILLING_COVERAGE_RECONCILED';

  if n <> 1 then
    raise exception 'CIT42_BOLETA39_EVENT_IDEMPOTENCY_FAILED';
  end if;

  ----------------------------------------------------------
  -- CONFLICT FAIL-CLOSED
  ----------------------------------------------------------

  insert into public.billing_sales(
    id,tenant_id,requested_document_type,total_amount,
    documented_amount,pending_documentation_amount,
    document_status,tax_treatment_status
  ) values(
    conflict_sale,t,33,5000,0,5000,'UNCOVERED','PENDING'
  );

  insert into public.billing_sale_items
    (id,tenant_id,sale_id,total_amount)
  values
    (conflict_item,t,conflict_sale,5000);

  insert into public.billing_payment_schedule
    (id,tenant_id,sale_id,payment_intent_id,amount,paid_amount,status)
  values
    (
      conflict_schedule,t,conflict_sale,
      null,5000,0,'PENDING'
    );

  insert into public.billing_payment_schedule_allocations(
    id,tenant_id,schedule_id,sale_id,sale_item_id,
    position,amount_from,amount_to
  ) values(
    conflict_allocation,t,conflict_schedule,
    conflict_sale,conflict_item,1,0,5000
  );

  update public.billing_payment_schedule
  set payment_intent_id=conflict_payment_intent,
      paid_amount=amount,
      status='PAID'
  where id=conflict_schedule;

  insert into public.payment_intents
    (id,tenant_id,appointment_id)
  values
    (conflict_payment_intent,t,appointment33);

  insert into public.billing_sale_payments(
    id,tenant_id,sale_id,appointment_id,
    payment_intent_id,schedule_id,
    status,validation_result,reconciliation_status,amount
  ) values(
    conflict_sale_payment,t,conflict_sale,appointment33,
    conflict_payment_intent,conflict_schedule,
    'VERIFIED','provider_verified','NOT_REQUIRED',5000
  );

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values
    (conflict_document,t,33,5000,'accepted'),
    (wrong_document,t,33,5000,'accepted');

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    conflict_intent,t,conflict_document,'automatic_payment',
    33,'SUBMITTED',conflict_payment_intent,5000
  );

  insert into public.billing_sale_item_document_coverage(
    tenant_id,sale_id,sale_item_id,dte_type,
    amount_from,amount_to,status,coverage_source,
    sale_payment_id,payment_schedule_allocation_id,
    production_document_id,document_relation_status
  ) values(
    t,conflict_sale,conflict_item,33,
    0,5000,'ACCEPTED','DTE',
    conflict_sale_payment,conflict_allocation,
    wrong_document,'VALIDATED'
  );

  perform public.dte_reconcile_intent_status(
    t,conflict_document,'ACCEPTED','accepted',actor
  );

  select status
  into v
  from public.dte_payment_document_intents
  where id=conflict_intent;

  if v <> 'ACCEPTED' then
    raise exception 'CIT42_CONFLICT_LOST_SII_ACCEPTANCE';
  end if;

  select reconciliation_status
  into v
  from public.billing_sale_payments
  where id=conflict_sale_payment;

  if v <> 'REVIEW_REQUIRED' then
    raise exception 'CIT42_CONFLICT_NOT_ESCALATED';
  end if;

  perform public.dte_reconcile_intent_status(
    t,conflict_document,'ACCEPTED','accepted',actor
  );

  select count(*)
  into n
  from public.dte_document_events
  where tenant_id=t
    and intent_id=conflict_intent
    and production_document_id=conflict_document
    and event_type='BILLING_COVERAGE_RECONCILIATION_BLOCKED';

  if n <> 1 then
    raise exception 'CIT42_BLOCK_EVENT_NOT_IDEMPOTENT';
  end if;

  select count(*)
  into n
  from public.billing_sale_item_document_coverage
  where tenant_id=t
    and payment_schedule_allocation_id=conflict_allocation
    and status<>'VOID';

  if n <> 1 then
    raise exception 'CIT42_CONFLICT_DUPLICATED_COVERAGE';
  end if;

  ----------------------------------------------------------
  -- INTERMEDIATE ALLOCATION FAILURE IS ATOMIC
  ----------------------------------------------------------

  insert into public.billing_sales(
    id,tenant_id,requested_document_type,total_amount,
    documented_amount,pending_documentation_amount,
    document_status,tax_treatment_status
  ) values(
    atomic_sale,t,33,5000,0,5000,'UNCOVERED','PENDING'
  );

  insert into public.billing_sale_items
    (id,tenant_id,sale_id,total_amount)
  values
    (atomic_item_one,t,atomic_sale,2500),
    (atomic_item_two,t,atomic_sale,2500);

  insert into public.billing_payment_schedule(
    id,tenant_id,sale_id,payment_intent_id,
    amount,paid_amount,status
  ) values(
    atomic_schedule,t,atomic_sale,null,
    5000,0,'PENDING'
  );

  insert into public.billing_payment_schedule_allocations(
    id,tenant_id,schedule_id,sale_id,sale_item_id,
    position,amount_from,amount_to
  ) values
    (
      atomic_allocation_one,t,atomic_schedule,
      atomic_sale,atomic_item_one,1,0,2500
    ),
    (
      atomic_allocation_two,t,atomic_schedule,
      atomic_sale,atomic_item_two,2,0,2500
    );

  update public.billing_payment_schedule
  set payment_intent_id=atomic_payment_intent,
      paid_amount=amount,
      status='PAID'
  where id=atomic_schedule;

  insert into public.payment_intents
    (id,tenant_id,appointment_id)
  values
    (atomic_payment_intent,t,appointment33);

  insert into public.billing_sale_payments(
    id,tenant_id,sale_id,appointment_id,
    payment_intent_id,schedule_id,
    status,validation_result,reconciliation_status,amount
  ) values(
    atomic_sale_payment,t,atomic_sale,appointment33,
    atomic_payment_intent,atomic_schedule,
    'VERIFIED','provider_verified','NOT_REQUIRED',5000
  );

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values
    (atomic_document,t,33,5000,'accepted'),
    (atomic_prior_document,t,33,2500,'accepted');

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    atomic_intent,t,atomic_document,'automatic_payment',
    33,'SUBMITTED',atomic_payment_intent,5000
  );

  insert into public.billing_sale_item_document_coverage(
    tenant_id,sale_id,sale_item_id,dte_type,
    amount_from,amount_to,status,coverage_source,
    sale_payment_id,production_document_id,
    document_relation_status
  ) values(
    t,atomic_sale,atomic_item_two,33,
    0,2500,'ACCEPTED','DTE',
    atomic_sale_payment,atomic_prior_document,'VALIDATED'
  );

  perform public.dte_reconcile_intent_status(
    t,atomic_document,'ACCEPTED','accepted',actor
  );

  if exists(
    select 1
    from public.billing_sale_item_document_coverage
    where tenant_id=t
      and production_document_id=atomic_document
  ) or exists(
    select 1
    from public.billing_sale_item_document_coverage
    where tenant_id=t
      and payment_schedule_allocation_id=atomic_allocation_one
      and status<>'VOID'
  ) then
    raise exception 'CIT42_INTERMEDIATE_FAILURE_LEFT_PARTIAL_COVERAGE';
  end if;

  if not exists(
    select 1
    from public.billing_sales
    where id=atomic_sale
      and document_status='PARTIALLY_COVERED'
      and documented_amount=2500
      and pending_documentation_amount=2500
      and tax_treatment_status='PENDING'
  ) or not exists(
    select 1
    from public.billing_sale_payments
    where id=atomic_sale_payment
      and reconciliation_status='REVIEW_REQUIRED'
  ) or not exists(
    select 1
    from public.dte_payment_document_intents
    where id=atomic_intent
      and status='ACCEPTED'
  ) then
    raise exception 'CIT42_INTERMEDIATE_FAILURE_STATE_INVALID';
  end if;

  ----------------------------------------------------------
  -- SCHEDULE MUST BELONG TO THE EXACT PAYMENT INTENT
  ----------------------------------------------------------

  insert into public.billing_sales(
    id,tenant_id,requested_document_type,total_amount,
    documented_amount,pending_documentation_amount,
    document_status,tax_treatment_status
  ) values(
    bad_schedule_sale,t,39,5000,0,5000,'UNCOVERED','PENDING'
  );

  insert into public.billing_sale_items
    (id,tenant_id,sale_id,total_amount)
  values
    (bad_schedule_item,t,bad_schedule_sale,5000);

  insert into public.billing_payment_schedule(
    id,tenant_id,sale_id,payment_intent_id,
    amount,paid_amount,status
  ) values(
    bad_schedule,t,bad_schedule_sale,
    null,5000,0,'PENDING'
  );

  insert into public.billing_payment_schedule_allocations(
    id,tenant_id,schedule_id,sale_id,sale_item_id,
    position,amount_from,amount_to
  ) values(
    bad_schedule_allocation,t,bad_schedule,
    bad_schedule_sale,bad_schedule_item,1,0,5000
  );

  update public.billing_payment_schedule
  set payment_intent_id=
        '63000000-0000-4000-8000-000000000099',
      paid_amount=amount,
      status='PAID'
  where id=bad_schedule;

  insert into public.payment_intents
    (id,tenant_id,appointment_id)
  values
    (bad_schedule_payment_intent,t,appointment33);

  insert into public.billing_sale_payments(
    id,tenant_id,sale_id,appointment_id,
    payment_intent_id,schedule_id,
    status,validation_result,reconciliation_status,amount
  ) values(
    bad_schedule_sale_payment,t,bad_schedule_sale,appointment33,
    bad_schedule_payment_intent,bad_schedule,
    'VERIFIED','provider_verified','NOT_REQUIRED',5000
  );

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values(
    bad_schedule_document,t,39,5000,'dok'
  );

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    bad_schedule_intent,t,bad_schedule_document,
    'automatic_payment',39,'SUBMITTED',
    bad_schedule_payment_intent,5000
  );

  -- Simulate historical corruption that also makes the real billing payment
  -- reference trigger reject the REVIEW_REQUIRED escalation update.
  update public.payment_intents
  set appointment_id=appointment39
  where id=bad_schedule_payment_intent;

  perform public.dte_reconcile_intent_status(
    t,bad_schedule_document,'ACCEPTED','dok',actor
  );

  if exists(
    select 1
    from public.billing_sale_item_document_coverage
    where tenant_id=t
      and production_document_id=bad_schedule_document
  ) or not exists(
    select 1
    from public.billing_sale_payments
    where id=bad_schedule_sale_payment
      and reconciliation_status='NOT_REQUIRED'
  ) or not exists(
    select 1
    from public.dte_payment_document_intents
    where id=bad_schedule_intent
      and status='ACCEPTED'
  ) or not exists(
    select 1
    from public.dte_document_events
    where tenant_id=t
      and intent_id=bad_schedule_intent
      and event_type='BILLING_COVERAGE_RECONCILIATION_BLOCKED'
      and safe_metadata->>'reviewRequiredMarked'='false'
      and safe_metadata->>'reviewMarkError'
        like '%BILLING_PAYMENT_TENANT_MISMATCH%'
  ) then
    raise exception 'CIT42_SCHEDULE_MISMATCH_NOT_FAIL_CLOSED';
  end if;

  ----------------------------------------------------------
  -- MANUAL ACCEPTANCE KEEPS THE PRE-CIT-42 PATH
  ----------------------------------------------------------

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values(
    manual_document,t,33,5000,'accepted'
  );

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    manual_intent,t,manual_document,'manual_payment',
    33,'SUBMITTED',
    '64000000-0000-4000-8000-000000000042',5000
  );

  perform public.dte_reconcile_intent_status(
    t,manual_document,'ACCEPTED','accepted',actor
  );

  if not exists(
    select 1
    from public.dte_payment_document_intents
    where id=manual_intent
      and status='ACCEPTED'
  ) or exists(
    select 1
    from public.dte_document_events
    where tenant_id=t
      and intent_id=manual_intent
      and event_type in(
        'BILLING_COVERAGE_RECONCILED',
        'BILLING_COVERAGE_RECONCILIATION_BLOCKED'
      )
  ) then
    raise exception 'CIT42_MANUAL_ACCEPTANCE_REGRESSION';
  end if;

  ----------------------------------------------------------
  -- SUBMITTED: NO COVERAGE
  ----------------------------------------------------------

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values(
    submitted_document,t,33,5000,'processing'
  );

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    submitted_intent,t,submitted_document,'automatic_payment',
    33,'SUBMITTING',
    '66000000-0000-4000-8000-000000000001',
    5000
  );

  perform public.dte_reconcile_intent_status(
    t,submitted_document,'SUBMITTED','processing',actor
  );

  if exists(
    select 1
    from public.billing_sale_item_document_coverage
    where production_document_id=submitted_document
  ) then
    raise exception 'CIT42_SUBMITTED_CREATED_COVERAGE';
  end if;

  ----------------------------------------------------------
  -- REJECTED: NO COVERAGE
  ----------------------------------------------------------

  insert into public.dte_production_documents
    (id,tenant_id,dte_type,total_amount,sii_status)
  values(
    rejected_document,t,39,5000,'rejected'
  );

  insert into public.dte_payment_document_intents(
    id,tenant_id,production_document_id,origin,
    resolved_dte_type,status,payment_intent_id,amount_snapshot
  ) values(
    rejected_intent,t,rejected_document,'automatic_payment',
    39,'SUBMITTED',
    '67000000-0000-4000-8000-000000000001',
    5000
  );

  perform public.dte_reconcile_intent_status(
    t,rejected_document,'REJECTED','rejected',actor
  );

  if exists(
    select 1
    from public.billing_sale_item_document_coverage
    where production_document_id=rejected_document
  ) then
    raise exception 'CIT42_REJECTED_CREATED_COVERAGE';
  end if;

  raise notice 'CIT42_FACTURA33_COVERED=OK';
  raise notice 'CIT42_BOLETA39_COVERED=OK';
  raise notice 'CIT42_IDEMPOTENCY=OK';
  raise notice 'CIT42_CONFLICT_FAIL_CLOSED=OK';
  raise notice 'CIT42_INTERMEDIATE_FAILURE_ATOMIC=OK';
  raise notice 'CIT42_EXACT_SCHEDULE_CHAIN=OK';
  raise notice 'CIT42_MANUAL_PATH_UNCHANGED=OK';
  raise notice 'CIT42_PERMISSIONS=OK';
  raise notice 'CIT42_NON_ACCEPTED_NO_COVERAGE=OK';
end
$$;

select 'CIT42_SQL_ASSERTIONS_PASSED=9';

rollback;
`;

test("CIT-42 reconciles accepted 33/39 billing coverage idempotently", () => {
  const database =
    `cit42_${randomUUID().replaceAll("-", "")}`;

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
        input:
          `${bootstrap}\n${migration}\n${assertions}`,
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
      /CIT42_SQL_ASSERTIONS_PASSED=9/,
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
});
