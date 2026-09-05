begin;

-- CIT-60: a self-issued authority can only be granted while a tenant is
-- active and internal, but that immutable evidence may remain valid after an
-- explicit, successful promotion to live. Derived invalidation never creates
-- or revokes authority evidence.
create or replace function public.tenant_self_issuer_authority_report(
  p_tenant_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with latest_grant as (
    select event.*
    from public.tenant_self_issuer_authority_events event
    where event.tenant_id = p_tenant_id
      and event.event_type = 'granted'
    order by event.occurred_at desc
    limit 1
  ), tenant_state as (
    select tenant.lifecycle_status, tenant.operational_mode
    from public.tenants tenant
    where tenant.id = p_tenant_id
  ), facts as (
    select
      grant_event.id is not null as evidence_exists,
      exists(
        select 1
        from public.tenant_self_issuer_authority_events revocation
        where revocation.tenant_id = p_tenant_id
          and revocation.authority_id = grant_event.authority_id
          and revocation.event_type = 'revoked'
      ) as revoked,
      coalesce(tenant.lifecycle_status = 'active', false) as tenant_active,
      tenant.operational_mode,
      coalesce(
        tenant.lifecycle_status = 'active'
          and tenant.operational_mode = 'internal',
        false
      ) as internal_active,
      coalesce(
        tenant.lifecycle_status = 'active'
          and tenant.operational_mode in ('internal', 'live'),
        false
      ) as mode_eligible,
      exists(
        select 1
        from public.tenant_legal_profiles profile
        where profile.tenant_id = p_tenant_id
          and profile.tenant_is_service_provider
      ) as service_provider_profile,
      coalesce(
        exists(
          select 1
          from public.tenant_legal_profiles profile
          where profile.tenant_id = p_tenant_id
            and profile.tenant_is_service_provider
        ) and case tenant.operational_mode
          when 'internal' then true
          when 'live' then public.legal_identity_complete(p_tenant_id)
          else false
        end,
        false
      ) as legal_profile_valid,
      public.tenant_tax_identity_complete(p_tenant_id)
        as tax_identity_complete,
      coalesce(
        grant_event.issuer_rut_snapshot = (
          select case
            when public.is_valid_chilean_rut(production.issuer_rut)
              then public.normalize_chilean_rut(production.issuer_rut)
            else null
          end
          from public.dte_production_tenant_settings production
          where production.tenant_id = p_tenant_id
        ),
        false
      ) as rut_matches,
      coalesce(
        grant_event.tax_identity_fingerprint =
          public.tenant_tax_identity_fingerprint(p_tenant_id),
        false
      ) as identity_matches,
      coalesce(
        grant_event.actor_role_snapshot = 'super_admin',
        false
      ) as platform_admin_evidence,
      grant_event.authority_id,
      grant_event.occurred_at,
      grant_event.administrative_reference
    from latest_grant grant_event
    right join (select 1) singleton on true
    left join tenant_state tenant on true
  ), result as (
    select
      facts.*,
      facts.evidence_exists
        and not facts.revoked
        and facts.tenant_active
        and facts.mode_eligible
        and facts.service_provider_profile
        and facts.legal_profile_valid
        and facts.tax_identity_complete
        and facts.rut_matches
        and facts.identity_matches
        and facts.platform_admin_evidence as valid
    from facts
  )
  select pg_catalog.jsonb_build_object(
    'kind', 'self_issued',
    'status', case
      when not result.evidence_exists then 'none'
      when result.revoked then 'revoked'
      when result.valid then 'active'
      else 'invalidated'
    end,
    'valid', result.valid,
    'evidenceExists', result.evidence_exists,
    'revoked', result.revoked,
    'internalActive', result.internal_active,
    'tenantActive', result.tenant_active,
    'operationalMode', result.operational_mode,
    'modeEligible', result.mode_eligible,
    'serviceProviderProfile', result.service_provider_profile,
    'legalProfileValid', result.legal_profile_valid,
    'taxIdentityComplete', result.tax_identity_complete,
    'rutMatches', result.rut_matches,
    'identityMatches', result.identity_matches,
    'platformAdminEvidence', result.platform_admin_evidence,
    'authorityId', result.authority_id,
    'recordedAt', result.occurred_at,
    'administrativeReference', result.administrative_reference
  )
  from result;
$$;

revoke all on function public.tenant_self_issuer_authority_report(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_self_issuer_authority_report(uuid)
  to service_role;

create or replace function public.set_tenant_operational_mode(
  p_tenant_id uuid,
  p_new_mode text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant_row public.tenants%rowtype;
  pre_readiness jsonb;
  post_readiness jsonb;
begin
  if not public.is_platform_admin(p_actor_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if p_new_mode not in ('unclassified', 'demo', 'live', 'internal') then
    raise exception 'OPERATIONAL_MODE_INVALID';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, '')))
      not between 10 and 500 then
    raise exception 'CLASSIFICATION_REASON_REQUIRED';
  end if;

  select tenant.*
    into tenant_row
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if not found then
    raise exception 'TENANT_NOT_FOUND';
  end if;
  if tenant_row.lifecycle_status = 'archived' then
    raise exception 'USE_OFFBOARDING_FOR_ARCHIVED_TENANT';
  end if;

  pre_readiness := public.tenant_live_readiness_report(p_tenant_id);
  if p_new_mode = 'live'
      and coalesce((pre_readiness ->> 'ready')::boolean, false)
        is not true then
    raise exception 'LIVE_TENANT_CHECKLIST_INCOMPLETE';
  end if;
  if tenant_row.operational_mode = p_new_mode then
    raise exception 'OPERATIONAL_MODE_UNCHANGED';
  end if;

  update public.tenants
  set operational_mode = p_new_mode,
      operational_mode_changed_at = pg_catalog.now(),
      operational_mode_changed_by = p_actor_id,
      operational_mode_change_reason = pg_catalog.btrim(p_reason)
  where id = p_tenant_id;

  post_readiness := public.tenant_live_readiness_report(p_tenant_id);
  if p_new_mode = 'live'
      and coalesce((post_readiness ->> 'ready')::boolean, false)
        is not true then
    raise exception 'LIVE_TENANT_CHECKLIST_INCOMPLETE';
  end if;

  insert into public.tenant_operational_mode_audit(
    tenant_id,
    previous_mode,
    new_mode,
    lifecycle_status,
    actor_user_id,
    reason,
    readiness_snapshot
  ) values (
    p_tenant_id,
    tenant_row.operational_mode,
    p_new_mode,
    tenant_row.lifecycle_status,
    p_actor_id,
    pg_catalog.btrim(p_reason),
    post_readiness || pg_catalog.jsonb_build_object(
      'preTransition', pre_readiness
    )
  );

  return pg_catalog.jsonb_build_object(
    'tenantId', p_tenant_id,
    'previousMode', tenant_row.operational_mode,
    'operationalMode', p_new_mode,
    'capabilities',
      public.resolve_tenant_operational_capabilities(p_tenant_id)
  );
end;
$$;

revoke all on function public.set_tenant_operational_mode(uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.set_tenant_operational_mode(uuid,text,uuid,text)
  to service_role;

comment on function public.tenant_self_issuer_authority_report(uuid) is
  'Derived self-issued authority validity. Grants remain internal-only but valid evidence may survive an explicit promotion to live while every legal and identity fact still matches.';
comment on function public.set_tenant_operational_mode(uuid,text,uuid,text) is
  'Explicit platform classification with pre- and post-transition live readiness checks; failed post-readiness rolls back mode and audit atomically.';

commit;
