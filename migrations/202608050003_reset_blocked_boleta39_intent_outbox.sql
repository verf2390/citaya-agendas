-- Migration: 202608050003_reset_blocked_boleta39_intent_outbox.sql
--
-- CONTEXT:
-- The intent d426895b and outbox 1281897d were blocked by the former
-- dte_complete_intent_snapshot trigger guard (BLOCKED_DOCUMENT_ENGINE_NOT_READY)
-- which has now been removed in migration 202608050002.
--
-- This migration resets them to PENDING so the worker can pick up the
-- issuance without creating a new intent or outbox row.
--
-- SAFETY CONDITIONS (verified before applying):
--   production_document_id = null   (no document was created)
--   network_attempts = 0            (SII was never contacted)
--   folio 40013 = available         (no folio was reserved)
--   FOLIOS_RESERVED = 0
--   FOLIOS_CONSUMED = 0
--   XML_ARTIFACTS = 0
--   PDF_ARTIFACTS = 0
--   SUBMIT_EXECUTED = false
--   SII_CONTACTED = false
--
-- WHAT THIS DOES:
--   1. Resets the intent status from BLOCKED to PENDING, clears safe_blocking_reason.
--   2. Resets the outbox status from BLOCKED to PENDING, clears last_safe_error,
--      resets available_at to now() so the worker can claim it immediately.
--   3. Appends a dte_document_events record for audit trail.
--   4. Verifies preconditions atomically before updating.
--
-- IDEMPOTENT: guarded by status check — only runs if status=BLOCKED.

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := '21884d8b-1975-4e5c-8887-06eb62401428';
  v_intent_id uuid := 'd426895b-2c6c-46c4-9961-fc135d9eb7b1';
  v_outbox_id uuid := '1281897d-80a1-460e-9965-1b14cfb2dc39';
  v_prod_doc_id uuid;
  v_network_attempts integer;
  v_folio_40013_state text;
  v_intent_status text;
  v_outbox_status text;
BEGIN
  -- Read exact state
  SELECT status, production_document_id
  INTO v_intent_status, v_prod_doc_id
  FROM public.dte_payment_document_intents
  WHERE id = v_intent_id AND tenant_id = v_tenant_id;

  SELECT status, network_attempts
  INTO v_outbox_status, v_network_attempts
  FROM public.dte_issuance_outbox
  WHERE id = v_outbox_id AND tenant_id = v_tenant_id;

  SELECT state INTO v_folio_40013_state
  FROM public.dte_production_folio_ledger
  WHERE folio = 40013;

  -- Idempotency: if already PENDING, skip
  IF v_intent_status = 'PENDING' AND v_outbox_status = 'PENDING' THEN
    RAISE NOTICE 'ALREADY_PENDING: intent and outbox already PENDING, skipping reset';
    RETURN;
  END IF;

  -- Safety precondition checks
  IF v_intent_status IS NULL THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: intent not found';
  END IF;
  IF v_outbox_status IS NULL THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: outbox not found';
  END IF;
  IF v_intent_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: intent status is % (expected BLOCKED)', v_intent_status;
  END IF;
  IF v_outbox_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: outbox status is % (expected BLOCKED)', v_outbox_status;
  END IF;
  IF v_prod_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: production_document_id is not null (%), would create duplicate', v_prod_doc_id;
  END IF;
  IF v_network_attempts <> 0 THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: network_attempts=% (expected 0, SII may have been contacted)', v_network_attempts;
  END IF;
  IF v_folio_40013_state <> 'available' THEN
    RAISE EXCEPTION 'RESET_PRECONDITION_FAILED: folio 40013 state is % (expected available)', v_folio_40013_state;
  END IF;

  -- All preconditions met — reset intent to PENDING
  UPDATE public.dte_payment_document_intents
  SET
    status = 'PENDING',
    safe_blocking_reason = NULL,
    deterministic_retry_count = 0,
    updated_at = now()
  WHERE id = v_intent_id AND tenant_id = v_tenant_id AND status = 'BLOCKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESET_FAILED: intent update affected 0 rows';
  END IF;

  -- Reset outbox to PENDING, make available immediately
  UPDATE public.dte_issuance_outbox
  SET
    status = 'PENDING',
    last_safe_error = NULL,
    deterministic_attempts = 0,
    available_at = now(),
    lease_expires_at = NULL,
    updated_at = now()
  WHERE id = v_outbox_id AND tenant_id = v_tenant_id AND status = 'BLOCKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESET_FAILED: outbox update affected 0 rows';
  END IF;

  -- Audit event
  INSERT INTO public.dte_document_events (tenant_id, intent_id, event_type, safe_metadata)
  VALUES (
    v_tenant_id,
    v_intent_id,
    'MANUAL_ISSUANCE_RESET_TO_PENDING',
    jsonb_build_object(
      'reason', 'BLOCKED_DOCUMENT_ENGINE_NOT_READY_resolved',
      'migration', '202608050003',
      'priorIntentStatus', 'BLOCKED',
      'priorOutboxStatus', 'BLOCKED',
      'preconditionsVerified', true
    )
  );

  RAISE NOTICE 'RESET_OK: intent % and outbox % reset to PENDING', v_intent_id, v_outbox_id;
END $$;

COMMIT;
