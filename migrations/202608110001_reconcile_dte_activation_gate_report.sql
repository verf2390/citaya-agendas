begin;

create or replace function public.dte_activation_gate_report(
  p_tenant_id uuid,
  p_dte_type integer,
  p_global_feature_enabled boolean
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  with facts as (
    select
      p.tenant_id,
      p.issuer_rut,
      p.issuer_legal_name,
      p.resolution_date,
      p.resolution_number,
      p.sii_office,
      b.legal_name as billing_legal_name,
      p.certificate_valid_from,
      p.certificate_valid_to,
      e.*,
      coalesce(i.certificate_ready, false) as certificate_ready,
      coalesce(i.storage_ready, false) as storage_ready,
      coalesce(i.worker_ready, false) as worker_ready,
      exists (
        select 1 from public.dte_sii_authorization_evidence a
         where a.tenant_id = p_tenant_id and a.status = 'current'
           and p_dte_type = any(a.authorized_types)
           and a.issuer_rut = public.normalize_chilean_rut(p.issuer_rut)
      ) or (p_dte_type = any(p.authorized_types)) as type_authorized,
      exists (
        select 1 from public.dte_production_cafs c
         where c.tenant_id = p_tenant_id and c.dte_type = p_dte_type
           and c.active and c.trust_status = 'verified_official'
      ) as authentic_caf,
      exists (
        select 1 from public.dte_production_folio_ledger l
         where l.tenant_id = p_tenant_id and l.dte_type = p_dte_type
           and l.state in ('available', 'AVAILABLE')
      ) as folios_available,
      exists (
        select 1 from storage.buckets s
         where s.id = 'dte-production-private' and s.public = false
      ) as private_storage
    from public.dte_production_tenant_settings p
    left join public.tenant_billing_settings b on b.tenant_id = p.tenant_id
    left join public.dte_tenant_issuance_settings i on i.tenant_id = p.tenant_id
    left join public.dte_tenant_readiness_evidence e on e.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id
  ), gates as (
    select jsonb_build_object(
      'issuerDataExact', issuer_profile_complete,
      'issuerLegalNameMatch',
        issuer_legal_name_match and trim(issuer_legal_name) = trim(billing_legal_name),
      'issuerResolutionConfigured',
        resolution_date is not null and resolution_date <= current_date and
        trim(coalesce(resolution_number, '')) ~ '^[1-9][0-9]{0,9}$',
      'typeAuthorized', type_authorized,
      'certificateCurrent',
        certificate_ready and certificate_valid and
        certificate_valid_from <= now() and certificate_valid_to > now(),
      'certificateKeyMatch', private_key_matches_certificate,
      'certificateRutMatch', certificate_rut_match,
      'officialTrustAnchor',
        trust_anchor_valid and trust_anchor_sha256 is not null,
      'authenticTypeCaf', authentic_caf,
      'foliosAvailable', folios_available,
      'tenantAwareLedger', ledger_ready and tenant_isolation_valid,
      'privateStorage', storage_ready and private_storage,
      'productionEndpoints', production_endpoints_valid,
      'officialXsd', official_xsd_valid,
      'xmlDsig', xmldsig_valid,
      'workerConfigured', worker_ready and worker_tenant_aware,
      'migrationsApplied', migrations_applied,
      'offlinePreflightComplete', offline_preflight_complete,
      'documentEngineReady', p_dte_type in (33,34,39,41,52,56,61),
      'globalFeatureEnabled', p_global_feature_enabled
    ) as value from facts
  )
  select coalesce(
    value || jsonb_build_object(
      'ready', not exists (
        select 1 from jsonb_each(value) entry where entry.value <> 'true'::jsonb
      )
    ),
    jsonb_build_object('ready', false, 'tenantConfigured', false)
  )
  from gates;
$function$;

commit;