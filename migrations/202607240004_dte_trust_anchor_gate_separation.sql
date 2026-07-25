begin;

alter table public.dte_tenant_readiness_evidence
  add column if not exists trust_anchor_acquisition_ready boolean
    not null default false,
  add column if not exists caf_import_fail_closed boolean
    not null default false;

create or replace function public.dte_tenant_operational_readiness(
  p_tenant_id uuid
) returns table (
  ready_for_declaration boolean,
  ready_for_issuance boolean,
  production_caf_count bigint,
  available_folio_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with state as (
    select
      t.id as tenant_id,
      p.enabled as profile_enabled,
      p.issuer_profile_state,
      p.issuer_rut,
      p.certificate_valid_from,
      p.certificate_valid_to,
      i.issuance_mode,
      i.production_enabled as issuance_production_enabled,
      i.sii_authorization_status,
      i.certificate_ready,
      i.caf_ready,
      i.folio_ready,
      i.endpoints_ready,
      i.storage_ready,
      i.worker_ready,
      i.readiness_tests_green,
      e.*,
      exists (
        select 1 from storage.buckets b
        where b.id = 'dte-production-private' and b.public = false
      ) as bucket_is_private,
      (
        select count(*) from public.dte_production_cafs c
        where c.tenant_id = t.id and c.active
      ) as caf_count,
      (
        select count(*) from public.dte_production_folio_ledger l
        where l.tenant_id = t.id and l.state = 'available'
      ) as folio_count
    from public.tenants t
    left join public.dte_production_tenant_settings p on p.tenant_id = t.id
    left join public.dte_tenant_issuance_settings i on i.tenant_id = t.id
    left join public.dte_tenant_readiness_evidence e on e.tenant_id = t.id
    where t.id = p_tenant_id
  ), evaluated as (
    select *,
      coalesce((
        issuer_profile_state in (
          'pre_declaration', 'declared', 'ready_for_issuance'
        )
        and upper(regexp_replace(coalesce(issuer_rut, ''), '[^0-9K]', '', 'g'))
          ~ '^[0-9]{7,8}[0-9K]$'
        and issuer_profile_complete
        and secure_production_root_ready
        and certificate_valid
        and certificate_rut_match
        and private_key_matches_certificate
        and certificate_valid_from <= now()
        and certificate_valid_to > now()
        and private_bucket_ready
        and bucket_is_private
        and persistence_ready
        and ledger_ready
        and tenant_isolation_valid
        and worker_tenant_aware
        and idempotency_ready
        and caf_procedures_ready
        and production_caf_root_ready
        and trust_anchor_acquisition_ready
        and caf_import_fail_closed
      ), false) as declaration_foundation_ready
    from state
  )
  select
    (
      declaration_foundation_ready
      and profile_enabled = false
      and issuance_production_enabled = false
      and issuance_mode = 'manual'
    ) as ready_for_declaration,
    (
      declaration_foundation_ready
      and trust_anchor_valid
      and trust_anchor_sha256 is not null
      and issuer_profile_state in ('declared', 'ready_for_issuance')
      and sii_authorization_status = 'approved'
      and profile_enabled
      and issuance_production_enabled
      and issuance_mode = 'automatic_on_verified_payment'
      and certificate_ready
      and caf_ready
      and folio_ready
      and endpoints_ready
      and storage_ready
      and worker_ready
      and readiness_tests_green
      and caf_count > 0
      and folio_count > 0
    ) as ready_for_issuance,
    caf_count,
    folio_count
  from evaluated;
$$;

revoke all on function public.dte_tenant_operational_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.dte_tenant_operational_readiness(uuid)
  to service_role;

update public.dte_tenant_readiness_evidence e
   set trust_anchor_acquisition_ready = true,
       caf_import_fail_closed = true,
       safe_blocking_reason =
         'ISSUANCE_TRUST_ANCHOR_AND_PRODUCTION_CAF_PENDING',
       checked_at = now()
  from public.dte_production_tenant_settings p
 where p.tenant_id = e.tenant_id
   and upper(regexp_replace(p.issuer_rut, '[^0-9K]', '', 'g'))
       = '781956457';

update public.dte_tenant_issuance_settings i
   set issuance_mode = 'manual',
       production_enabled = false,
       caf_ready = false,
       folio_ready = false,
       safe_blocking_reason =
         'ISSUANCE_TRUST_ANCHOR_AND_PRODUCTION_CAF_PENDING',
       updated_at = now()
  from public.dte_production_tenant_settings p
 where p.tenant_id = i.tenant_id
   and upper(regexp_replace(p.issuer_rut, '[^0-9K]', '', 'g'))
       = '781956457';

comment on column
  public.dte_tenant_readiness_evidence.trust_anchor_acquisition_ready is
  'Procedure is implemented to acquire an official SII IDK key, pin its HTTPS sii.cl provenance and SHA-256, and verify CAF FRMA offline.';
comment on column
  public.dte_tenant_readiness_evidence.caf_import_fail_closed is
  'Production CAF import rejects missing/unknown anchors, unpinned hashes, non-official provenance, RSAPK confusion and invalid FRMA.';
comment on function public.dte_tenant_operational_readiness(uuid) is
  'Declaration requires the secure acquisition procedure and fail-closed CAF import. Issuance additionally requires the official pinned anchor, SII authorization, productive CAF and available folios.';

commit;
