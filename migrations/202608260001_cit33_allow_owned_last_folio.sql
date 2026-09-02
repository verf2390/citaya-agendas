begin;

-- Keep the initial automatic claim fail-closed on an available folio, but do
-- not strand a later pre-network mutation after this intent has consumed the
-- last folio itself. Every non-folio activation gate remains mandatory.
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
      cross join lateral (
        select public.dte_activation_gate_report(
          i.tenant_id,
          i.resolved_dte_type,
          true
        ) as value
      ) activation_report
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
       and (
         activation_report.value -> 'ready' = 'true'::jsonb
         or (
           i.production_document_id is not null
           and pg_catalog.jsonb_typeof(activation_report.value) = 'object'
           and activation_report.value -> 'ready' = 'false'::jsonb
           and activation_report.value -> 'foliosAvailable' = 'false'::jsonb
           and activation_report.value ?& array[
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
           and not exists (
             select 1
               from pg_catalog.jsonb_each(
                 case
                   when pg_catalog.jsonb_typeof(activation_report.value) = 'object'
                     then activation_report.value
                   else '{}'::jsonb
                 end
               ) report_gate
              where report_gate.key not in ('ready','foliosAvailable')
                and report_gate.value is distinct from 'true'::jsonb
           )
           and exists (
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
                and document.dte_type in (33,39)
                and nullif(pg_catalog.btrim(document.business_operation_id), '') is not null
                and nullif(pg_catalog.btrim(ledger.business_operation_id), '') is not null
                and (
                  (
                    ledger.state = 'reserved'
                    and (
                      (
                        document.status = 'draft'
                        and (document.folio is null or document.folio = ledger.folio)
                        and (document.caf_id is null or document.caf_id = ledger.caf_id)
                      )
                      or (
                        document.status in ('prepared','ready')
                        and document.folio = ledger.folio
                        and document.caf_id = ledger.caf_id
                      )
                    )
                  )
                  or (
                    ledger.state = 'issued'
                    and document.status = 'submitting'
                    and document.folio = ledger.folio
                    and document.caf_id = ledger.caf_id
                  )
                )
                and (
                  select pg_catalog.count(*)
                    from public.dte_production_folio_ledger possible_owner
                   where possible_owner.document_id = document.id
                      or (
                        possible_owner.tenant_id = document.tenant_id
                        and possible_owner.business_operation_id =
                          document.business_operation_id
                      )
                ) = 1
           )
         )
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

comment on function public.dte_automatic_issuance_gate_open(uuid, uuid) is
  'Fail-closed automatic 33/39 issuance gate. Initial claims require an available folio; later pre-network mutations may reuse the intent''s single, strictly matched reserved or issued folio only when every other activation-report gate remains true.';

commit;
