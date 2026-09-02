begin;

-- One shared, fail-closed gate for both oldest-first and exact automatic claims,
-- and for every automatic mutation that can still precede an SII fetch.
create or replace function public.dte_automatic_issuance_gate_open(
  p_tenant_id uuid,
  p_intent_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.dte_payment_document_intents i
      join public.tenants tenant
        on tenant.id = i.tenant_id
      join public.dte_tenant_issuance_settings cfg
        on cfg.tenant_id = i.tenant_id
      join public.dte_production_tenant_settings production
        on production.tenant_id = i.tenant_id
     where i.tenant_id = p_tenant_id
       and i.id = p_intent_id
       and i.trigger_source in ('khipu','webpay','mercadopago','manual_verified')
       and i.origin = 'automatic_payment'
       and i.resolved_dte_type in (33,39)
       and tenant.lifecycle_status = 'active'
       and (
         (i.trigger_source = 'manual_verified'
           and tenant.operational_mode in ('internal','live'))
         or (i.trigger_source <> 'manual_verified'
           and tenant.operational_mode = 'live')
       )
       and (
         i.trigger_source <> 'manual_verified'
         or (
           i.payment_intent_id is not null
           and i.created_by is not null
           and exists (
             select 1
               from public.payment_intents verified_pi
               join public.billing_sale_payments verified_bsp
                 on verified_bsp.tenant_id = verified_pi.tenant_id
                and verified_bsp.payment_intent_id = verified_pi.id
              where verified_pi.tenant_id = i.tenant_id
                and verified_pi.id = i.payment_intent_id
                and verified_pi.appointment_id = i.appointment_id
                and verified_pi.provider = 'manual'
                and verified_pi.status = 'succeeded'
                and verified_bsp.appointment_id = i.appointment_id
                and verified_bsp.provider = 'manual'
                and verified_bsp.status = 'VERIFIED'
                and verified_bsp.validation_result = 'provider_verified'
                and verified_bsp.reconciliation_status = 'NOT_REQUIRED'
                and verified_bsp.verified_by = i.created_by
           )
         )
       )
       and cfg.production_enabled = true
       and cfg.issuance_mode = 'automatic_on_verified_payment'
       and cfg.sii_authorization_status = 'approved'
       and cfg.certificate_ready = true
       and cfg.certificate_valid_to is not null
       and cfg.certificate_valid_to > pg_catalog.now()
       and cfg.caf_ready = true
       and cfg.folio_ready = true
       and cfg.endpoints_ready = true
       and cfg.storage_ready = true
       and cfg.worker_ready = true
       and cfg.readiness_tests_green = true
       and exists (
         select 1
           from public.dte_tenant_operational_readiness(i.tenant_id) readiness
          where readiness.ready_for_issuance = true
       )
       and production.enabled = true
       and production.issuance_mode = 'automatic'
       and production.sii_authorization_status = 'approved'
       and i.resolved_dte_type = any(production.authorized_types)
       and exists (
         select 1
           from public.dte_legal_activation activation
          where activation.tenant_id = i.tenant_id
            and activation.dte_type = i.resolved_dte_type
            and activation.status = 'active'
       )
       and coalesce(
         (
           public.dte_activation_gate_report(
             i.tenant_id,
             i.resolved_dte_type,
             true
           )->>'ready'
         )::boolean,
         false
       )
       and (
         i.resolved_dte_type <> 39
         or exists (
           select 1
             from public.dte_boleta39_commercial_customer_snapshots snapshot
            where snapshot.tenant_id = i.tenant_id
              and snapshot.intent_id = i.id
              and snapshot.customer_id = i.customer_id
              and nullif(pg_catalog.btrim(snapshot.customer_name), '') is not null
         )
       )
  );
$$;

revoke all on function public.dte_automatic_issuance_gate_open(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Internal core. p_require_target=true never falls back to the global oldest row
-- and intentionally performs no unrelated stale sweep.
create or replace function public.dte_claim_automatic_issuance_outbox_internal(
  p_worker_id text,
  p_target_outbox_id uuid,
  p_require_target boolean
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale record;
  claimed public.dte_issuance_outbox%rowtype;
  stale_reason text;
  stale_ambiguous boolean;
  stale_pre_network_evidence boolean;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$'
     or p_require_target is null
     or (p_require_target and p_target_outbox_id is null)
     or (not p_require_target and p_target_outbox_id is not null) then
    raise exception 'DTE_AUTOMATIC_WORKER_TARGET_INVALID';
  end if;

  if not p_require_target then
    for stale in
      select
        o.id as outbox_id,
        o.tenant_id,
        o.intent_id,
        o.network_attempts,
        i.production_document_id,
        i.network_attempt_count,
        exists (
          select 1
            from public.dte_production_submission_attempts submission
           where submission.tenant_id = o.tenant_id
             and submission.document_id = i.production_document_id
        ) as submission_exists,
        exists (
          select 1
            from public.dte_production_submission_attempts submission
           where submission.tenant_id = o.tenant_id
             and submission.document_id = i.production_document_id
             and submission.before_fetch_at is not null
        ) as fetch_started
        from public.dte_issuance_outbox o
        join public.dte_payment_document_intents i
          on i.tenant_id = o.tenant_id and i.id = o.intent_id
       where o.status = 'PROCESSING'
         and o.lease_expires_at is not null
         and o.lease_expires_at <= pg_catalog.now()
         and o.issuance_origin = 'automatic_system'
         and i.trigger_source in ('khipu','webpay','mercadopago','manual_verified')
         and i.origin = 'automatic_payment'
         and i.resolved_dte_type in (33,39)
       order by o.lease_expires_at asc
       for update of o skip locked
    loop
      stale_ambiguous := stale.fetch_started
        or stale.network_attempts > 0
        or stale.network_attempt_count > 0;
      stale_pre_network_evidence := not stale_ambiguous
        and (stale.production_document_id is not null or stale.submission_exists);
      stale_reason := case
        when stale_ambiguous then 'NETWORK_RESULT_UNKNOWN'
        when stale_pre_network_evidence then 'PRE_NETWORK_CRASH_STATE_PRESERVED'
        else 'WORKER_LEASE_EXPIRED'
      end;

      update public.dte_payment_document_intents
         set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
             safe_blocking_reason = stale_reason,
             network_attempt_count = case
               when stale_ambiguous then 1 else network_attempt_count end,
             updated_at = pg_catalog.now()
       where tenant_id = stale.tenant_id
         and id = stale.intent_id
         and status in ('PENDING','PREPARING','READY','SUBMITTING');

      update public.dte_issuance_outbox
         set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
             network_attempts = case when stale_ambiguous then 1 else network_attempts end,
             last_safe_error = stale_reason,
             locked_at = null,
             locked_by = null,
             claim_token = null,
             lease_expires_at = null,
             updated_at = pg_catalog.now()
       where id = stale.outbox_id
         and tenant_id = stale.tenant_id
         and status = 'PROCESSING';

      insert into public.dte_document_events(
        tenant_id, intent_id, production_document_id, event_type, safe_metadata
      ) values (
        stale.tenant_id,
        stale.intent_id,
        stale.production_document_id,
        case
          when stale_ambiguous then 'SUBMISSION_AMBIGUOUS'
          when stale_pre_network_evidence then 'PRE_NETWORK_CRASH_BLOCKED'
          else 'WORKER_LEASE_EXPIRED'
        end,
        pg_catalog.jsonb_build_object(
          'reason', stale_reason,
          'automaticRetry', false,
          'retryRequiresExplicitAuthorization', true,
          'evidencePreserved', stale_pre_network_evidence
        )
      );
    end loop;
  end if;

  select o.*
    into claimed
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i
      on i.tenant_id = o.tenant_id and i.id = o.intent_id
   where o.status = 'PENDING'
     and i.status = 'PENDING'
     and o.available_at <= pg_catalog.now()
     and (not p_require_target or o.id = p_target_outbox_id)
     and o.issuance_origin = 'automatic_system'
     and i.trigger_source in ('khipu','webpay','mercadopago','manual_verified')
     and i.origin = 'automatic_payment'
     and i.resolved_dte_type in (33,39)
     and o.network_attempts = 0
     and i.network_attempt_count = 0
     and i.production_document_id is null
     and public.dte_automatic_issuance_gate_open(i.tenant_id, i.id)
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
    if p_require_target then
      raise exception 'DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE';
    end if;
    return;
  end if;

  -- Serialize different candidate rows for the same tenant before the final
  -- status update; the existing partial unique index remains the last fence.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(claimed.tenant_id::text, 0)
  );
  if exists (
    select 1
      from public.dte_issuance_outbox active
     where active.tenant_id = claimed.tenant_id
       and active.status = 'PROCESSING'
       and active.id <> claimed.id
  ) then
    if p_require_target then
      raise exception 'DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE';
    end if;
    return;
  end if;

  update public.dte_issuance_outbox
     set status = 'PROCESSING',
         locked_at = pg_catalog.now(),
         locked_by = p_worker_id,
         claim_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = pg_catalog.now() + interval '15 minutes',
         updated_at = pg_catalog.now()
   where id = claimed.id
     and tenant_id = claimed.tenant_id
     and status = 'PENDING'
     and issuance_origin = 'automatic_system'
   returning * into claimed;

  if not found then
    if p_require_target then
      raise exception 'DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE';
    end if;
    return;
  end if;
  return next claimed;
end;
$$;

revoke all on function public.dte_claim_automatic_issuance_outbox_internal(text, uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.dte_claim_automatic_issuance_outbox(
  p_worker_id text
) returns setof public.dte_issuance_outbox
language sql
security definer
set search_path = ''
as $$
  select *
    from public.dte_claim_automatic_issuance_outbox_internal(
      p_worker_id, null::uuid, false
    );
$$;

create or replace function public.dte_claim_automatic_issuance_outbox_exact(
  p_worker_id text,
  p_outbox_id uuid
) returns setof public.dte_issuance_outbox
language sql
security definer
set search_path = ''
as $$
  select *
    from public.dte_claim_automatic_issuance_outbox_internal(
      p_worker_id, p_outbox_id, true
    );
$$;

revoke all on function public.dte_claim_automatic_issuance_outbox(text)
  from public, anon, authenticated;
revoke all on function public.dte_claim_automatic_issuance_outbox_exact(text, uuid)
  from public, anon, authenticated;
grant execute on function public.dte_claim_automatic_issuance_outbox(text)
  to service_role;
grant execute on function public.dte_claim_automatic_issuance_outbox_exact(text, uuid)
  to service_role;

comment on function public.dte_claim_automatic_issuance_outbox_exact(text, uuid) is
  'Claims only the requested eligible automatic DTE outbox. It never falls back to another row and never performs an unrelated stale sweep.';

-- Restore the manual-only stale domain after the later DTE39 migration widened
-- the effective sweep to every expired PROCESSING row.
create or replace function public.dte_claim_manual_issuance_outbox(
  p_worker_id text
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = ''
as $$
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
    select
      o.id as outbox_id,
      o.tenant_id,
      o.intent_id,
      o.network_attempts,
      i.production_document_id,
      i.network_attempt_count,
      exists (
        select 1
          from public.dte_production_submission_attempts submission
         where submission.tenant_id = o.tenant_id
           and submission.document_id = i.production_document_id
           and submission.before_fetch_at is not null
      ) as fetch_started
      from public.dte_issuance_outbox o
      join public.dte_payment_document_intents i
        on i.tenant_id = o.tenant_id and i.id = o.intent_id
     where o.status = 'PROCESSING'
       and o.lease_expires_at is not null
       and o.lease_expires_at <= pg_catalog.now()
       and o.issuance_origin in ('legacy_unknown','manual_admin')
       and i.trigger_source = 'manual_admin'
       and i.origin in (
         'manual_standalone','manual_appointment','manual_payment',
         'credit_note','debit_note'
       )
       and i.resolved_dte_type in (33,39,56,61)
     order by o.lease_expires_at asc
     for update of o skip locked
  loop
    stale_ambiguous := stale.fetch_started
      or stale.network_attempts > 0
      or stale.network_attempt_count > 0;
    stale_reason := case
      when stale_ambiguous then 'NETWORK_RESULT_UNKNOWN'
      else 'WORKER_LEASE_EXPIRED_EXPLICIT_RETRY_REQUIRED'
    end;

    update public.dte_payment_document_intents
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           safe_blocking_reason = stale_reason,
           network_attempt_count = case when stale_ambiguous then 1 else network_attempt_count end,
           updated_at = pg_catalog.now()
     where tenant_id = stale.tenant_id
       and id = stale.intent_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');

    update public.dte_issuance_outbox
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           network_attempts = case when stale_ambiguous then 1 else network_attempts end,
           last_safe_error = stale_reason,
           locked_at = null,
           locked_by = null,
           claim_token = null,
           lease_expires_at = null,
           updated_at = pg_catalog.now()
     where id = stale.outbox_id
       and tenant_id = stale.tenant_id
       and status = 'PROCESSING';

    insert into public.dte_document_events(
      tenant_id, intent_id, production_document_id, event_type, safe_metadata
    ) values (
      stale.tenant_id,
      stale.intent_id,
      stale.production_document_id,
      case when stale_ambiguous then 'SUBMISSION_AMBIGUOUS' else 'WORKER_LEASE_EXPIRED' end,
      pg_catalog.jsonb_build_object(
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
     and o.available_at <= pg_catalog.now()
     and o.issuance_origin in ('legacy_unknown','manual_admin')
     and i.trigger_source = 'manual_admin'
     and i.origin in (
       'manual_standalone','manual_appointment','manual_payment',
       'credit_note','debit_note'
     )
     and i.resolved_dte_type in (33,39,56,61)
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
         locked_at = pg_catalog.now(),
         locked_by = p_worker_id,
         lease_expires_at = pg_catalog.now() + interval '15 minutes',
         updated_at = pg_catalog.now()
   where id = claimed.id
     and tenant_id = claimed.tenant_id
     and status = 'PENDING'
     and issuance_origin in ('legacy_unknown','manual_admin')
   returning * into claimed;

  if found then
    return next claimed;
  end if;
end;
$$;

revoke all on function public.dte_claim_manual_issuance_outbox(text)
  from public, anon, authenticated;
grant execute on function public.dte_claim_manual_issuance_outbox(text)
  to service_role;

-- The persisted boundary is authoritative: before_fetch_at and both counters
-- are written atomically immediately before the first possible fetch.
create or replace function public.dte_mutate_automatic_issuance_claim(
  p_outbox_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_action text,
  p_production_document_id uuid default null,
  p_final_status text default null,
  p_safe_reason text default null,
  p_deterministic_attempts integer default null,
  p_event_type text default null,
  p_safe_metadata jsonb default '{}'::jsonb,
  p_submission_attempt_id uuid default null,
  p_network_milestone text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_row public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  next_document_id uuid;
  terminal_action boolean;
  network_crossed boolean;
  gate_open boolean;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$'
     or p_claim_token is null
     or p_action not in (
       'RENEW','PREPARING','READY','SUBMITTING',
       'NETWORK_BOUNDARY','COMPLETE','BLOCK','AMBIGUOUS'
     )
     or p_safe_metadata is null
     or pg_catalog.jsonb_typeof(p_safe_metadata) <> 'object' then
    return false;
  end if;

  select * into outbox_row
    from public.dte_issuance_outbox
   where id = p_outbox_id
   for update;
  if not found
     or outbox_row.status <> 'PROCESSING'
     or outbox_row.issuance_origin <> 'automatic_system'
     or outbox_row.locked_by is distinct from p_worker_id
     or outbox_row.claim_token is distinct from p_claim_token
     or outbox_row.lease_expires_at is null
     or outbox_row.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;

  select * into intent_row
    from public.dte_payment_document_intents
   where tenant_id = outbox_row.tenant_id
     and id = outbox_row.intent_id
   for update;
  if not found
     or intent_row.trigger_source not in ('khipu','webpay','mercadopago','manual_verified')
     or intent_row.origin <> 'automatic_payment'
     or intent_row.resolved_dte_type not in (33,39) then
    return false;
  end if;

  network_crossed := outbox_row.network_attempts > 0
    or intent_row.network_attempt_count > 0
    or exists (
      select 1
        from public.dte_production_submission_attempts submission
       where submission.tenant_id = intent_row.tenant_id
         and submission.document_id = intent_row.production_document_id
         and submission.before_fetch_at is not null
    );

  if p_action in ('RENEW','PREPARING','READY','SUBMITTING','NETWORK_BOUNDARY') then
    gate_open := public.dte_automatic_issuance_gate_open(
      intent_row.tenant_id,
      intent_row.id
    );
  end if;

  if p_action = 'NETWORK_BOUNDARY' and not gate_open and network_crossed then
    update public.dte_payment_document_intents
       set status = 'AMBIGUOUS',
           safe_blocking_reason = 'AUTOMATIC_GATE_CLOSED_POST_NETWORK',
           network_attempt_count = 1,
           updated_at = pg_catalog.now()
     where id = intent_row.id
       and tenant_id = intent_row.tenant_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');
    if not found then
      return false;
    end if;

    update public.dte_issuance_outbox
       set status = 'AMBIGUOUS',
           network_attempts = 1,
           last_safe_error = 'AUTOMATIC_GATE_CLOSED_POST_NETWORK',
           locked_at = null,
           locked_by = null,
           claim_token = null,
           lease_expires_at = null,
           updated_at = pg_catalog.now()
     where id = outbox_row.id
       and tenant_id = outbox_row.tenant_id
       and status = 'PROCESSING';

    insert into public.dte_document_events(
      tenant_id, intent_id, production_document_id, event_type, safe_metadata
    ) values (
      intent_row.tenant_id,
      intent_row.id,
      intent_row.production_document_id,
      'AUTOMATIC_GATE_CLOSED_POST_NETWORK',
      pg_catalog.jsonb_build_object(
        'automaticRetry', false,
        'networkBoundaryCrossed', true
      )
    );
    -- A previous fetch may have had an effect. Stop the next fetch and require
    -- reconciliation instead of continuing the seed/token/upload chain.
    return false;
  end if;

  if not network_crossed
     and p_action in ('RENEW','PREPARING','READY','SUBMITTING','NETWORK_BOUNDARY')
     and not gate_open then
    update public.dte_payment_document_intents
       set status = 'BLOCKED',
           safe_blocking_reason = 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK',
           updated_at = pg_catalog.now()
     where id = intent_row.id
       and tenant_id = intent_row.tenant_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');
    if not found then
      return false;
    end if;

    update public.dte_issuance_outbox
       set status = 'BLOCKED',
           last_safe_error = 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK',
           locked_at = null,
           locked_by = null,
           claim_token = null,
           lease_expires_at = null,
           updated_at = pg_catalog.now()
     where id = outbox_row.id
       and tenant_id = outbox_row.tenant_id
       and status = 'PROCESSING';

    insert into public.dte_document_events(
      tenant_id, intent_id, production_document_id, event_type, safe_metadata
    ) values (
      intent_row.tenant_id,
      intent_row.id,
      intent_row.production_document_id,
      'AUTOMATIC_GATE_CLOSED_PRE_NETWORK',
      pg_catalog.jsonb_build_object(
        'automaticRetry', false,
        'networkBoundaryCrossed', false
      )
    );
    -- Returning false makes the caller abort before executing its fetch while
    -- preserving this fail-closed state in the committed RPC transaction.
    return false;
  end if;

  next_document_id := coalesce(
    p_production_document_id,
    intent_row.production_document_id
  );
  if intent_row.production_document_id is not null
     and p_production_document_id is not null
     and intent_row.production_document_id <> p_production_document_id then
    return false;
  end if;
  terminal_action := p_action in ('COMPLETE','BLOCK','AMBIGUOUS');

  if p_action = 'RENEW' then
    null;
  elsif p_action = 'PREPARING' then
    if intent_row.status not in ('PENDING','PREPARING') or next_document_id is null then
      return false;
    end if;
    update public.dte_payment_document_intents
       set status = 'PREPARING', production_document_id = next_document_id,
           safe_blocking_reason = null, updated_at = pg_catalog.now()
     where id = intent_row.id and tenant_id = intent_row.tenant_id;
  elsif p_action = 'READY' then
    if intent_row.status not in ('PREPARING','READY') or next_document_id is null then
      return false;
    end if;
    update public.dte_payment_document_intents
       set status = 'READY', production_document_id = next_document_id,
           safe_blocking_reason = null, updated_at = pg_catalog.now()
     where id = intent_row.id and tenant_id = intent_row.tenant_id;
  elsif p_action = 'SUBMITTING' then
    if intent_row.status not in ('READY','SUBMITTING')
       or next_document_id is null
       or intent_row.network_attempt_count <> 0
       or outbox_row.network_attempts <> 0 then
      return false;
    end if;
    update public.dte_payment_document_intents
       set status = 'SUBMITTING', production_document_id = next_document_id,
           safe_blocking_reason = null, updated_at = pg_catalog.now()
     where id = intent_row.id and tenant_id = intent_row.tenant_id;
  elsif p_action = 'NETWORK_BOUNDARY' then
    if intent_row.status <> 'SUBMITTING'
       or next_document_id is null
       or p_submission_attempt_id is null
       or p_network_milestone not in (
         'seed_before_fetch','token_before_fetch','upload_before_fetch'
       ) then
      return false;
    end if;
    update public.dte_production_submission_attempts
       set before_fetch_at = coalesce(before_fetch_at, pg_catalog.now()),
           status = case when status = 'persisted' then 'uploading' else status end
     where id = p_submission_attempt_id
       and tenant_id = intent_row.tenant_id
       and document_id = next_document_id
       and status in ('persisted','uploading');
    if not found then
      return false;
    end if;
    update public.dte_payment_document_intents
       set network_attempt_count = 1, updated_at = pg_catalog.now()
     where id = intent_row.id
       and tenant_id = intent_row.tenant_id
       and network_attempt_count in (0,1);
    update public.dte_issuance_outbox
       set network_attempts = 1, updated_at = pg_catalog.now()
     where id = outbox_row.id
       and tenant_id = outbox_row.tenant_id
       and network_attempts in (0,1);
  elsif p_action = 'COMPLETE' then
    if intent_row.status <> 'SUBMITTING'
       or p_final_status not in ('SUBMITTED','REJECTED')
       or intent_row.network_attempt_count <> 1
       or outbox_row.network_attempts <> 1 then
      return false;
    end if;
    update public.dte_payment_document_intents
       set status = p_final_status,
           safe_blocking_reason = case when p_final_status = 'REJECTED'
             then pg_catalog.left(coalesce(p_safe_reason,'SII_EXPLICIT_REJECTION'),240)
             else null end,
           updated_at = pg_catalog.now()
     where id = intent_row.id and tenant_id = intent_row.tenant_id;
    update public.dte_issuance_outbox
       set status = 'COMPLETED', last_safe_error = pg_catalog.left(p_safe_reason,240),
           locked_at = null, locked_by = null, claim_token = null,
           lease_expires_at = null, updated_at = pg_catalog.now()
     where id = outbox_row.id and tenant_id = outbox_row.tenant_id;
  elsif p_action = 'BLOCK' then
    if intent_row.network_attempt_count <> 0
       or outbox_row.network_attempts <> 0
       or p_deterministic_attempts is null
       or p_deterministic_attempts not between 0 and 3 then
      return false;
    end if;
    update public.dte_payment_document_intents
       set status = 'BLOCKED',
           safe_blocking_reason = pg_catalog.left(
             coalesce(p_safe_reason,'DTE_AUTOMATIC_PREPARATION_FAILED'),240
           ),
           deterministic_retry_count = p_deterministic_attempts,
           updated_at = pg_catalog.now()
     where id = intent_row.id
       and tenant_id = intent_row.tenant_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');
    if not found then
      return false;
    end if;
    update public.dte_issuance_outbox
       set status = 'BLOCKED', deterministic_attempts = p_deterministic_attempts,
           last_safe_error = pg_catalog.left(
             coalesce(p_safe_reason,'DTE_AUTOMATIC_PREPARATION_FAILED'),240
           ),
           locked_at = null, locked_by = null, claim_token = null,
           lease_expires_at = null, updated_at = pg_catalog.now()
     where id = outbox_row.id and tenant_id = outbox_row.tenant_id;
  elsif p_action = 'AMBIGUOUS' then
    if intent_row.network_attempt_count <> 1 or outbox_row.network_attempts <> 1 then
      return false;
    end if;
    update public.dte_payment_document_intents
       set status = 'AMBIGUOUS',
           safe_blocking_reason = pg_catalog.left(
             coalesce(p_safe_reason,'NETWORK_RESULT_UNKNOWN'),240
           ),
           network_attempt_count = 1,
           updated_at = pg_catalog.now()
     where id = intent_row.id
       and tenant_id = intent_row.tenant_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');
    if not found then
      return false;
    end if;
    update public.dte_issuance_outbox
       set status = 'AMBIGUOUS', network_attempts = 1,
           last_safe_error = pg_catalog.left(
             coalesce(p_safe_reason,'NETWORK_RESULT_UNKNOWN'),240
           ),
           locked_at = null, locked_by = null, claim_token = null,
           lease_expires_at = null, updated_at = pg_catalog.now()
     where id = outbox_row.id and tenant_id = outbox_row.tenant_id;
  end if;

  if not terminal_action then
    update public.dte_issuance_outbox
       set lease_expires_at = pg_catalog.now() + interval '15 minutes',
           updated_at = pg_catalog.now()
     where id = outbox_row.id
       and tenant_id = outbox_row.tenant_id
       and status = 'PROCESSING'
       and locked_by = p_worker_id
       and claim_token = p_claim_token;
    if not found then
      return false;
    end if;
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_event_type,'')),'') is not null then
    insert into public.dte_document_events(
      tenant_id, intent_id, production_document_id, event_type, safe_metadata
    ) values (
      intent_row.tenant_id,
      intent_row.id,
      next_document_id,
      pg_catalog.left(pg_catalog.btrim(p_event_type),120),
      p_safe_metadata
    );
  end if;
  return true;
end;
$$;

revoke all on function public.dte_mutate_automatic_issuance_claim(
  uuid, text, uuid, text, uuid, text, text, integer, text, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.dte_mutate_automatic_issuance_claim(
  uuid, text, uuid, text, uuid, text, text, integer, text, jsonb, uuid, text
) to service_role;

-- Explicit deterministic retry remains available only when no document or
-- submission-attempt evidence was preserved. Network-possible states stay closed.
create or replace function public.dte_retry_blocked_issuance(
  p_tenant_id uuid,
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  can_retry boolean;
begin
  if exists (
    select 1
      from public.dte_payment_document_intents i
      join public.dte_issuance_outbox o
        on o.tenant_id = i.tenant_id and o.intent_id = i.id
     where i.tenant_id = p_tenant_id
       and i.id = p_intent_id
       and o.issuance_origin = 'automatic_system'
       and (
         i.production_document_id is not null
         or exists (
           select 1
             from public.dte_production_submission_attempts submission
            where submission.tenant_id = i.tenant_id
              and submission.document_id = i.production_document_id
         )
       )
  ) then
    return false;
  end if;

  select readiness.ready_for_issuance into can_retry
    from public.dte_tenant_operational_readiness(p_tenant_id) readiness;
  if coalesce(can_retry, false) = false then
    return false;
  end if;

  update public.dte_payment_document_intents
     set status = 'PENDING', safe_blocking_reason = null,
         updated_at = pg_catalog.now()
   where id = p_intent_id
     and tenant_id = p_tenant_id
     and status = 'BLOCKED'
     and network_attempt_count = 0
     and deterministic_retry_count < 3;
  if not found then
    return false;
  end if;

  update public.dte_issuance_outbox
     set status = 'PENDING', available_at = pg_catalog.now(),
         locked_at = null, locked_by = null, claim_token = null,
         lease_expires_at = null, last_safe_error = null,
         updated_at = pg_catalog.now()
   where tenant_id = p_tenant_id
     and intent_id = p_intent_id
     and status = 'BLOCKED'
     and network_attempts = 0
     and deterministic_attempts < 3;
  if not found then
    raise exception 'DTE_RETRY_OUTBOX_STATE_INVALID';
  end if;

  insert into public.dte_document_events(
    tenant_id, intent_id, event_type, safe_metadata
  ) values (
    p_tenant_id,
    p_intent_id,
    'ISSUANCE_REQUEUED',
    pg_catalog.jsonb_build_object('automaticRetry', false)
  );
  return true;
end;
$$;

revoke all on function public.dte_retry_blocked_issuance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.dte_retry_blocked_issuance(uuid, uuid)
  to service_role;

comment on function public.dte_claim_automatic_issuance_outbox(text) is
  'Claims the oldest eligible automatic 33/39 outbox, recovers only automatic stale leases, and preserves pre-network crash evidence without retry.';
comment on function public.dte_mutate_automatic_issuance_claim(
  uuid, text, uuid, text, uuid, text, text, integer, text, jsonb, uuid, text
) is
  'Fenced automatic mutation. Pre-network actions revalidate tenant/product/legal gates; post-boundary terminal persistence remains allowed.';

commit;
