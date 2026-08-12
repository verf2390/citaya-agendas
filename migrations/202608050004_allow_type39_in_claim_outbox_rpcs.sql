-- Migration: 202608050004_allow_type39_in_claim_outbox_rpcs.sql
--
-- Purpose:
-- Update dte_claim_manual_issuance_outbox and dte_claim_manual_issuance_outbox_exact
-- to include DTE type 39 in allowed types (33, 39, 56, 61), allow exact claiming
-- of PENDING outbox items as well as BLOCKED retries, and allow resuming
-- prepared documents (status in ('draft', 'prepared')) when no track_id exists.

CREATE OR REPLACE FUNCTION public.dte_claim_manual_issuance_outbox(p_worker_id text)
 RETURNS SETOF dte_issuance_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  stale record;
  claimed public.dte_issuance_outbox%rowtype;
  stale_reason text;
  stale_ambiguous boolean;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' then
    raise exception 'DTE_WORKER_ID_INVALID';
  end if;

  for stale in
    select o.id as outbox_id, o.tenant_id, o.intent_id, o.network_attempts,
           i.production_document_id
      from public.dte_issuance_outbox o
      join public.dte_payment_document_intents i
        on i.tenant_id = o.tenant_id and i.id = o.intent_id
     where o.status = 'PROCESSING'
       and o.lease_expires_at is not null
       and o.lease_expires_at <= now()
     order by o.lease_expires_at asc
     for update of o skip locked
  loop
    stale_ambiguous := false;
    stale_reason := 'WORKER_LEASE_EXPIRED';

    if stale.production_document_id is not null then
      select exists (
        select 1
          from public.dte_production_submission_attempts
         where tenant_id = stale.tenant_id
           and document_id = stale.production_document_id
           and before_fetch_at is not null
      ) into stale_ambiguous;
      if stale_ambiguous then
        stale_reason := 'NETWORK_RESULT_UNKNOWN';
      end if;
    end if;

    update public.dte_payment_document_intents
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           safe_blocking_reason = stale_reason,
           updated_at = now()
     where id = stale.intent_id
       and tenant_id = stale.tenant_id;

    update public.dte_issuance_outbox
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           last_safe_error = stale_reason,
           lease_expires_at = null,
           updated_at = now()
     where id = stale.outbox_id
       and tenant_id = stale.tenant_id
       and status = 'PROCESSING';

    insert into public.dte_document_events(
      tenant_id, intent_id, production_document_id, event_type, safe_metadata
    ) values (
      stale.tenant_id, stale.intent_id, stale.production_document_id,
      case when stale_ambiguous then 'SUBMISSION_AMBIGUOUS' else 'WORKER_LEASE_EXPIRED' end,
      jsonb_build_object(
        'reason', stale_reason,
        'automaticRetry', false,
        'retryRequiresExplicitAuthorization', true
      )
    );
  end loop;

  select o.*
    into claimed
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i
      on i.tenant_id = o.tenant_id and i.id = o.intent_id
    join public.dte_tenant_issuance_settings cfg
      on cfg.tenant_id = o.tenant_id
   where o.status = 'PENDING'
     and i.status = 'PENDING'
     and o.available_at <= now()
     and i.trigger_source = 'manual_admin'
     and i.origin in (
       'manual_standalone',
       'manual_appointment',
       'manual_payment',
       'credit_note',
       'debit_note'
     )
     and i.resolved_dte_type in (33, 39, 56, 61)
     and cfg.production_enabled = true
     and not exists (
       select 1
         from public.dte_issuance_outbox active
        where active.tenant_id = o.tenant_id
          and active.status = 'PROCESSING'
     )
   order by o.created_at
   for update of o skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.dte_issuance_outbox
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = p_worker_id,
         lease_expires_at = now() + interval '15 minutes',
         updated_at = now()
   where id = claimed.id
     and tenant_id = claimed.tenant_id
     and status = 'PENDING'
   returning * into claimed;

  if found then
    return next claimed;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dte_claim_manual_issuance_outbox_exact(p_worker_id text, p_outbox_id uuid)
 RETURNS SETOF dte_issuance_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if claimed.status not in ('BLOCKED', 'PENDING') or
     intent_row.status not in ('BLOCKED', 'PENDING') or
     intent_row.trigger_source <> 'manual_admin' or
     intent_row.origin not in (
       'manual_standalone','manual_appointment','manual_payment',
       'credit_note','debit_note'
     ) or
     intent_row.resolved_dte_type not in (33,39,56,61) then
    raise exception 'DTE_EXPLICIT_RETRY_NOT_ELIGIBLE';
  end if;

  if intent_row.production_document_id is not null then
    if not exists (
      select 1 from public.dte_production_documents as document
       where document.id = intent_row.production_document_id
         and document.tenant_id = intent_row.tenant_id
         and document.status in ('draft', 'prepared', 'ready')
         and document.track_id_ciphertext is null
         and document.track_id_fingerprint is null
         and document.sii_status is null
    ) then
      raise exception 'DTE_EXPLICIT_RETRY_AMBIGUOUS_EFFECTS';
    end if;
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
     and outbox.status in ('BLOCKED', 'PENDING')
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
      'retryOrdinal', 2
    )
  );
  return next claimed;
end;
$function$;
