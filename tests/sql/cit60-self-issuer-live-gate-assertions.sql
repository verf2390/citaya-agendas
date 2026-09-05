-- All identifiers and evidence are fictional. The surrounding test creates a
-- disposable PostgreSQL database and this transaction rolls back every row.
begin;

insert into public.platform_admins(user_id, role, is_active) values
  ('60000000-0000-4000-8000-000000000060', 'super_admin', true);

insert into public.tenants(id, slug, name, address, contact_email, operational_mode) values
  ('61000000-0000-4000-8000-000000000060', 'cit60-success', 'CIT60 Success Ficticio', 'Dirección ficticia 60', 'success@example.invalid', 'internal'),
  ('62000000-0000-4000-8000-000000000060', 'cit60-toctou', 'CIT60 TOCTOU Ficticio', 'Dirección ficticia 61', 'toctou@example.invalid', 'internal'),
  ('63000000-0000-4000-8000-000000000060', 'cit60-modes', 'CIT60 Modes Ficticio', 'Dirección ficticia 62', 'modes@example.invalid', 'internal');

insert into public.tenant_legal_profiles(
  tenant_id, trade_name, contact_address, support_email,
  privacy_contact_name, privacy_contact_email, tenant_is_service_provider,
  handles_sensitive_data, sensitive_data_review_status,
  sensitive_data_purpose, administrative_review_status, created_by, updated_by
)
select
  tenant.id, tenant.name, tenant.address, tenant.contact_email,
  'Contacto privacidad ficticio', tenant.contact_email, true,
  false, 'confirmed_no', null, 'complete',
  '60000000-0000-4000-8000-000000000060',
  '60000000-0000-4000-8000-000000000060'
from public.tenants tenant
where tenant.id in (
  '61000000-0000-4000-8000-000000000060',
  '62000000-0000-4000-8000-000000000060',
  '63000000-0000-4000-8000-000000000060'
);

insert into public.dte_production_tenant_settings(
  tenant_id, issuer_legal_name, issuer_rut, issuer_activity,
  issuer_activity_code, issuer_address, issuer_commune, issuer_city
)
select
  tenant.id, tenant.name, '78.195.645-7', 'Servicios ficticios',
  '620900', tenant.address, 'Comuna ficticia', 'Ciudad ficticia'
from public.tenants tenant
where tenant.id in (
  '61000000-0000-4000-8000-000000000060',
  '62000000-0000-4000-8000-000000000060',
  '63000000-0000-4000-8000-000000000060'
);

insert into public.legal_documents(
  owner_kind, tenant_id, document_type, version, title, content,
  content_sha256, status, effective_at, published_at, created_by, published_by
)
select
  'tenant', tenant.id, required.document_type, 1,
  'Documento legal ficticio ' || required.document_type,
  'Contenido legal exclusivamente ficticio y suficientemente extenso para la prueba local aislada CIT-60.',
  pg_catalog.repeat('0', 64), 'published', pg_catalog.now(),
  pg_catalog.now(), '60000000-0000-4000-8000-000000000060',
  '60000000-0000-4000-8000-000000000060'
from public.tenants tenant
cross join (
  values
    ('consumer_terms'::text),
    ('privacy_notice'::text),
    ('cancellation_refund_policy'::text)
) required(document_type)
where tenant.id in (
  '61000000-0000-4000-8000-000000000060',
  '62000000-0000-4000-8000-000000000060',
  '63000000-0000-4000-8000-000000000060'
);

insert into public.services(
  id, tenant_id, name, duration_min, price, currency, is_active,
  tax_treatment, public_description, tax_description,
  tax_description_review_status, payment_policy,
  payment_configuration_complete
) values
  ('61100000-0000-4000-8000-000000000060', '61000000-0000-4000-8000-000000000060', 'Servicio ficticio 60', 30, 10000, 'CLP', true, 'affected', 'Servicio ficticio', 'Servicio afecto ficticio', 'approved', 'full_payment', true),
  ('62100000-0000-4000-8000-000000000060', '62000000-0000-4000-8000-000000000060', 'Servicio ficticio 61', 30, 10000, 'CLP', true, 'affected', 'Servicio ficticio', 'Servicio afecto ficticio', 'approved', 'full_payment', true),
  ('63100000-0000-4000-8000-000000000060', '63000000-0000-4000-8000-000000000060', 'Servicio ficticio 62', 30, 10000, 'CLP', true, 'affected', 'Servicio ficticio', 'Servicio afecto ficticio', 'approved', 'full_payment', true);

insert into public.tenant_payment_settings(
  tenant_id, active, updated_at, payment_mode, payment_methods_enabled,
  payment_collection_mode, bank_name, bank_account_type,
  bank_account_number, bank_account_holder, bank_rut, bank_email
)
select
  tenant.id, true, pg_catalog.now(), 'optional', '["manual"]'::jsonb,
  'full', 'Banco Ficticio', 'Cuenta ficticia', '00000060',
  tenant.name, '78.195.645-7', tenant.contact_email
from public.tenants tenant
where tenant.id in (
  '61000000-0000-4000-8000-000000000060',
  '62000000-0000-4000-8000-000000000060',
  '63000000-0000-4000-8000-000000000060'
);

insert into public.dte_tenant_issuance_settings(
  tenant_id, production_enabled, issuance_mode, updated_at,
  boleta_payment_document_model, boleta_model_verified_at,
  boleta_model_verified_by, boleta_model_evidence_reference
)
select
  tenant.id, false, 'manual', pg_catalog.now(), 'always_issue_boleta',
  pg_catalog.now(), '60000000-0000-4000-8000-000000000060',
  'CIT60-OFFLINE-FIXTURE'
from public.tenants tenant
where tenant.id in (
  '61000000-0000-4000-8000-000000000060',
  '62000000-0000-4000-8000-000000000060',
  '63000000-0000-4000-8000-000000000060'
);

do $$
declare
  tenant_id uuid;
  report jsonb;
begin
  foreach tenant_id in array array[
    '61000000-0000-4000-8000-000000000060'::uuid,
    '62000000-0000-4000-8000-000000000060'::uuid,
    '63000000-0000-4000-8000-000000000060'::uuid
  ] loop
    perform public.register_tenant_self_issuer_authority(
      tenant_id,
      '60000000-0000-4000-8000-000000000060',
      '78.195.645-7',
      'Concesión ficticia interna para la prueba local CIT-60',
      'CIT60-GRANT-' || tenant_id::text
    );
    report := public.tenant_self_issuer_authority_report(tenant_id);
    if report->'valid' is distinct from 'true'::jsonb
       or report->>'status' <> 'active'
       or report->'internalActive' is distinct from 'true'::jsonb
       or report->'tenantActive' is distinct from 'true'::jsonb
       or report->'modeEligible' is distinct from 'true'::jsonb then
      raise exception 'CIT60_INTERNAL_GRANT_NOT_VALID: %', report;
    end if;
  end loop;
end;
$$;

-- A complete internal tenant must pass PRE, survive promotion, and leave one
-- audit record whose top-level readiness is POST and whose nested value is PRE.
do $$
declare
  target_tenant_id constant uuid := '61000000-0000-4000-8000-000000000060';
  pre_report jsonb;
  post_report jsonb;
  self_report jsonb;
  authority_report jsonb;
  legal_report jsonb;
  audit_snapshot jsonb;
begin
  pre_report := public.tenant_live_readiness_report(target_tenant_id);
  if pre_report->'ready' is distinct from 'true'::jsonb then
    raise exception 'CIT60_PRE_NOT_READY: %', pre_report;
  end if;

  perform public.set_tenant_operational_mode(
    target_tenant_id,
    'live',
    '60000000-0000-4000-8000-000000000060',
    'Promoción ficticia internal a live para comprobar CIT-60'
  );

  if (select operational_mode from public.tenants where id = target_tenant_id) <> 'live' then
    raise exception 'CIT60_MODE_NOT_LIVE';
  end if;
  self_report := public.tenant_self_issuer_authority_report(target_tenant_id);
  authority_report := public.tenant_dte_authority_report(target_tenant_id);
  legal_report := public.tenant_legal_gate_report(target_tenant_id);
  post_report := public.tenant_live_readiness_report(target_tenant_id);
  if self_report->'valid' is distinct from 'true'::jsonb
     or self_report->'internalActive' is distinct from 'false'::jsonb
     or self_report->'tenantActive' is distinct from 'true'::jsonb
     or self_report->>'operationalMode' <> 'live'
     or self_report->'modeEligible' is distinct from 'true'::jsonb
     or self_report->'legalProfileValid' is distinct from 'true'::jsonb then
    raise exception 'CIT60_LIVE_SELF_AUTHORITY_INVALID: %', self_report;
  end if;
  if authority_report->>'kind' <> 'self_issued'
     or authority_report->'ready' is distinct from 'true'::jsonb
     or legal_report->'ready' is distinct from 'true'::jsonb
     or post_report->'ready' is distinct from 'true'::jsonb then
    raise exception 'CIT60_LIVE_GATES_CLOSED: % / % / %',
      authority_report, legal_report, post_report;
  end if;
  if (select pg_catalog.count(*) from public.tenant_operational_mode_audit audit
      where audit.tenant_id = target_tenant_id) <> 1 then
    raise exception 'CIT60_AUDIT_COUNT_INVALID';
  end if;
  select readiness_snapshot into audit_snapshot
  from public.tenant_operational_mode_audit audit
  where audit.tenant_id = target_tenant_id;
  if audit_snapshot->'ready' is distinct from 'true'::jsonb
     or audit_snapshot->'preTransition' is distinct from pre_report
     or (audit_snapshot - 'preTransition') is distinct from post_report then
    raise exception 'CIT60_AUDIT_SNAPSHOT_INVALID: %', audit_snapshot;
  end if;

  begin
    perform public.register_tenant_self_issuer_authority(
      target_tenant_id,
      '60000000-0000-4000-8000-000000000060',
      '78.195.645-7',
      'Intento ficticio de concesión nueva directamente en live',
      'CIT60-LIVE-NEW-GRANT'
    );
    raise exception 'CIT60_LIVE_NEW_GRANT_ACCEPTED';
  exception when others then
    if sqlerrm = 'CIT60_LIVE_NEW_GRANT_ACCEPTED'
       or sqlerrm not like '%SELF_ISSUER_TENANT_NOT_INTERNAL_ACTIVE%' then
      raise;
    end if;
  end;
end;
$$;

-- Force a legal-profile mutation from an UPDATE trigger. POST must observe it,
-- raise the public error, and roll back both the mode and trigger mutation.
create function public.cit60_invalidate_profile_during_live_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id = '62000000-0000-4000-8000-000000000060'::uuid
     and new.operational_mode = 'live' then
    update public.tenant_legal_profiles
    set administrative_review_status = 'draft'
    where tenant_id = new.id;
  end if;
  return new;
end;
$$;
create trigger cit60_invalidate_profile_during_live_update
after update of operational_mode on public.tenants
for each row execute function public.cit60_invalidate_profile_during_live_update();

do $$
declare
  target_tenant_id constant uuid := '62000000-0000-4000-8000-000000000060';
  pre_report jsonb;
begin
  pre_report := public.tenant_live_readiness_report(target_tenant_id);
  if pre_report->'ready' is distinct from 'true'::jsonb then
    raise exception 'CIT60_TOCTOU_PRE_NOT_READY: %', pre_report;
  end if;
  begin
    perform public.set_tenant_operational_mode(
      target_tenant_id,
      'live',
      '60000000-0000-4000-8000-000000000060',
      'Promoción ficticia que debe fallar durante la revisión POST'
    );
    raise exception 'CIT60_TOCTOU_TRANSITION_ACCEPTED';
  exception when others then
    if sqlerrm = 'CIT60_TOCTOU_TRANSITION_ACCEPTED'
       or sqlerrm not like '%LIVE_TENANT_CHECKLIST_INCOMPLETE%' then
      raise;
    end if;
  end;
  if (select operational_mode from public.tenants where id = target_tenant_id) <> 'internal'
     or (select profile.administrative_review_status
         from public.tenant_legal_profiles profile
         where profile.tenant_id = target_tenant_id) <> 'complete'
     or exists(select 1 from public.tenant_operational_mode_audit audit
         where audit.tenant_id = target_tenant_id) then
    raise exception 'CIT60_TOCTOU_ROLLBACK_INCOMPLETE';
  end if;
end;
$$;

-- RUT, non-RUT fingerprint, legal profile, and revocation must each close every
-- derived gate while preserving the immutable grant row.
do $$
declare
  target_tenant_id constant uuid := '61000000-0000-4000-8000-000000000060';
  report jsonb;
  authority jsonb;
  legal jsonb;
  readiness jsonb;
begin
  update public.dte_production_tenant_settings production
  set issuer_rut = '76.123.456-0'
  where production.tenant_id = target_tenant_id;
  report := public.tenant_self_issuer_authority_report(target_tenant_id);
  authority := public.tenant_dte_authority_report(target_tenant_id);
  legal := public.tenant_legal_gate_report(target_tenant_id);
  readiness := public.tenant_live_readiness_report(target_tenant_id);
  if report->'valid' is distinct from 'false'::jsonb
     or report->'rutMatches' is distinct from 'false'::jsonb
     or authority->'ready' is distinct from 'false'::jsonb
     or legal->'ready' is distinct from 'false'::jsonb
     or readiness->'ready' is distinct from 'false'::jsonb then
    raise exception 'CIT60_RUT_DRIFT_DID_NOT_CLOSE_GATES';
  end if;

  update public.dte_production_tenant_settings production
  set issuer_rut = '78.195.645-7', issuer_address = 'Otra dirección fiscal ficticia 600'
  where production.tenant_id = target_tenant_id;
  report := public.tenant_self_issuer_authority_report(target_tenant_id);
  if report->'valid' is distinct from 'false'::jsonb
     or report->'rutMatches' is distinct from 'true'::jsonb
     or report->'identityMatches' is distinct from 'false'::jsonb
     or public.tenant_legal_gate_report(target_tenant_id)->'ready' is distinct from 'false'::jsonb
     or public.tenant_live_readiness_report(target_tenant_id)->'ready' is distinct from 'false'::jsonb then
    raise exception 'CIT60_FINGERPRINT_DRIFT_DID_NOT_CLOSE_GATES: %', report;
  end if;

  update public.dte_production_tenant_settings production
  set issuer_address = 'Dirección ficticia 60'
  where production.tenant_id = target_tenant_id;
  update public.tenant_legal_profiles profile
  set administrative_review_status = 'draft'
  where profile.tenant_id = target_tenant_id;
  report := public.tenant_self_issuer_authority_report(target_tenant_id);
  if report->'valid' is distinct from 'false'::jsonb
     or report->'legalProfileValid' is distinct from 'false'::jsonb
     or public.tenant_legal_gate_report(target_tenant_id)->'ready' is distinct from 'false'::jsonb
     or public.tenant_live_readiness_report(target_tenant_id)->'ready' is distinct from 'false'::jsonb then
    raise exception 'CIT60_PROFILE_DRIFT_DID_NOT_CLOSE_GATES: %', report;
  end if;

  update public.tenant_legal_profiles profile
  set administrative_review_status = 'complete'
  where profile.tenant_id = target_tenant_id;
  if public.tenant_self_issuer_authority_report(target_tenant_id)->'valid'
       is distinct from 'true'::jsonb then
    raise exception 'CIT60_DERIVED_INVALIDATION_NOT_REVERSIBLE';
  end if;

  perform public.revoke_tenant_self_issuer_authority(
    target_tenant_id,
    '60000000-0000-4000-8000-000000000060',
    'Revocación ficticia definitiva para la prueba local CIT-60',
    'CIT60-REVOKE-LIVE'
  );
  report := public.tenant_self_issuer_authority_report(target_tenant_id);
  authority := public.tenant_dte_authority_report(target_tenant_id);
  legal := public.tenant_legal_gate_report(target_tenant_id);
  readiness := public.tenant_live_readiness_report(target_tenant_id);
  if report->'valid' is distinct from 'false'::jsonb
     or report->>'status' <> 'revoked'
     or authority->'ready' is distinct from 'false'::jsonb
     or legal->'ready' is distinct from 'false'::jsonb
     or readiness->'ready' is distinct from 'false'::jsonb then
    raise exception 'CIT60_REVOCATION_DID_NOT_CLOSE_GATES';
  end if;
end;
$$;

-- Evidence granted while internal is invalid in demo/unclassified and once
-- archived. Returning to internal restores derived validity until revocation.
do $$
declare
  target_tenant_id constant uuid := '63000000-0000-4000-8000-000000000060';
  mode text;
  report jsonb;
begin
  foreach mode in array array['demo'::text, 'unclassified'::text] loop
    update public.tenants set operational_mode = mode where id = target_tenant_id;
    report := public.tenant_self_issuer_authority_report(target_tenant_id);
    if report->'valid' is distinct from 'false'::jsonb
       or report->'modeEligible' is distinct from 'false'::jsonb then
      raise exception 'CIT60_INELIGIBLE_MODE_RETAINED_AUTHORITY: % / %', mode, report;
    end if;
  end loop;
  update public.tenants set operational_mode = 'internal' where id = target_tenant_id;
  if public.tenant_self_issuer_authority_report(target_tenant_id)->'valid'
       is distinct from 'true'::jsonb then
    raise exception 'CIT60_INTERNAL_RESTORATION_FAILED';
  end if;
  update public.tenants
  set lifecycle_status = 'archived',
      archived_at = pg_catalog.now(),
      archived_by = '60000000-0000-4000-8000-000000000060',
      archive_reason = 'Archivado ficticio para comprobar invalidez de autoridad'
  where id = target_tenant_id;
  report := public.tenant_self_issuer_authority_report(target_tenant_id);
  if report->'valid' is distinct from 'false'::jsonb
     or report->'tenantActive' is distinct from 'false'::jsonb
     or report->'modeEligible' is distinct from 'false'::jsonb then
    raise exception 'CIT60_ARCHIVED_RETAINED_AUTHORITY: %', report;
  end if;
end;
$$;

-- Function grants stay backend-only. Authenticated access to the evidence
-- table remains RLS-filtered to platform administrators.
do $$
begin
  if pg_catalog.has_function_privilege(
      'anon', 'public.tenant_self_issuer_authority_report(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege(
      'authenticated', 'public.tenant_self_issuer_authority_report(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege(
      'service_role', 'public.tenant_self_issuer_authority_report(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege(
      'anon', 'public.set_tenant_operational_mode(uuid,text,uuid,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege(
      'authenticated', 'public.set_tenant_operational_mode(uuid,text,uuid,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege(
      'service_role', 'public.set_tenant_operational_mode(uuid,text,uuid,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege(
      'anon', 'public.revoke_tenant_self_issuer_authority(uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege(
      'authenticated', 'public.revoke_tenant_self_issuer_authority(uuid,uuid,text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege(
      'service_role', 'public.revoke_tenant_self_issuer_authority(uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege(
      'authenticated', 'public.register_tenant_self_issuer_authority(uuid,uuid,text,text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege(
      'service_role', 'public.register_tenant_self_issuer_authority(uuid,uuid,text,text,text)', 'EXECUTE') then
    raise exception 'CIT60_FUNCTION_ACL_REGRESSION';
  end if;
  if not pg_catalog.has_table_privilege(
      'authenticated', 'public.tenant_self_issuer_authority_events', 'SELECT')
     or pg_catalog.has_table_privilege(
      'anon', 'public.tenant_self_issuer_authority_events', 'SELECT') then
    raise exception 'CIT60_TABLE_ACL_REGRESSION';
  end if;
end;
$$;

set local app.test_uid = '60100000-0000-4000-8000-000000000060';
set local role authenticated;
do $$
begin
  if exists(select 1 from public.tenant_self_issuer_authority_events) then
    raise exception 'CIT60_NON_PLATFORM_READ_SELF_ISSUER_EVIDENCE';
  end if;
end;
$$;
reset role;

set local app.test_uid = '60000000-0000-4000-8000-000000000060';
set local role authenticated;
do $$
begin
  if not exists(select 1 from public.tenant_self_issuer_authority_events) then
    raise exception 'CIT60_PLATFORM_ADMIN_CANNOT_READ_EVIDENCE';
  end if;
end;
$$;
reset role;

-- The test exercises legal/readiness state only. It creates no tax artifact,
-- queue item, certificate, network attempt, CAF or folio.
do $$
begin
  if exists(select 1 from public.dte_payment_document_intents)
     or exists(select 1 from public.dte_issuance_outbox)
     or exists(select 1 from public.dte_production_documents)
     or exists(select 1 from public.dte_production_cafs)
     or exists(select 1 from public.dte_production_folio_ledger)
     or exists(select 1 from public.dte_production_artifacts)
     or exists(select 1 from public.dte_production_submission_attempts) then
    raise exception 'CIT60_CREATED_DTE_CAF_FOLIO_CERTIFICATE_OUTBOX_OR_NETWORK_STATE';
  end if;
end;
$$;

rollback;
