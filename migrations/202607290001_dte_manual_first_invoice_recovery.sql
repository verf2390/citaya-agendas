begin;

-- Qualify every ledger column because RETURNS TABLE exposes PL/pgSQL variables
-- named folio/caf_id. The previous unqualified UPDATE failed with SQLSTATE
-- 42702 before its transaction could reserve a folio.
create or replace function public.reserve_dte_production_folio(
  p_tenant_id uuid,
  p_dte_type integer,
  p_document_id uuid,
  p_business_operation_id text
) returns table(folio integer, caf_id uuid, reused boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.dte_production_folio_ledger%rowtype;
  selected public.dte_production_folio_ledger%rowtype;
begin
  if p_dte_type not in (33,56,61) or
     nullif(trim(p_business_operation_id), '') is null then
    raise exception 'DTE_FOLIO_INPUT_INVALID';
  end if;

  select ledger.* into existing
    from public.dte_production_folio_ledger as ledger
   where ledger.tenant_id = p_tenant_id
     and ledger.business_operation_id = p_business_operation_id
   for update;
  if found then
    if existing.document_id <> p_document_id or
       existing.dte_type <> p_dte_type or
       existing.state not in ('reserved','issued') then
      raise exception 'DTE_FOLIO_IDEMPOTENCY_CONFLICT';
    end if;
    return query select existing.folio, existing.caf_id, true;
    return;
  end if;

  select ledger.* into selected
    from public.dte_production_folio_ledger as ledger
   where ledger.tenant_id = p_tenant_id
     and ledger.dte_type = p_dte_type
     and ledger.state = 'available'
   order by ledger.folio
   for update skip locked
   limit 1;
  if not found then raise exception 'DTE_FOLIO_EXHAUSTED'; end if;

  update public.dte_production_folio_ledger as ledger
     set state = 'reserved',
         document_id = p_document_id,
         business_operation_id = p_business_operation_id,
         reserved_at = now(),
         updated_at = now()
   where ledger.tenant_id = selected.tenant_id
     and ledger.dte_type = selected.dte_type
     and ledger.folio = selected.folio
     and ledger.state = 'available';
  if not found then raise exception 'DTE_FOLIO_COLLISION'; end if;

  insert into public.dte_production_audit(
    tenant_id, document_id, action, metadata_safe
  ) values (
    p_tenant_id, p_document_id, 'folio_reserved',
    jsonb_build_object('dteType', p_dte_type, 'folio', selected.folio)
  );
  return query select selected.folio, selected.caf_id, false;
end;
$$;

revoke all on function public.reserve_dte_production_folio(
  uuid, integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.reserve_dte_production_folio(
  uuid, integer, uuid, text
) to service_role;

-- An exact retry is an explicit recovery operation, not an automatic retry.
-- It only claims a once-failed manual outbox whose draft has no irreversible
-- effects. deterministic_attempts=1 makes this operation single-use.
create or replace function public.dte_claim_manual_issuance_outbox_exact(
  p_worker_id text,
  p_outbox_id uuid
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' or p_outbox_id is null then
    raise exception 'DTE_WORKER_TARGET_INVALID';
  end if;

  select outbox.* into claimed
    from public.dte_issuance_outbox as outbox
   where outbox.id = p_outbox_id
   for update;
  if not found then raise exception 'DTE_TARGET_OUTBOX_NOT_FOUND'; end if;

  select intent.* into intent_row
    from public.dte_payment_document_intents as intent
   where intent.id = claimed.intent_id
     and intent.tenant_id = claimed.tenant_id
   for update;
  if not found then raise exception 'DTE_TARGET_INTENT_NOT_FOUND'; end if;

  if claimed.status <> 'BLOCKED' or
     claimed.deterministic_attempts <> 1 or
     claimed.network_attempts <> 0 or
     intent_row.status <> 'BLOCKED' or
     intent_row.deterministic_retry_count <> 1 or
     intent_row.network_attempt_count <> 0 or
     intent_row.trigger_source <> 'manual_admin' or
     intent_row.origin not in (
       'manual_standalone','manual_appointment','manual_payment',
       'credit_note','debit_note'
     ) or
     intent_row.resolved_dte_type not in (33,56,61) or
     intent_row.production_document_id is null then
    raise exception 'DTE_EXPLICIT_RETRY_NOT_ELIGIBLE';
  end if;

  if not exists (
    select 1 from public.dte_production_documents as document
     where document.id = intent_row.production_document_id
       and document.tenant_id = intent_row.tenant_id
       and document.status = 'draft'
       and document.folio is null
       and document.caf_id is null
       and document.track_id_ciphertext is null
       and document.track_id_fingerprint is null
       and document.sii_status is null
  ) or exists (
    select 1 from public.dte_production_folio_ledger as ledger
     where ledger.document_id = intent_row.production_document_id
  ) or exists (
    select 1 from public.dte_production_artifacts as artifact
     where artifact.document_id = intent_row.production_document_id
  ) or exists (
    select 1 from public.dte_production_submission_attempts as submission
     where submission.document_id = intent_row.production_document_id
  ) then
    raise exception 'DTE_EXPLICIT_RETRY_AMBIGUOUS_EFFECTS';
  end if;

  if not exists (
    select 1 from public.dte_tenant_issuance_settings as settings
     where settings.tenant_id = claimed.tenant_id
       and settings.production_enabled = true
  ) or not exists (
    select 1 from public.dte_legal_activation as activation
     where activation.tenant_id = claimed.tenant_id
       and activation.dte_type = intent_row.resolved_dte_type
       and activation.status = 'active'
  ) or exists (
    select 1 from public.dte_issuance_outbox as active
     where active.tenant_id = claimed.tenant_id
       and active.status = 'PROCESSING'
       and active.id <> claimed.id
  ) then
    raise exception 'DTE_EXPLICIT_RETRY_GATE_FAILED';
  end if;

  update public.dte_payment_document_intents as intent
     set status = 'PENDING',
         safe_blocking_reason = null,
         updated_at = now()
   where intent.id = intent_row.id
     and intent.tenant_id = intent_row.tenant_id
     and intent.status = 'BLOCKED';

  update public.dte_issuance_outbox as outbox
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = p_worker_id,
         lease_expires_at = now() + interval '15 minutes',
         last_safe_error = null,
         updated_at = now()
   where outbox.id = claimed.id
     and outbox.tenant_id = claimed.tenant_id
     and outbox.status = 'BLOCKED'
   returning outbox.* into claimed;
  if not found then raise exception 'DTE_EXPLICIT_RETRY_CLAIM_CONFLICT'; end if;

  insert into public.dte_document_events(
    tenant_id, intent_id, production_document_id, event_type, safe_metadata
  ) values (
    claimed.tenant_id,
    claimed.intent_id,
    intent_row.production_document_id,
    'MANUAL_ISSUANCE_RETRY_AUTHORIZED',
    jsonb_build_object(
      'automaticRetry', false,
      'targetOutboxId', claimed.id,
      'previousSafeError', intent_row.safe_blocking_reason,
      'retryOrdinal', 1
    )
  );
  return next claimed;
end;
$$;

revoke all on function public.dte_claim_manual_issuance_outbox_exact(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.dte_claim_manual_issuance_outbox_exact(
  text, uuid
) to service_role;

comment on function public.dte_claim_manual_issuance_outbox_exact(text, uuid) is
  'Single-use explicit claim for one blocked manual outbox with no folio, artifact or submission. Canceled and automatic rows are never eligible.';

commit;
