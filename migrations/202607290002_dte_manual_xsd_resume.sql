begin;

-- Explicit, single-use recovery for a manual document that already owns a
-- reserved folio and failed XSD validation before artifacts or network I/O.
create or replace function public.dte_claim_manual_xsd_resume_exact(
  p_worker_id text,
  p_outbox_id uuid,
  p_intent_id uuid,
  p_document_id uuid,
  p_expected_folio integer,
  p_expected_gross integer,
  p_expected_net integer,
  p_expected_tax integer
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  document_row public.dte_production_documents%rowtype;
  ledger_row public.dte_production_folio_ledger%rowtype;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' or
     p_outbox_id is null or p_intent_id is null or p_document_id is null or
     p_expected_folio < 1 or p_expected_gross < 1 or
     p_expected_net < 0 or p_expected_tax < 0 or
     p_expected_gross <> p_expected_net + p_expected_tax then
    raise exception 'DTE_CONTROLLED_RESUME_INPUT_INVALID';
  end if;

  select outbox.* into claimed
    from public.dte_issuance_outbox as outbox
   where outbox.id = p_outbox_id
     and outbox.intent_id = p_intent_id
   for update;
  if not found then raise exception 'DTE_CONTROLLED_RESUME_OUTBOX_NOT_FOUND'; end if;

  select intent.* into intent_row
    from public.dte_payment_document_intents as intent
   where intent.id = p_intent_id
     and intent.tenant_id = claimed.tenant_id
     and intent.production_document_id = p_document_id
   for update;
  if not found then raise exception 'DTE_CONTROLLED_RESUME_INTENT_NOT_FOUND'; end if;

  if claimed.status <> 'BLOCKED' or
     claimed.deterministic_attempts <> 2 or
     claimed.network_attempts <> 0 or
     claimed.last_safe_error <> 'XSD' or
     claimed.lease_expires_at is not null or
     intent_row.status <> 'BLOCKED' or
     intent_row.deterministic_retry_count <> 2 or
     intent_row.network_attempt_count <> 0 or
     intent_row.safe_blocking_reason <> 'XSD' or
     intent_row.trigger_source <> 'manual_admin' or
     intent_row.origin not in ('manual_standalone','manual_appointment','manual_payment') or
     intent_row.resolved_dte_type <> 33 or
     intent_row.amount_snapshot <> p_expected_gross then
    raise exception 'DTE_CONTROLLED_RESUME_NOT_ELIGIBLE';
  end if;

  select document.* into document_row
    from public.dte_production_documents as document
   where document.id = p_document_id
     and document.tenant_id = claimed.tenant_id
   for update;
  if not found or
     document_row.status <> 'prepared' or
     document_row.dte_type <> intent_row.resolved_dte_type or
     document_row.folio <> p_expected_folio or
     document_row.caf_id is null or
     document_row.net_amount <> p_expected_net or
     document_row.exempt_amount <> 0 or
     document_row.tax_amount <> p_expected_tax or
     document_row.total_amount <> p_expected_gross or
     document_row.track_id_ciphertext is not null or
     document_row.track_id_fingerprint is not null or
     document_row.sii_status is not null or
     document_row.final_response_sha256 is not null then
    raise exception 'DTE_CONTROLLED_RESUME_DOCUMENT_MISMATCH';
  end if;

  select ledger.* into ledger_row
    from public.dte_production_folio_ledger as ledger
   where ledger.tenant_id = claimed.tenant_id
     and ledger.dte_type = document_row.dte_type
     and ledger.folio = p_expected_folio
   for update;
  if not found or
     ledger_row.state <> 'reserved' or
     ledger_row.document_id <> document_row.id or
     ledger_row.business_operation_id <> document_row.business_operation_id or
     ledger_row.caf_id <> document_row.caf_id then
    raise exception 'DTE_CONTROLLED_RESUME_FOLIO_MISMATCH';
  end if;

  if exists (
    select 1 from public.dte_production_folio_ledger as other
     where other.tenant_id = claimed.tenant_id
       and (other.document_id = document_row.id or
            other.business_operation_id = document_row.business_operation_id)
       and (other.dte_type <> document_row.dte_type or
            other.folio <> document_row.folio)
  ) or exists (
    select 1 from public.dte_production_artifacts as artifact
     where artifact.document_id = document_row.id
  ) or exists (
    select 1 from public.dte_production_submission_attempts as submission
     where submission.document_id = document_row.id
  ) then
    raise exception 'DTE_CONTROLLED_RESUME_AMBIGUOUS_EFFECTS';
  end if;

  if not exists (
    select 1 from public.dte_tenant_issuance_settings as settings
     where settings.tenant_id = claimed.tenant_id
       and settings.production_enabled = true
  ) or not exists (
    select 1 from public.dte_legal_activation as activation
     where activation.tenant_id = claimed.tenant_id
       and activation.dte_type = 33
       and activation.status = 'active'
  ) or exists (
    select 1 from public.dte_issuance_outbox as active
     where active.tenant_id = claimed.tenant_id
       and active.status = 'PROCESSING'
       and active.id <> claimed.id
  ) then
    raise exception 'DTE_CONTROLLED_RESUME_GATE_FAILED';
  end if;

  update public.dte_payment_document_intents as intent
     set status = 'PENDING',
         safe_blocking_reason = null,
         updated_at = now()
   where intent.id = intent_row.id
     and intent.status = 'BLOCKED';
  if not found then raise exception 'DTE_CONTROLLED_RESUME_INTENT_CONFLICT'; end if;

  update public.dte_issuance_outbox as outbox
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = p_worker_id,
         lease_expires_at = now() + interval '15 minutes',
         last_safe_error = null,
         updated_at = now()
   where outbox.id = claimed.id
     and outbox.status = 'BLOCKED'
   returning outbox.* into claimed;
  if not found then raise exception 'DTE_CONTROLLED_RESUME_CLAIM_CONFLICT'; end if;

  insert into public.dte_document_events(
    tenant_id, intent_id, production_document_id, event_type, safe_metadata
  ) values (
    claimed.tenant_id,
    claimed.intent_id,
    document_row.id,
    'MANUAL_ISSUANCE_XSD_RESUME_AUTHORIZED',
    jsonb_build_object(
      'automaticRetry', false,
      'targetOutboxId', claimed.id,
      'previousSafeError', 'XSD',
      'retryOrdinal', 2,
      'folioReused', document_row.folio,
      'additionalFolioReserved', false
    )
  );
  return next claimed;
end;
$$;

revoke all on function public.dte_claim_manual_xsd_resume_exact(
  text, uuid, uuid, uuid, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.dte_claim_manual_xsd_resume_exact(
  text, uuid, uuid, uuid, integer, integer, integer, integer
) to service_role;

comment on function public.dte_claim_manual_xsd_resume_exact(
  text, uuid, uuid, uuid, integer, integer, integer, integer
) is 'Single-use targeted XSD pre-submit resume that requires and preserves the existing reserved folio; canceled rows are never eligible.';

commit;
