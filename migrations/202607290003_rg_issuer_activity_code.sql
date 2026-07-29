begin;

do $$
declare
  v_tenant_id uuid;
  v_existing_code text;
  v_document_id constant uuid := '7548fdc5-3da9-4ac0-a926-937393a7d846';
  v_intent_id constant uuid := '0b278849-9846-45a0-9dbb-58b5988bd69b';
  v_outbox_id constant uuid := '7197c922-63da-4c4f-aac6-1d5eb83387f7';
begin
  select tenant.id
    into strict v_tenant_id
    from public.tenants as tenant
   where tenant.slug = 'rg-spa';

  select settings.issuer_activity_code
    into strict v_existing_code
    from public.dte_production_tenant_settings as settings
   where settings.tenant_id = v_tenant_id
   for update;

  if nullif(btrim(v_existing_code), '') is not null
     and btrim(v_existing_code) <> '620900' then
    raise exception 'DTE_RG_ISSUER_ACTIVITY_CODE_CONFLICT';
  end if;

  if not exists (
    select 1
      from public.dte_payment_document_intents as intent
      join public.dte_issuance_outbox as outbox
        on outbox.intent_id = intent.id
      join public.dte_production_documents as document
        on document.id = intent.production_document_id
      join public.dte_production_folio_ledger as ledger
        on ledger.tenant_id = intent.tenant_id
       and ledger.dte_type = document.dte_type
       and ledger.folio = document.folio
     where intent.id = v_intent_id
       and intent.tenant_id = v_tenant_id
       and intent.status = 'BLOCKED'
       and intent.safe_blocking_reason = 'XSD'
       and intent.network_attempt_count = 0
       and intent.amount_snapshot = 5000
       and outbox.id = v_outbox_id
       and outbox.status = 'BLOCKED'
       and outbox.network_attempts = 0
       and outbox.last_safe_error = 'XSD'
       and outbox.lease_expires_at is null
       and document.id = v_document_id
       and document.status = 'prepared'
       and document.dte_type = 33
       and document.folio = 8
       and document.net_amount = 4202
       and document.tax_amount = 798
       and document.total_amount = 5000
       and document.track_id_ciphertext is null
       and document.track_id_fingerprint is null
       and document.sii_status is null
       and document.final_response_sha256 is null
       and ledger.state = 'reserved'
       and ledger.document_id = document.id
       and ledger.business_operation_id = document.business_operation_id
       and ledger.caf_id = document.caf_id
  ) or exists (
    select 1
      from public.dte_production_artifacts as artifact
     where artifact.document_id = v_document_id
  ) or exists (
    select 1
      from public.dte_production_submission_attempts as submission
     where submission.document_id = v_document_id
  ) then
    raise exception 'DTE_RG_ISSUER_ACTIVITY_EVIDENCE_PRECONDITION_FAILED';
  end if;

  update public.dte_production_tenant_settings
     set issuer_activity_code = '620900',
         updated_at = now()
   where tenant_id = v_tenant_id
     and coalesce(nullif(btrim(issuer_activity_code), ''), '620900') = '620900';

  if not found then
    raise exception 'DTE_RG_ISSUER_ACTIVITY_CODE_WRITE_CONFLICT';
  end if;

  if not exists (
    select 1
      from public.dte_production_audit as audit
     where audit.tenant_id = v_tenant_id
       and audit.document_id = v_document_id
       and audit.action = 'issuer_activity_code_evidence_recorded'
       and audit.metadata_safe @> jsonb_build_object(
         'activityCode', '620900',
         'effectiveDate', '2026-04-27'
       )
  ) then
    insert into public.dte_production_audit(
      tenant_id,
      document_id,
      action,
      metadata_safe
    ) values (
      v_tenant_id,
      v_document_id,
      'issuer_activity_code_evidence_recorded',
      jsonb_build_object(
        'activityCode', '620900',
        'description', 'OTRAS ACTIVIDADES DE TECNOLOGIA DE LA INFORMACION Y DE SERVICIOS INFORMATICOS',
        'effectiveDate', '2026-04-27',
        'vatAffected', true,
        'evidenceSource', 'operator_supplied_official_sii_evidence',
        'intentId', v_intent_id,
        'outboxId', v_outbox_id,
        'folio', 8
      )
    );
  end if;
end;
$$;

commit;
