begin;

-- Explicit exact-target recovery for an automatic document that was blocked by
-- the pre-network gate after it had already reserved its own last folio.
create or replace function public.dte_claim_automatic_owned_folio_resume_exact(
  p_worker_id text,
  p_outbox_id uuid
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  claimed public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  document_row public.dte_production_documents%rowtype;
  ledger_row public.dte_production_folio_ledger%rowtype;
  possible_relation_count bigint;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$'
     or p_outbox_id is null then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_INPUT_INVALID';
  end if;

  -- Resolve only the requested row so the per-tenant transaction lock can be
  -- acquired. Every eligibility fact is re-read and locked afterwards.
  select outbox.tenant_id
    into target_tenant_id
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id;
  if not found then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_NOT_ELIGIBLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_tenant_id::text, 0)
  );

  select outbox.*
    into claimed
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id
     and outbox.tenant_id = target_tenant_id
   for update;
  if not found
     or claimed.status <> 'BLOCKED'
     or claimed.issuance_origin <> 'automatic_system'
     or claimed.last_safe_error <> 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     or claimed.network_attempts <> 0
     or claimed.deterministic_attempts >= 3
     or claimed.locked_at is not null
     or claimed.locked_by is not null
     or claimed.claim_token is not null
     or claimed.lease_expires_at is not null then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_NOT_ELIGIBLE';
  end if;

  select intent.*
    into intent_row
    from public.dte_payment_document_intents intent
   where intent.tenant_id = claimed.tenant_id
     and intent.id = claimed.intent_id
   for update;
  if not found
     or intent_row.status <> 'BLOCKED'
     or intent_row.origin <> 'automatic_payment'
     or intent_row.trigger_source not in (
       'khipu','webpay','mercadopago','manual_verified'
     )
     or intent_row.resolved_dte_type not in (33,39)
     or intent_row.production_document_id is null
     or intent_row.safe_blocking_reason <>
       'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     or intent_row.network_attempt_count <> 0
     or intent_row.deterministic_retry_count >= 3 then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_NOT_ELIGIBLE';
  end if;

  select document.*
    into document_row
    from public.dte_production_documents document
   where document.id = intent_row.production_document_id
   for update;
  if not found
     or document_row.tenant_id <> intent_row.tenant_id
     or document_row.dte_type <> intent_row.resolved_dte_type
     or document_row.status not in ('draft','prepared','ready')
     or nullif(pg_catalog.btrim(document_row.business_operation_id), '')
       is null then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_NOT_ELIGIBLE';
  end if;

  select ledger.*
    into ledger_row
    from public.dte_production_folio_ledger ledger
   where ledger.tenant_id = document_row.tenant_id
     and ledger.dte_type = document_row.dte_type
     and ledger.document_id = document_row.id
     and ledger.business_operation_id = document_row.business_operation_id
     and ledger.state = 'reserved'
   for update;
  if not found
     or nullif(pg_catalog.btrim(ledger_row.business_operation_id), '') is null
     or (
       document_row.status = 'draft'
       and (
         (document_row.folio is not null
           and document_row.folio <> ledger_row.folio)
         or (document_row.caf_id is not null
           and document_row.caf_id <> ledger_row.caf_id)
       )
     )
     or (
       document_row.status in ('prepared','ready')
       and (
         document_row.folio is distinct from ledger_row.folio
         or document_row.caf_id is distinct from ledger_row.caf_id
       )
     ) then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_NOT_ELIGIBLE';
  end if;

  select pg_catalog.count(*)
    into possible_relation_count
    from public.dte_production_folio_ledger possible_relation
   where possible_relation.document_id = document_row.id
      or (
        possible_relation.tenant_id = document_row.tenant_id
        and possible_relation.business_operation_id =
          document_row.business_operation_id
      );
  if possible_relation_count <> 1
     or exists (
       select 1
         from public.dte_production_submission_attempts submission
        where submission.tenant_id = intent_row.tenant_id
          and submission.document_id = document_row.id
     )
     or not public.dte_automatic_issuance_gate_open(
       intent_row.tenant_id,
       intent_row.id
     )
     or exists (
       select 1
         from public.dte_issuance_outbox active
        where active.tenant_id = intent_row.tenant_id
          and active.status = 'PROCESSING'
     ) then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_NOT_ELIGIBLE';
  end if;

  update public.dte_payment_document_intents intent
     set status = 'PENDING',
         safe_blocking_reason = null,
         updated_at = pg_catalog.now()
   where intent.tenant_id = intent_row.tenant_id
     and intent.id = intent_row.id
     and intent.status = 'BLOCKED'
     and intent.production_document_id = document_row.id
     and intent.safe_blocking_reason =
       'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     and intent.network_attempt_count = 0
     and intent.deterministic_retry_count < 3;
  if not found then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_CONFLICT';
  end if;

  update public.dte_issuance_outbox outbox
     set status = 'PROCESSING',
         locked_at = pg_catalog.now(),
         locked_by = p_worker_id,
         claim_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = pg_catalog.now() + interval '15 minutes',
         last_safe_error = null,
         updated_at = pg_catalog.now()
   where outbox.id = claimed.id
     and outbox.tenant_id = claimed.tenant_id
     and outbox.status = 'BLOCKED'
     and outbox.issuance_origin = 'automatic_system'
     and outbox.last_safe_error = 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
     and outbox.network_attempts = 0
     and outbox.deterministic_attempts < 3
   returning outbox.* into claimed;
  if not found then
    raise exception 'DTE_AUTOMATIC_OWNED_FOLIO_RESUME_CONFLICT';
  end if;

  insert into public.dte_document_events(
    tenant_id,
    intent_id,
    production_document_id,
    event_type,
    safe_metadata
  ) values (
    intent_row.tenant_id,
    intent_row.id,
    document_row.id,
    'AUTOMATIC_OWNED_FOLIO_RESUME_CLAIMED',
    pg_catalog.jsonb_build_object(
      'automaticRetry', false,
      'exactTarget', true,
      'ownedFolioResume', true,
      'folioReused', ledger_row.folio,
      'additionalFolioReserved', false,
      'networkBoundaryCrossed', false
    )
  );

  return next claimed;
end;
$$;

revoke all on function public.dte_claim_automatic_owned_folio_resume_exact(
  text,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.dte_claim_automatic_owned_folio_resume_exact(
  text,
  uuid
) to service_role;

comment on function public.dte_claim_automatic_owned_folio_resume_exact(
  text,
  uuid
) is
  'Explicit exact-target automatic 33/39 pre-network recovery. Requires and preserves one strictly owned reserved folio, performs no stale sweep, and never falls back to another outbox.';

commit;
