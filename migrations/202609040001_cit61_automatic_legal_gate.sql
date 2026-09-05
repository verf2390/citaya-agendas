begin;

-- CIT-61: continuous, fail-closed legal authorization for automatic production
-- issuance. This migration changes no tenant mode, CAF, folio, or production
-- data. All authority is derived from persisted tenant/payment/DTE relations.

create or replace function public.dte_automatic_issuance_gate_report(
  p_tenant_id uuid,
  p_intent_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.dte_payment_document_intents%rowtype;
  o public.dte_issuance_outbox%rowtype;
  legal_report jsonb := '{"ready":false}'::jsonb;
  technical_report jsonb := '{"ready":false,"tenantConfigured":false}'::jsonb;
  capabilities jsonb := '{}'::jsonb;
  intent_exact boolean := false;
  outbox_exact boolean := false;
  payment_exact boolean := false;
  payment_verified boolean := false;
  automatic_origin boolean := false;
  trigger_source_ready boolean := false;
  dte_type_ready boolean := false;
  tenant_active boolean := false;
  operational_mode_ready boolean := false;
  operational_capability_ready boolean := false;
  legal_ready boolean := false;
  dte_authority_ready boolean := false;
  technical_ready boolean := false;
  operational_readiness_ready boolean := false;
  production_settings_ready boolean := false;
  activation_ready boolean := false;
  commercial_snapshot_ready boolean := false;
  fresh_folio_available boolean := false;
  owned_folio_reusable boolean := false;
  folio_ready boolean := false;
  network_safe boolean := false;
  ready_value boolean := false;
  outbox_count bigint := 0;
  attempt_count bigint := 0;
  before_fetch_count bigint := 0;
  blocking_reasons text[] := array[]::text[];
begin
  select intent.* into i
    from public.dte_payment_document_intents intent
   where intent.tenant_id = p_tenant_id
     and intent.id = p_intent_id;
  intent_exact := found;

  if intent_exact then
    select pg_catalog.count(*) into outbox_count
      from public.dte_issuance_outbox candidate
     where candidate.tenant_id = i.tenant_id
       and candidate.intent_id = i.id;
    if outbox_count = 1 then
      select candidate.* into o
        from public.dte_issuance_outbox candidate
       where candidate.tenant_id = i.tenant_id
         and candidate.intent_id = i.id;
      outbox_exact := o.issuance_origin = 'automatic_system'
        and o.status in ('PENDING','PROCESSING','BLOCKED');
    end if;

    automatic_origin := i.origin = 'automatic_payment'
      and outbox_exact
      and o.issuance_origin = 'automatic_system';
    trigger_source_ready := i.trigger_source in (
      'khipu','webpay','mercadopago','manual_verified'
    );
    dte_type_ready := i.resolved_dte_type in (33,39);

    select exists(
      select 1 from public.tenants tenant
       where tenant.id = i.tenant_id
         and tenant.lifecycle_status = 'active'
    ) into tenant_active;
    capabilities := public.resolve_tenant_operational_capabilities(i.tenant_id);
    operational_mode_ready := case
      when i.trigger_source = 'manual_verified' then
        coalesce(capabilities->>'operationalMode','') in ('internal','live')
      else coalesce(capabilities->>'operationalMode','') = 'live'
    end;
    operational_capability_ready := case
      when i.trigger_source = 'manual_verified' then
        coalesce((capabilities->>'manualDteEnqueue')::boolean,false)
      else
        coalesce((capabilities->>'enqueueDte')::boolean,false)
        and coalesce((capabilities->>'runDteWorker')::boolean,false)
    end;

    if i.payment_intent_id is not null and trigger_source_ready then
      select exists(
        select 1
          from public.payment_intents payment
         where payment.id = i.payment_intent_id
           and payment.tenant_id = i.tenant_id
           and payment.appointment_id = i.appointment_id
           and payment.status = 'succeeded'
           and (
             (i.trigger_source = 'manual_verified'
               and payment.provider = 'manual'
               and i.payment_key = 'manual_verified:' || payment.id::text)
             or
             (i.trigger_source <> 'manual_verified'
               and payment.provider = i.trigger_source
               and nullif(pg_catalog.btrim(payment.provider_payment_id),'') is not null
               and i.payment_key = payment.provider || ':' || payment.provider_payment_id)
           )
      ) into payment_exact;
      select payment_exact and exists(
        select 1
          from public.billing_sale_payments verified
         where verified.tenant_id = i.tenant_id
           and verified.appointment_id = i.appointment_id
           and verified.payment_intent_id = i.payment_intent_id
           and verified.status = 'VERIFIED'
           and verified.validation_result = 'provider_verified'
           and verified.reconciliation_status = 'NOT_REQUIRED'
           and verified.provider = case
             when i.trigger_source = 'manual_verified' then 'manual'
             else i.trigger_source
           end
           and (
             i.trigger_source <> 'manual_verified'
             or (i.created_by is not null and verified.verified_by = i.created_by)
           )
      ) into payment_verified;
    end if;

    legal_report := coalesce(
      public.tenant_legal_gate_report(i.tenant_id),
      '{"ready":false}'::jsonb
    );
    legal_ready := legal_report->'ready' = 'true'::jsonb;
    dte_authority_ready :=
      legal_report->'dteAuthorityReady' = 'true'::jsonb;
    technical_report := coalesce(
      public.dte_activation_gate_report(
        i.tenant_id,
        i.resolved_dte_type,
        true
      ),
      '{"ready":false,"tenantConfigured":false}'::jsonb
    );

    select exists(
      select 1 from public.dte_tenant_issuance_settings cfg
       where cfg.tenant_id = i.tenant_id
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
    ) and exists(
      select 1 from public.dte_production_tenant_settings production
       where production.tenant_id = i.tenant_id
         and production.enabled = true
         and production.issuance_mode = 'automatic'
         and production.sii_authorization_status = 'approved'
         and i.resolved_dte_type = any(production.authorized_types)
    ) into production_settings_ready;

    select exists(
      select 1
        from public.dte_tenant_operational_readiness(i.tenant_id) readiness
       where readiness.ready_for_issuance = true
    ) into operational_readiness_ready;

    select exists(
      select 1 from public.dte_legal_activation activation
       where activation.tenant_id = i.tenant_id
         and activation.dte_type = i.resolved_dte_type
         and activation.status = 'active'
    ) into activation_ready;

    commercial_snapshot_ready := i.resolved_dte_type <> 39 or exists(
      select 1 from public.dte_boleta39_commercial_customer_snapshots snapshot
       where snapshot.tenant_id = i.tenant_id
         and snapshot.intent_id = i.id
         and snapshot.customer_id = i.customer_id
         and nullif(pg_catalog.btrim(snapshot.customer_name),'') is not null
    );

    select exists(
      select 1 from public.dte_production_folio_ledger ledger
       where ledger.tenant_id = i.tenant_id
         and ledger.dte_type = i.resolved_dte_type
         and ledger.state in ('available','AVAILABLE')
    ) into fresh_folio_available;

    owned_folio_reusable := i.production_document_id is not null and exists(
      select 1
        from public.dte_production_documents document
        join public.dte_production_folio_ledger ledger
          on ledger.tenant_id = document.tenant_id
         and ledger.dte_type = document.dte_type
         and ledger.document_id = document.id
         and ledger.business_operation_id = document.business_operation_id
       where document.id = i.production_document_id
         and document.tenant_id = i.tenant_id
         and document.dte_type = i.resolved_dte_type
         and document.business_operation_id = 'intent:' || i.id::text
         and (
           (ledger.state = 'reserved' and document.status in ('draft','prepared','ready'))
           or (ledger.state = 'issued' and document.status = 'submitting')
         )
         and (document.folio is null or document.folio = ledger.folio)
         and (document.caf_id is null or document.caf_id = ledger.caf_id)
         and (
           select pg_catalog.count(*)
             from public.dte_production_folio_ledger possible
            where possible.document_id = document.id
               or (
                 possible.tenant_id = document.tenant_id
                 and possible.business_operation_id = document.business_operation_id
               )
         ) = 1
    );
    folio_ready := fresh_folio_available or owned_folio_reusable;

    technical_ready := technical_report->'ready' = 'true'::jsonb
      or (
        owned_folio_reusable
        and pg_catalog.jsonb_typeof(technical_report) = 'object'
        and technical_report ?& array[
          'issuerDataExact',
          'issuerLegalNameMatch',
          'issuerResolutionConfigured',
          'typeAuthorized',
          'certificateCurrent',
          'certificateKeyMatch',
          'certificateRutMatch',
          'officialTrustAnchor',
          'authenticTypeCaf',
          'foliosAvailable',
          'tenantAwareLedger',
          'privateStorage',
          'productionEndpoints',
          'officialXsd',
          'xmlDsig',
          'workerConfigured',
          'migrationsApplied',
          'offlinePreflightComplete',
          'documentEngineReady',
          'globalFeatureEnabled',
          'ready'
        ]::text[]
        and technical_report->'foliosAvailable' = 'false'::jsonb
        and not exists(
          select 1 from pg_catalog.jsonb_each(technical_report) gate
           where gate.key not in ('ready','foliosAvailable')
             and gate.value is distinct from 'true'::jsonb
        )
      );

    if i.production_document_id is not null then
      select pg_catalog.count(*),
             pg_catalog.count(*) filter (where attempt.before_fetch_at is not null)
        into attempt_count,before_fetch_count
        from public.dte_production_submission_attempts attempt
       where attempt.tenant_id = i.tenant_id
         and attempt.document_id = i.production_document_id;
    end if;
    network_safe := outbox_exact and (
      (
        o.network_attempts = 0
        and i.network_attempt_count = 0
        and before_fetch_count = 0
      )
      or (
        o.status = 'PROCESSING'
        and i.status = 'SUBMITTING'
        and o.network_attempts = 1
        and i.network_attempt_count = 1
        and attempt_count = 1
        and before_fetch_count = 1
      )
    );
  end if;

  ready_value := intent_exact and outbox_exact and payment_exact
    and payment_verified and automatic_origin and trigger_source_ready
    and dte_type_ready and tenant_active and operational_mode_ready
    and operational_capability_ready and legal_ready and dte_authority_ready
    and technical_ready and (operational_readiness_ready or owned_folio_reusable)
    and production_settings_ready and activation_ready
    and commercial_snapshot_ready and folio_ready and network_safe;

  if not intent_exact then blocking_reasons := pg_catalog.array_append(blocking_reasons,'intent_not_exact'); end if;
  if not outbox_exact then blocking_reasons := pg_catalog.array_append(blocking_reasons,'outbox_not_exact'); end if;
  if not payment_exact then blocking_reasons := pg_catalog.array_append(blocking_reasons,'payment_not_exact'); end if;
  if not payment_verified then blocking_reasons := pg_catalog.array_append(blocking_reasons,'payment_not_verified'); end if;
  if not automatic_origin then blocking_reasons := pg_catalog.array_append(blocking_reasons,'automatic_origin_invalid'); end if;
  if not trigger_source_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'trigger_source_not_ready'); end if;
  if not dte_type_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'dte_type_not_ready'); end if;
  if not tenant_active then blocking_reasons := pg_catalog.array_append(blocking_reasons,'tenant_not_active'); end if;
  if not operational_mode_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'operational_mode_not_ready'); end if;
  if not operational_capability_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'operational_capability_not_ready'); end if;
  if not legal_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'legal_ready_false'); end if;
  if not dte_authority_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'dte_authority_ready_false'); end if;
  if not technical_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'technical_ready_false'); end if;
  if not operational_readiness_ready and not owned_folio_reusable then blocking_reasons := pg_catalog.array_append(blocking_reasons,'operational_readiness_false'); end if;
  if not production_settings_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'production_settings_not_ready'); end if;
  if not activation_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'activation_not_ready'); end if;
  if not commercial_snapshot_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'commercial_snapshot_not_ready'); end if;
  if not folio_ready then blocking_reasons := pg_catalog.array_append(blocking_reasons,'folio_not_ready'); end if;
  if not network_safe then blocking_reasons := pg_catalog.array_append(blocking_reasons,'network_not_safe'); end if;

  return pg_catalog.jsonb_build_object(
    'intentExact',intent_exact,
    'outboxExact',outbox_exact,
    'paymentExact',payment_exact,
    'paymentVerified',payment_verified,
    'automaticOrigin',automatic_origin,
    'triggerSourceReady',trigger_source_ready,
    'dteTypeReady',dte_type_ready,
    'tenantActive',tenant_active,
    'operationalModeReady',operational_mode_ready,
    'operationalCapabilityReady',operational_capability_ready,
    'legalReady',legal_ready,
    'dteAuthorityReady',dte_authority_ready,
    'technicalReady',technical_ready,
    'operationalReadinessReady',operational_readiness_ready,
    'productionSettingsReady',production_settings_ready,
    'activationReady',activation_ready,
    'commercialSnapshotReady',commercial_snapshot_ready,
    'freshFolioAvailable',fresh_folio_available,
    'ownedFolioReusable',owned_folio_reusable,
    'folioReady',folio_ready,
    'networkSafe',network_safe,
    'blockingReasons',pg_catalog.to_jsonb(blocking_reasons),
    'legalReport',legal_report,
    'technicalReport',technical_report,
    'ready',ready_value
  );
end;
$$;

create or replace function public.dte_automatic_issuance_gate_open(
  p_tenant_id uuid,
  p_intent_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      public.dte_automatic_issuance_gate_report(p_tenant_id,p_intent_id)
      ->>'ready'
    )::boolean,
    false
  );
$$;

revoke all on function public.dte_automatic_issuance_gate_report(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.dte_automatic_issuance_gate_report(uuid,uuid)
  to service_role;
revoke all on function public.dte_automatic_issuance_gate_open(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Preserve the mature snapshot/idempotency implementation behind an internal
-- name. The public wrapper adds the continuous legal decision after the exact
-- intent/outbox pair exists, in the same enqueue transaction.
alter function public.dte_enqueue_payment_snapshot(
  uuid,uuid,uuid,text,text,uuid
) rename to dte_enqueue_payment_snapshot_cit61_base;

revoke all on function public.dte_enqueue_payment_snapshot_cit61_base(
  uuid,uuid,uuid,text,text,uuid
) from public,anon,authenticated,service_role;

create or replace function public.dte_enqueue_payment_snapshot(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_payment_intent_id uuid,
  p_payment_key text,
  p_trigger_source text,
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_id uuid;
  intent_row public.dte_payment_document_intents%rowtype;
  outbox_row public.dte_issuance_outbox%rowtype;
  gate_report jsonb;
begin
  intent_id := public.dte_enqueue_payment_snapshot_cit61_base(
    p_tenant_id,
    p_appointment_id,
    p_payment_intent_id,
    p_payment_key,
    p_trigger_source,
    p_actor_id
  );

  if p_trigger_source not in (
    'khipu','webpay','mercadopago','manual_verified'
  ) then
    return intent_id;
  end if;

  select * into intent_row
    from public.dte_payment_document_intents intent
   where intent.tenant_id = p_tenant_id
     and intent.id = intent_id
   for update;
  if not found or intent_row.origin <> 'automatic_payment' then
    raise exception 'DTE_AUTOMATIC_ENQUEUE_RELATION_INVALID';
  end if;

  select * into outbox_row
    from public.dte_issuance_outbox outbox
   where outbox.tenant_id = intent_row.tenant_id
     and outbox.intent_id = intent_row.id
     and outbox.issuance_origin = 'automatic_system'
   for update;
  if not found then
    raise exception 'DTE_AUTOMATIC_ENQUEUE_OUTBOX_MISSING';
  end if;

  gate_report := public.dte_automatic_issuance_gate_report(
    intent_row.tenant_id,
    intent_row.id
  );
  if (
    gate_report->'legalReady' is distinct from 'true'::jsonb
    or gate_report->'dteAuthorityReady' is distinct from 'true'::jsonb
  ) and intent_row.network_attempt_count = 0
    and outbox_row.network_attempts = 0
    and intent_row.production_document_id is null
    and intent_row.status in ('PENDING','BLOCKED')
    and outbox_row.status in ('PENDING','BLOCKED')
    and coalesce(intent_row.safe_blocking_reason,'') not in (
      'NETWORK_RESULT_UNKNOWN',
      'POSSIBLE_DUPLICATE_DOCUMENT_REVIEW_REQUIRED'
    ) then
    update public.dte_payment_document_intents intent
       set status = 'BLOCKED',
           safe_blocking_reason = 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
           updated_at = pg_catalog.now()
     where intent.tenant_id = intent_row.tenant_id
       and intent.id = intent_row.id;
    update public.dte_issuance_outbox outbox
       set status = 'BLOCKED',
           last_safe_error = 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
           locked_at = null,
           locked_by = null,
           claim_token = null,
           lease_expires_at = null,
           updated_at = pg_catalog.now()
     where outbox.tenant_id = outbox_row.tenant_id
       and outbox.id = outbox_row.id;
    insert into public.dte_document_events(
      tenant_id,intent_id,event_type,actor_id,safe_metadata
    ) select
      intent_row.tenant_id,
      intent_row.id,
      'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
      p_actor_id,
      pg_catalog.jsonb_build_object(
        'automaticRetry',false,
        'networkBoundaryCrossed',false,
        'blockingReasons',gate_report->'blockingReasons'
      )
    where not exists(
      select 1 from public.dte_document_events existing
       where existing.tenant_id = intent_row.tenant_id
         and existing.intent_id = intent_row.id
         and existing.event_type = 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
    );
  end if;
  return intent_id;
end;
$$;

revoke all on function public.dte_enqueue_payment_snapshot(
  uuid,uuid,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.dte_enqueue_payment_snapshot(
  uuid,uuid,uuid,text,text,uuid
) to service_role;

-- The automatic relation is recognizable only through the immutable
-- business-operation identity and the exact persisted intent/outbox pair.
-- Manual/certification callers continue through the historical implementation.
alter function public.reserve_dte_production_folio(
  uuid,integer,uuid,text
) rename to reserve_dte_production_folio_cit61_base;

revoke all on function public.reserve_dte_production_folio_cit61_base(
  uuid,integer,uuid,text
) from public,anon,authenticated,service_role;

create or replace function public.reserve_dte_production_folio(
  p_tenant_id uuid,
  p_dte_type integer,
  p_document_id uuid,
  p_business_operation_id text
) returns table(folio integer,caf_id uuid,reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_id uuid;
  identified_intent public.dte_payment_document_intents%rowtype;
  matching_outboxes bigint := 0;
  gate_report jsonb;
begin
  if p_business_operation_id ~ '^intent:[0-9a-f-]{36}$' then
    begin
      intent_id := pg_catalog.substr(p_business_operation_id,8)::uuid;
    exception when others then
      raise exception 'DTE_AUTOMATIC_FOLIO_RELATION_INVALID';
    end;

    select intent.* into identified_intent
      from public.dte_payment_document_intents intent
     where intent.id = intent_id;

    if found and identified_intent.origin = 'automatic_payment' then
      select pg_catalog.count(*) into matching_outboxes
        from public.dte_issuance_outbox outbox
       where outbox.tenant_id = identified_intent.tenant_id
         and outbox.intent_id = identified_intent.id
         and outbox.issuance_origin = 'automatic_system';
      if identified_intent.tenant_id is distinct from p_tenant_id
         or identified_intent.production_document_id is distinct from p_document_id
         or identified_intent.resolved_dte_type is distinct from p_dte_type
         or matching_outboxes <> 1 then
        raise exception using
          errcode = 'P6103',
          message = 'DTE_AUTOMATIC_FOLIO_RELATION_INVALID';
      end if;
      gate_report := public.dte_automatic_issuance_gate_report(
        p_tenant_id,intent_id
      );
      if gate_report->'legalReady' is distinct from 'true'::jsonb
         or gate_report->'dteAuthorityReady' is distinct from 'true'::jsonb then
        raise exception using
          errcode = 'P6101',
          message = 'DTE_AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK';
      end if;
      if gate_report->'ready' is distinct from 'true'::jsonb then
        raise exception using
          errcode = 'P6102',
          message = 'DTE_AUTOMATIC_GATE_CLOSED_PRE_NETWORK';
      end if;
    end if;
  end if;

  return query select *
    from public.reserve_dte_production_folio_cit61_base(
      p_tenant_id,p_dte_type,p_document_id,p_business_operation_id
    );
end;
$$;

revoke all on function public.reserve_dte_production_folio(
  uuid,integer,uuid,text
) from public,anon,authenticated;
grant execute on function public.reserve_dte_production_folio(
  uuid,integer,uuid,text
) to service_role;

-- Keep the existing fenced state machine intact behind an internal entrypoint.
-- The wrapper translates a legal/authority failure into its canonical reason
-- without duplicating claim or lease semantics.
alter function public.dte_mutate_automatic_issuance_claim(
  uuid,text,uuid,text,uuid,text,text,integer,text,jsonb,uuid,text
) rename to dte_mutate_automatic_issuance_claim_cit61_base;

revoke all on function public.dte_mutate_automatic_issuance_claim_cit61_base(
  uuid,text,uuid,text,uuid,text,text,integer,text,jsonb,uuid,text
) from public,anon,authenticated,service_role;

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
  target_tenant_id uuid;
  target_intent_id uuid;
  gate_report jsonb;
  result boolean;
begin
  select outbox.tenant_id,outbox.intent_id
    into target_tenant_id,target_intent_id
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id;
  if found and p_action in (
    'RENEW','PREPARING','READY','SUBMITTING','NETWORK_BOUNDARY'
  ) then
    gate_report := public.dte_automatic_issuance_gate_report(
      target_tenant_id,target_intent_id
    );
  end if;

  result := public.dte_mutate_automatic_issuance_claim_cit61_base(
    p_outbox_id,p_worker_id,p_claim_token,p_action,
    p_production_document_id,p_final_status,p_safe_reason,
    p_deterministic_attempts,p_event_type,p_safe_metadata,
    p_submission_attempt_id,p_network_milestone
  );

  if result = false
     and p_action in ('RENEW','PREPARING','READY','SUBMITTING','NETWORK_BOUNDARY')
     and (
       gate_report->'legalReady' is distinct from 'true'::jsonb
       or gate_report->'dteAuthorityReady' is distinct from 'true'::jsonb
     ) then
    update public.dte_payment_document_intents intent
       set safe_blocking_reason = 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
           production_document_id = case
             when intent.production_document_id is null
               and p_production_document_id is not null
               and exists(
                 select 1 from public.dte_production_documents document
                  where document.tenant_id = intent.tenant_id
                    and document.id = p_production_document_id
                    and document.dte_type = intent.resolved_dte_type
                    and document.business_operation_id =
                      'intent:' || intent.id::text
                    and document.status in ('draft','prepared','ready')
               )
             then p_production_document_id
             else intent.production_document_id
           end,
           updated_at = pg_catalog.now()
     where intent.tenant_id = target_tenant_id
       and intent.id = target_intent_id
       and intent.status = 'BLOCKED'
       and intent.network_attempt_count = 0
       and intent.safe_blocking_reason = 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK';
    update public.dte_issuance_outbox outbox
       set last_safe_error = 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
           updated_at = pg_catalog.now()
     where outbox.id = p_outbox_id
       and outbox.tenant_id = target_tenant_id
       and outbox.status = 'BLOCKED'
       and outbox.network_attempts = 0
       and outbox.last_safe_error = 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK';
    if found then
      insert into public.dte_document_events(
        tenant_id,intent_id,production_document_id,event_type,safe_metadata
      ) values(
        target_tenant_id,target_intent_id,p_production_document_id,
        'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK',
        pg_catalog.jsonb_build_object(
          'automaticRetry',false,
          'networkBoundaryCrossed',false,
          'blockingReasons',gate_report->'blockingReasons'
        )
      );
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.dte_mutate_automatic_issuance_claim(
  uuid,text,uuid,text,uuid,text,text,integer,text,jsonb,uuid,text
) from public,anon,authenticated;
grant execute on function public.dte_mutate_automatic_issuance_claim(
  uuid,text,uuid,text,uuid,text,text,integer,text,jsonb,uuid,text
) to service_role;

-- Automatic-only irreversible boundary. It persists the unique submission
-- attempt and issued folio before returning the attempt id to the caller. A
-- null result means the claim was fenced and no fetch may start.
create or replace function public.dte_begin_automatic_network_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_production_document_id uuid,
  p_request_sha256 text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_row public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  document_row public.dte_production_documents%rowtype;
  ledger_row public.dte_production_folio_ledger%rowtype;
  gate_report jsonb;
  attempt_id uuid;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$'
     or p_claim_token is null
     or p_production_document_id is null
     or p_request_sha256 !~ '^[a-f0-9]{64}$' then
    return null;
  end if;

  select * into outbox_row
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id
   for update;
  if not found
     or outbox_row.status <> 'PROCESSING'
     or outbox_row.issuance_origin <> 'automatic_system'
     or outbox_row.locked_by is distinct from p_worker_id
     or outbox_row.claim_token is distinct from p_claim_token
     or outbox_row.lease_expires_at is null
     or outbox_row.lease_expires_at <= pg_catalog.clock_timestamp()
     or outbox_row.network_attempts <> 0 then
    return null;
  end if;

  select * into intent_row
    from public.dte_payment_document_intents intent
   where intent.tenant_id = outbox_row.tenant_id
     and intent.id = outbox_row.intent_id
   for update;
  if not found
     or intent_row.status <> 'SUBMITTING'
     or intent_row.origin <> 'automatic_payment'
     or intent_row.trigger_source not in (
       'khipu','webpay','mercadopago','manual_verified'
     )
     or intent_row.resolved_dte_type not in (33,39)
     or intent_row.production_document_id is distinct from p_production_document_id
     or intent_row.network_attempt_count <> 0 then
    return null;
  end if;

  select * into document_row
    from public.dte_production_documents document
   where document.tenant_id = intent_row.tenant_id
     and document.id = p_production_document_id
   for update;
  if not found
     or document_row.status <> 'ready'
     or document_row.dte_type <> intent_row.resolved_dte_type
     or document_row.business_operation_id <> 'intent:' || intent_row.id::text
     or document_row.folio is null
     or document_row.caf_id is null then
    return null;
  end if;

  select * into ledger_row
    from public.dte_production_folio_ledger ledger
   where ledger.tenant_id = document_row.tenant_id
     and ledger.dte_type = document_row.dte_type
     and ledger.folio = document_row.folio
     and ledger.caf_id = document_row.caf_id
     and ledger.document_id = document_row.id
     and ledger.business_operation_id = document_row.business_operation_id
     and ledger.state = 'reserved'
   for update;
  if not found then return null; end if;

  if exists(
    select 1 from public.dte_production_submission_attempts attempt
     where attempt.tenant_id = intent_row.tenant_id
       and attempt.document_id = document_row.id
  ) then return null; end if;

  gate_report := public.dte_automatic_issuance_gate_report(
    intent_row.tenant_id,intent_row.id
  );
  if gate_report->'ready' is distinct from 'true'::jsonb then
    update public.dte_payment_document_intents intent
       set status = 'BLOCKED',
           safe_blocking_reason = case
            when gate_report->'legalReady' is distinct from 'true'::jsonb
              or gate_report->'dteAuthorityReady' is distinct from 'true'::jsonb
             then 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
             else 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
           end,
           updated_at = pg_catalog.now()
     where intent.tenant_id = intent_row.tenant_id
       and intent.id = intent_row.id
       and intent.status = 'SUBMITTING';
    update public.dte_issuance_outbox outbox
       set status = 'BLOCKED',
           last_safe_error = case
            when gate_report->'legalReady' is distinct from 'true'::jsonb
              or gate_report->'dteAuthorityReady' is distinct from 'true'::jsonb
             then 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
             else 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
           end,
           locked_at = null,locked_by = null,claim_token = null,
           lease_expires_at = null,updated_at = pg_catalog.now()
     where outbox.id = outbox_row.id
       and outbox.tenant_id = outbox_row.tenant_id
       and outbox.status = 'PROCESSING';
    insert into public.dte_document_events(
      tenant_id,intent_id,production_document_id,event_type,safe_metadata
    ) values(
      intent_row.tenant_id,intent_row.id,document_row.id,
      case
        when gate_report->'legalReady' is distinct from 'true'::jsonb
          or gate_report->'dteAuthorityReady' is distinct from 'true'::jsonb
        then 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
        else 'AUTOMATIC_GATE_CLOSED_PRE_NETWORK'
      end,
      pg_catalog.jsonb_build_object(
        'automaticRetry',false,
        'networkBoundaryCrossed',false,
        'blockingReasons',gate_report->'blockingReasons'
      )
    );
    return null;
  end if;

  insert into public.dte_production_submission_attempts(
    tenant_id,document_id,attempt_number,status,request_sha256,before_fetch_at
  ) values(
    intent_row.tenant_id,document_row.id,1,'uploading',
    p_request_sha256,pg_catalog.now()
  ) returning id into attempt_id;

  update public.dte_production_documents document
     set status = 'submitting',updated_at = pg_catalog.now()
   where document.tenant_id = document_row.tenant_id
     and document.id = document_row.id
     and document.status = 'ready';
  if not found then raise exception 'DTE_DOCUMENT_STATE_CONFLICT'; end if;

  update public.dte_production_folio_ledger ledger
     set state = 'issued',issued_at = pg_catalog.now(),updated_at = pg_catalog.now()
   where ledger.tenant_id = ledger_row.tenant_id
     and ledger.dte_type = ledger_row.dte_type
     and ledger.folio = ledger_row.folio
     and ledger.state = 'reserved';
  if not found then raise exception 'DTE_FOLIO_STATE_CONFLICT'; end if;

  update public.dte_payment_document_intents intent
     set network_attempt_count = 1,updated_at = pg_catalog.now()
   where intent.tenant_id = intent_row.tenant_id
     and intent.id = intent_row.id
     and intent.network_attempt_count = 0;
  update public.dte_issuance_outbox outbox
     set network_attempts = 1,
         lease_expires_at = pg_catalog.now() + interval '15 minutes',
         updated_at = pg_catalog.now()
   where outbox.tenant_id = outbox_row.tenant_id
     and outbox.id = outbox_row.id
     and outbox.network_attempts = 0;

  insert into public.dte_production_audit(
    tenant_id,document_id,action,metadata_safe
  ) values(
    intent_row.tenant_id,document_row.id,'submission_started_folio_issued',
    pg_catalog.jsonb_build_object('automatic',true,'networkBoundary','seed')
  );
  insert into public.dte_document_events(
    tenant_id,intent_id,production_document_id,event_type,safe_metadata
  ) values(
    intent_row.tenant_id,intent_row.id,document_row.id,
    'SEED_NETWORK_BOUNDARY',
    pg_catalog.jsonb_build_object(
      'automaticRetry',false,'networkBoundaryCrossed',true,
      'submissionAttemptId',attempt_id
    )
  );
  return attempt_id;
end;
$$;

revoke all on function public.dte_begin_automatic_network_attempt(
  uuid,text,uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.dte_begin_automatic_network_attempt(
  uuid,text,uuid,uuid,text
) to service_role;

create or replace function public.dte_retry_blocked_issuance(
  p_tenant_id uuid,
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_row public.dte_payment_document_intents%rowtype;
  outbox_row public.dte_issuance_outbox%rowtype;
  gate_report jsonb;
begin
  select * into intent_row
    from public.dte_payment_document_intents intent
   where intent.tenant_id = p_tenant_id
     and intent.id = p_intent_id
   for update;
  if not found then return false; end if;
  select * into outbox_row
    from public.dte_issuance_outbox outbox
   where outbox.tenant_id = intent_row.tenant_id
     and outbox.intent_id = intent_row.id
   for update;
  if not found
     or intent_row.status <> 'BLOCKED'
     or outbox_row.status <> 'BLOCKED'
     or intent_row.origin <> 'automatic_payment'
     or outbox_row.issuance_origin <> 'automatic_system'
     or intent_row.safe_blocking_reason is distinct from outbox_row.last_safe_error
     or coalesce(intent_row.safe_blocking_reason,'') not in (
       'AUTOMATIC_GATE_CLOSED_PRE_NETWORK',
       'WORKER_LEASE_EXPIRED',
       'WORKER_LEASE_EXPIRED_EXPLICIT_RETRY_REQUIRED',
       'DTE_AUTOMATIC_PREPARATION_FAILED'
     )
     or intent_row.network_attempt_count <> 0
     or outbox_row.network_attempts <> 0
     or intent_row.production_document_id is not null
     or intent_row.deterministic_retry_count >= 3
     or outbox_row.deterministic_attempts >= 3
     or outbox_row.locked_at is not null
     or outbox_row.locked_by is not null
     or outbox_row.claim_token is not null
     or outbox_row.lease_expires_at is not null then
    return false;
  end if;

  gate_report := public.dte_automatic_issuance_gate_report(
    intent_row.tenant_id,intent_row.id
  );
  if gate_report->'ready' is distinct from 'true'::jsonb then
    return false;
  end if;

  update public.dte_payment_document_intents intent
     set status = 'PENDING',safe_blocking_reason = null,
         updated_at = pg_catalog.now()
   where intent.tenant_id = intent_row.tenant_id
     and intent.id = intent_row.id
     and intent.status = 'BLOCKED';
  update public.dte_issuance_outbox outbox
     set status = 'PENDING',available_at = pg_catalog.now(),
         last_safe_error = null,updated_at = pg_catalog.now()
   where outbox.tenant_id = outbox_row.tenant_id
     and outbox.id = outbox_row.id
     and outbox.status = 'BLOCKED';
  if not found then raise exception 'DTE_RETRY_OUTBOX_STATE_INVALID'; end if;
  insert into public.dte_document_events(
    tenant_id,intent_id,event_type,safe_metadata
  ) values(
    intent_row.tenant_id,intent_row.id,'ISSUANCE_REQUEUED',
    pg_catalog.jsonb_build_object('automaticRetry',false,'exactTarget',true)
  );
  return true;
end;
$$;

revoke all on function public.dte_retry_blocked_issuance(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.dte_retry_blocked_issuance(uuid,uuid)
  to service_role;

create or replace function public.dte_claim_automatic_pre_network_resume_exact(
  p_worker_id text,
  p_outbox_id uuid
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.dte_issuance_outbox%rowtype;
  intent_row public.dte_payment_document_intents%rowtype;
  document_row public.dte_production_documents%rowtype;
  ledger_row public.dte_production_folio_ledger%rowtype;
  target_tenant_id uuid;
  relation_count bigint := 0;
  gate_report jsonb;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' or p_outbox_id is null then
    raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_INPUT_INVALID';
  end if;
  select outbox.tenant_id into target_tenant_id
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id;
  if not found then raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_tenant_id::text,0)
  );
  select * into claimed
    from public.dte_issuance_outbox outbox
   where outbox.id = p_outbox_id
     and outbox.tenant_id = target_tenant_id
   for update;
  if not found
     or claimed.status <> 'BLOCKED'
     or claimed.issuance_origin <> 'automatic_system'
     or claimed.last_safe_error <> 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
     or claimed.network_attempts <> 0
     or claimed.locked_at is not null
     or claimed.locked_by is not null
     or claimed.claim_token is not null
     or claimed.lease_expires_at is not null then
    raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE';
  end if;

  select * into intent_row
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
     or intent_row.safe_blocking_reason <> 'AUTOMATIC_LEGAL_GATE_CLOSED_PRE_NETWORK'
     or intent_row.network_attempt_count <> 0 then
    raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE';
  end if;

  if intent_row.production_document_id is null then
    if exists(
      select 1 from public.dte_production_documents document
       where document.tenant_id = intent_row.tenant_id
         and document.business_operation_id = 'intent:' || intent_row.id::text
    ) or exists(
      select 1 from public.dte_production_folio_ledger ledger
       where ledger.tenant_id = intent_row.tenant_id
         and ledger.business_operation_id = 'intent:' || intent_row.id::text
    ) then raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE'; end if;
  else
    select * into document_row
      from public.dte_production_documents document
     where document.tenant_id = intent_row.tenant_id
       and document.id = intent_row.production_document_id
     for update;
    if not found
       or document_row.dte_type <> intent_row.resolved_dte_type
       or document_row.business_operation_id <> 'intent:' || intent_row.id::text
       or document_row.status not in ('draft','prepared','ready') then
      raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE';
    end if;
    if exists(
      select 1 from public.dte_production_submission_attempts attempt
       where attempt.tenant_id = intent_row.tenant_id
         and attempt.document_id = document_row.id
    ) then raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE'; end if;

    select pg_catalog.count(*) into relation_count
      from public.dte_production_folio_ledger ledger
     where ledger.document_id = document_row.id
        or (
          ledger.tenant_id = document_row.tenant_id
          and ledger.business_operation_id = document_row.business_operation_id
        );
    if relation_count > 1 then
      raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE';
    end if;
    if relation_count = 0 then
      if document_row.status <> 'draft'
         or document_row.folio is not null
         or document_row.caf_id is not null
         or exists(
           select 1 from public.dte_production_artifacts artifact
            where artifact.tenant_id = document_row.tenant_id
              and artifact.document_id = document_row.id
         ) then raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE'; end if;
    else
      select * into ledger_row
        from public.dte_production_folio_ledger ledger
       where ledger.tenant_id = document_row.tenant_id
         and ledger.dte_type = document_row.dte_type
         and ledger.document_id = document_row.id
         and ledger.business_operation_id = document_row.business_operation_id
         and ledger.state = 'reserved'
       for update;
      if not found
         or (document_row.folio is not null and document_row.folio <> ledger_row.folio)
         or (document_row.caf_id is not null and document_row.caf_id <> ledger_row.caf_id)
         or (document_row.status in ('prepared','ready') and (
           document_row.folio is distinct from ledger_row.folio
           or document_row.caf_id is distinct from ledger_row.caf_id
         )) then raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE'; end if;
    end if;
  end if;

  gate_report := public.dte_automatic_issuance_gate_report(
    intent_row.tenant_id,intent_row.id
  );
  if gate_report->'ready' is distinct from 'true'::jsonb
     or exists(
       select 1 from public.dte_issuance_outbox active
        where active.tenant_id = intent_row.tenant_id
          and active.status = 'PROCESSING'
     ) then
    raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_NOT_ELIGIBLE';
  end if;

  update public.dte_payment_document_intents intent
     set status = 'PENDING',safe_blocking_reason = null,
         updated_at = pg_catalog.now()
   where intent.tenant_id = intent_row.tenant_id
     and intent.id = intent_row.id
     and intent.status = 'BLOCKED'
     and intent.network_attempt_count = 0;
  update public.dte_issuance_outbox outbox
     set status = 'PROCESSING',locked_at = pg_catalog.now(),
         locked_by = p_worker_id,claim_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = pg_catalog.now() + interval '15 minutes',
         last_safe_error = null,updated_at = pg_catalog.now()
   where outbox.tenant_id = claimed.tenant_id
     and outbox.id = claimed.id
     and outbox.status = 'BLOCKED'
     and outbox.network_attempts = 0
   returning outbox.* into claimed;
  if not found then raise exception 'DTE_AUTOMATIC_PRE_NETWORK_RESUME_CONFLICT'; end if;

  insert into public.dte_document_events(
    tenant_id,intent_id,production_document_id,event_type,safe_metadata
  ) values(
    intent_row.tenant_id,intent_row.id,intent_row.production_document_id,
    'AUTOMATIC_PRE_NETWORK_RESUME_CLAIMED',
    pg_catalog.jsonb_build_object(
      'automaticRetry',false,'exactTarget',true,
      'ownedFolioResume',relation_count = 1,
      'additionalFolioReserved',false,'networkBoundaryCrossed',false
    )
  );
  return next claimed;
end;
$$;

revoke all on function public.dte_claim_automatic_pre_network_resume_exact(
  text,uuid
) from public,anon,authenticated;
grant execute on function public.dte_claim_automatic_pre_network_resume_exact(
  text,uuid
) to service_role;

commit;
