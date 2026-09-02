-- Exact, pre-network quarantine for one automatic issuance candidate.
-- This RPC never claims work, prepares a document, reserves a folio, or calls
-- any network-capable function. It only moves one clean PENDING pair to
-- BLOCKED for explicit human review.

begin;

create or replace function public.dte_quarantine_automatic_issuance_exact(
  p_tenant_id uuid,
  p_outbox_id uuid,
  p_intent_id uuid,
  p_expected_dte_type integer,
  p_safe_reason text
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_row public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  expected_business_operation_id text;
begin
  if p_tenant_id is null
     or p_outbox_id is null
     or p_intent_id is null
     or p_expected_dte_type is null
     or p_expected_dte_type not in (33,39) then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_INPUT_INVALID';
  end if;

  if p_safe_reason is distinct from
     'POSSIBLE_DUPLICATE_DOCUMENT_REVIEW_REQUIRED' then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_REASON_INVALID';
  end if;

  expected_business_operation_id := 'intent:' || p_intent_id::text;

  -- Lock the exact PENDING outbox first, matching the normal automatic
  -- claim lock order and avoiding row-lock/advisory-lock inversion.
  select * into outbox_row
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id
     and outbox.tenant_id = p_tenant_id
     and outbox.intent_id = p_intent_id
   for update;
  if not found then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_NOT_ELIGIBLE';
  end if;

  -- Serialize the tenant only after the exact outbox row is locked.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(outbox_row.tenant_id::text, 0)
  );

  select * into intent_row
    from public.dte_payment_document_intents intent
   where intent.id = p_intent_id
     and intent.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_NOT_ELIGIBLE';
  end if;

  -- Revalidate every exact-target and clean pre-network invariant after both
  -- rows are locked. No counter is consumed by this administrative action.
  if outbox_row.tenant_id is distinct from p_tenant_id
     or outbox_row.intent_id is distinct from p_intent_id
     or outbox_row.status <> 'PENDING'
     or outbox_row.issuance_origin <> 'automatic_system'
     or outbox_row.network_attempts <> 0
     or outbox_row.deterministic_attempts >= 3
     or outbox_row.last_safe_error is not null
     or outbox_row.locked_at is not null
     or outbox_row.locked_by is not null
     or outbox_row.claim_token is not null
     or outbox_row.lease_expires_at is not null
     or intent_row.tenant_id is distinct from p_tenant_id
     or intent_row.status <> 'PENDING'
     or intent_row.origin <> 'automatic_payment'
     or intent_row.trigger_source not in (
       'khipu','webpay','mercadopago','manual_verified'
     )
     or intent_row.resolved_dte_type is distinct from p_expected_dte_type
     or intent_row.resolved_dte_type not in (33,39)
     or intent_row.production_document_id is not null
     or intent_row.network_attempt_count <> 0
     or intent_row.deterministic_retry_count >= 3
     or intent_row.safe_blocking_reason is not null then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_NOT_ELIGIBLE';
  end if;

  -- A concurrent active claim for this tenant makes the administrative
  -- transition unsafe even though this exact row is still PENDING.
  if exists (
    select 1
      from public.dte_issuance_outbox active
     where active.tenant_id = p_tenant_id
       and active.status = 'PROCESSING'
  ) then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_CONFLICT';
  end if;

  -- The automatic worker uses intent:<intent_uuid> as its production business
  -- operation identity. This exact key is the only safe relational bridge when
  -- production_document_id is still null; no customer/amount/date inference is
  -- permitted here.
  if exists (
    select 1
      from public.dte_production_documents document
     where document.tenant_id = p_tenant_id
       and document.business_operation_id = expected_business_operation_id
  ) or exists (
    select 1
      from public.dte_production_submission_attempts submission
      join public.dte_production_documents document
        on document.tenant_id = submission.tenant_id
       and document.id = submission.document_id
     where document.tenant_id = p_tenant_id
       and document.business_operation_id = expected_business_operation_id
  ) or exists (
    select 1
      from public.dte_production_folio_ledger ledger
     where ledger.tenant_id = p_tenant_id
       and ledger.business_operation_id = expected_business_operation_id
  ) then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_NOT_ELIGIBLE';
  end if;

  -- Persisted advancement or network-risk events are incompatible with a
  -- clean pre-network PENDING candidate. ISSUANCE_QUEUED remains allowed.
  if exists (
    select 1
      from public.dte_document_events event
     where event.tenant_id = p_tenant_id
       and event.intent_id = p_intent_id
       and (
         event.production_document_id is not null
         or event.event_type like '%NETWORK_BOUNDARY%'
         or event.event_type in (
           'ISSUANCE_PREPARING',
           'ISSUANCE_READY',
           'SUBMISSION_STARTED',
           'SUBMISSION_AMBIGUOUS',
           'AUTOMATIC_GATE_CLOSED_POST_NETWORK',
           'AUTOMATIC_OWNED_FOLIO_RESUME_CLAIMED'
         )
       )
  ) then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_NOT_ELIGIBLE';
  end if;

  update public.dte_payment_document_intents intent
     set status = 'BLOCKED',
         safe_blocking_reason = p_safe_reason,
         updated_at = pg_catalog.now()
   where intent.id = p_intent_id
     and intent.tenant_id = p_tenant_id
     and intent.status = 'PENDING'
     and intent.origin = 'automatic_payment'
     and intent.resolved_dte_type = p_expected_dte_type
     and intent.production_document_id is null
     and intent.network_attempt_count = 0
     and intent.deterministic_retry_count < 3
     and intent.safe_blocking_reason is null;
  if not found then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_CONFLICT';
  end if;

  update public.dte_issuance_outbox outbox
     set status = 'BLOCKED',
         last_safe_error = p_safe_reason,
         locked_at = null,
         locked_by = null,
         claim_token = null,
         lease_expires_at = null,
         updated_at = pg_catalog.now()
   where outbox.id = p_outbox_id
     and outbox.tenant_id = p_tenant_id
     and outbox.intent_id = p_intent_id
     and outbox.status = 'PENDING'
     and outbox.issuance_origin = 'automatic_system'
     and outbox.network_attempts = 0
     and outbox.deterministic_attempts < 3
     and outbox.last_safe_error is null
     and outbox.locked_at is null
     and outbox.locked_by is null
     and outbox.claim_token is null
     and outbox.lease_expires_at is null
  returning outbox.* into outbox_row;
  if not found then
    raise exception 'DTE_AUTOMATIC_QUARANTINE_CONFLICT';
  end if;

  insert into public.dte_document_events(
    tenant_id,
    intent_id,
    production_document_id,
    event_type,
    safe_metadata
  ) values (
    p_tenant_id,
    p_intent_id,
    null,
    'AUTOMATIC_ISSUANCE_QUARANTINED',
    pg_catalog.jsonb_build_object(
      'reason', p_safe_reason,
      'exactTarget', true,
      'automaticRetry', false,
      'networkBoundaryCrossed', false,
      'productionDocumentCreated', false,
      'dteType', p_expected_dte_type
    )
  );

  return next outbox_row;
  return;
end;
$$;

revoke all on function public.dte_quarantine_automatic_issuance_exact(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.dte_quarantine_automatic_issuance_exact(
  uuid, uuid, uuid, integer, text
) to service_role;

comment on function public.dte_quarantine_automatic_issuance_exact(
  uuid, uuid, uuid, integer, text
) is
  'Atomically quarantines one exact clean pre-network automatic PENDING intent/outbox for allowlisted human review; never claims, reserves a folio, or touches the network.';

commit;
