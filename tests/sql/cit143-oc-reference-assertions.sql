\set ON_ERROR_STOP on
-- CIT-143: disposable PostgreSQL 17 fixture. Never point this at CITAYA production.
begin;
create role service_role nologin;
create role anon nologin;
create role authenticated nologin;
create table public.dte_invoice_drafts (
  id uuid primary key,
  tenant_id uuid not null,
  dte_type integer not null default 33
);

-- Apply the *actual pending migration*, including RPC definition and grants.
\ir ../../migrations/202610300001_cit143_invoice_oc_references.sql

do $qa$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  draft_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  draft_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  count_rows integer;
  actual_references jsonb;
  invalid jsonb;
begin
  insert into public.dte_invoice_drafts(id, tenant_id, dte_type)
  values (draft_a, a, 33), (draft_b, b, 33);
  select document_references into actual_references from public.dte_invoice_drafts where id=draft_a;
  if actual_references <> '[]'::jsonb then
    raise exception 'CIT143_DEFAULT_NOT_EMPTY';
  end if;

  -- A tenant-scoped update cannot touch the other tenant's draft.
  update public.dte_invoice_drafts
  set document_references='[{"documentType":"801","folio":"OC-WRONG-TENANT","date":"2026-10-20","reason":"Orden de compra","code":""}]'::jsonb
  where tenant_id=a and id=draft_b;
  get diagnostics count_rows = row_count;
  if count_rows <> 0 then
    raise exception 'CIT143_CROSS_TENANT_WRITE';
  end if;

  update public.dte_invoice_drafts
  set document_references='[{"documentType":"801","folio":"OC-QA-123","date":"2026-10-20","reason":"Orden de compra","code":""}]'::jsonb
  where tenant_id=a and id=draft_a;
  get diagnostics count_rows = row_count;
  if count_rows <> 1 then
    raise exception 'CIT143_VALID_REFERENCE_NOT_STORED';
  end if;

  select document_references into actual_references from public.dte_invoice_drafts
  where tenant_id=a and id=draft_a;
  if actual_references->0->>'folio' <> 'OC-QA-123' or
     actual_references->0->>'documentType' <> '801' then
    raise exception 'CIT143_REFERENCE_NOT_RECOVERED';
  end if;

  for invalid in
    select value from jsonb_array_elements('[
      [{"documentType":"33","folio":"OC-QA-123","date":"2026-10-20","reason":"Orden de compra","code":""}],
      [{"documentType":"801","folio":"","date":"2026-10-20","reason":"Orden de compra","code":""}],
      [{"documentType":"801","folio":"OC-QA-123","date":"2026-10-20","reason":"Orden de compra","code":"3"}],
      [{"documentType":"801","folio":"OC-QA-123","date":"2026-10-20","reason":"Orden de compra","code":""},{"documentType":"801","folio":"OC-QA-124","date":"2026-10-20","reason":"Orden de compra","code":""}]
    ]'::jsonb)
  loop
    begin
      update public.dte_invoice_drafts set document_references=invalid
      where tenant_id=a and id=draft_a;
      raise exception 'CIT143_INVALID_REFERENCE_ACCEPTED';
    exception when check_violation then
      null;
    end;
  end loop;

  -- A boleta cannot acquire a structured invoice OC.
  update public.dte_invoice_drafts set dte_type=39 where tenant_id=b and id=draft_b;
  begin
    update public.dte_invoice_drafts
    set document_references='[{"documentType":"801","folio":"OC-QA-123","date":"2026-10-20","reason":"Orden de compra","code":""}]'::jsonb
    where tenant_id=b and id=draft_b;
    raise exception 'CIT143_BOLETA_ACCEPTED_OC';
  exception when check_violation then
    null;
  end;
  if (select document_references from public.dte_invoice_drafts where id=draft_b) <> '[]'::jsonb then
    raise exception 'CIT143_FOREIGN_DRAFT_CHANGED';
  end if;
end $qa$;

-- References are frozen at RPC creation time, not dynamically looked up in worker.
do $snapshot$
begin
  if position(
    'draft_row.document_references'
    in pg_get_functiondef('public.finalize_dte_invoice_draft(uuid,uuid,integer,text,text)'::regprocedure)
  ) = 0 then
    raise exception 'CIT143_RPC_SNAPSHOT_MISSING';
  end if;
end $snapshot$;

rollback;
