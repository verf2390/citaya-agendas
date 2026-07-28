begin;

-- A current authorization record is not enough to render a legal DTE. The
-- resolution number, date and SII office are printed into production XML/PDF
-- and therefore must be explicit, plausible and present before activation.
create or replace function public.dte_activation_gate_report(
  p_tenant_id uuid,
  p_dte_type integer,
  p_global_feature_enabled boolean
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
      ) as type_authorized,
      exists (
        select 1 from public.dte_production_cafs c
         where c.tenant_id = p_tenant_id and c.dte_type = p_dte_type
           and c.active and c.trust_status = 'verified_official'
      ) as authentic_caf,
      exists (
        select 1 from public.dte_production_folio_ledger l
         where l.tenant_id = p_tenant_id and l.dte_type = p_dte_type
           and l.state = 'available'
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
        trim(coalesce(resolution_number, '')) ~ '^[1-9][0-9]{0,9}$' and
        length(trim(coalesce(sii_office, ''))) between 2 and 100,
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
      'documentEngineReady', p_dte_type in (33,56,61),
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
$$;

-- Existing activations created by the older, incomplete gate are paused
-- reversibly. CAF metadata and folio ledgers remain untouched.
insert into public.dte_legal_activation_events(
  tenant_id, dte_type, event_type, actor_id, safe_metadata
)
select
  a.tenant_id,
  a.dte_type,
  'LEGAL_ISSUANCE_PAUSED',
  a.activated_by,
  jsonb_build_object('reason', 'SII_RESOLUTION_INCOMPLETE')
from public.dte_legal_activation a
join public.dte_production_tenant_settings p on p.tenant_id = a.tenant_id
where a.status = 'active'
  and (
    p.resolution_date is null or p.resolution_date > current_date or
    trim(coalesce(p.resolution_number, '')) !~ '^[1-9][0-9]{0,9}$' or
    length(trim(coalesce(p.sii_office, ''))) not between 2 and 100
  );

update public.dte_legal_activation a
   set status = 'paused',
       paused_by = a.activated_by,
       paused_at = now(),
       pause_reason = 'Pausa de seguridad: resolución SII productiva incompleta',
       updated_at = now()
  from public.dte_production_tenant_settings p
 where p.tenant_id = a.tenant_id
   and a.status = 'active'
   and (
     p.resolution_date is null or p.resolution_date > current_date or
     trim(coalesce(p.resolution_number, '')) !~ '^[1-9][0-9]{0,9}$' or
     length(trim(coalesce(p.sii_office, ''))) not between 2 and 100
   );

update public.dte_production_tenant_settings p
   set enabled = false, updated_at = now()
 where p.resolution_date is null or p.resolution_date > current_date or
       trim(coalesce(p.resolution_number, '')) !~ '^[1-9][0-9]{0,9}$' or
       length(trim(coalesce(p.sii_office, ''))) not between 2 and 100;

update public.dte_tenant_issuance_settings i
   set production_enabled = false,
       issuance_mode = 'manual',
       safe_blocking_reason = 'SII_RESOLUTION_INCOMPLETE',
       updated_at = now()
  from public.dte_production_tenant_settings p
 where p.tenant_id = i.tenant_id
   and (
     p.resolution_date is null or p.resolution_date > current_date or
     trim(coalesce(p.resolution_number, '')) !~ '^[1-9][0-9]{0,9}$' or
     length(trim(coalesce(p.sii_office, ''))) not between 2 and 100
   );

comment on function public.dte_activation_gate_report(uuid, integer, boolean) is
  'Fail-closed legal issuance gate. Requires explicit valid SII resolution metadata in addition to authorization, CAF, folios, certificate and runtime evidence.';

commit;
