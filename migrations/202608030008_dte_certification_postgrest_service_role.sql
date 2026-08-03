-- Fix PostgREST service-role detection for isolated Boleta 39 certification RPCs.
--
-- Migration 007 consulted the legacy request.jwt.claim.role setting.
-- This runtime exposes JWT claims through request.jwt.claims as JSON.
--
-- Additive migration:
--   * no certification or production tables are changed;
--   * no CAF or folio is imported;
--   * function signatures and business rules remain unchanged;
--   * CREATE OR REPLACE preserves existing ownership and EXECUTE grants.

create or replace function public.import_dte_certification_caf(
  p_tenant_id uuid,p_environment text,p_document_type integer,p_issuer_rut text,
  p_caf_sha256 text,p_secure_path text,p_idk text,p_range_from integer,
  p_range_to integer,p_authorization_date date,p_frma_verification_status text,
  p_exception_reason text,p_exception_actor_id uuid,p_exception_authorized_at timestamptz,
  p_caller text
) returns table(caf_id uuid,replayed boolean,folio_count integer)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_existing public.dte_certification_cafs%rowtype;v_id uuid;v_gate jsonb;
begin
  if coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
     and session_user<>'postgres' then
    raise exception 'DTE_CERTIFICATION_SERVICE_ROLE_REQUIRED';
  end if;
  if p_environment<>'certification' then raise exception 'DTE_CERTIFICATION_ENVIRONMENT_REQUIRED';end if;
  if p_document_type<>39 then raise exception 'DTE_CERTIFICATION_TYPE39_REQUIRED';end if;
  if p_caller<>'offline_certification_cli' then raise exception 'DTE_CERTIFICATION_CALLER_REJECTED';end if;
  if not public.is_platform_admin(p_exception_actor_id) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  if not exists(select 1 from public.tenants t where t.id=p_tenant_id
      and t.lifecycle_status='active' and t.operational_mode='internal') then
    raise exception 'DTE_CERTIFICATION_INTERNAL_ACTIVE_TENANT_REQUIRED';
  end if;
  v_gate:=public.dte_type39_enablement_gate_report(p_tenant_id);
  if not coalesce((v_gate->>'certificationReady')::boolean,false) then
    raise exception 'DTE_CERTIFICATION_READY_REQUIRED';
  end if;
  if not exists(select 1 from public.dte_tenant_document_capabilities c
      where c.tenant_id=p_tenant_id and c.environment='certification' and c.dte_type=39
        and c.certification_status in ('pre_caf_ready','caf_imported') and not c.issuance_enabled)
     or exists(select 1 from public.dte_tenant_document_capabilities c
      where c.tenant_id=p_tenant_id and c.environment='production' and c.dte_type=39
        and c.issuance_enabled) then
    raise exception 'DTE_CERTIFICATION_CAPABILITY_BOUNDARY_FAILED';
  end if;
  if p_secure_path !~ '^/home/verf/secure/[a-zA-Z0-9._/-]+\.xml$'
     or p_secure_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'DTE_CERTIFICATION_CAF_PATH_INVALID';
  end if;
  if p_frma_verification_status<>'not_independently_verified_missing_official_idk100_anchor'
     or p_idk<>'100' then
    raise exception 'DTE_CERTIFICATION_FRMA_EXCEPTION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'citaya:certification:caf:'||p_tenant_id::text||':39',0));
  select * into v_existing from public.dte_certification_cafs c
   where c.tenant_id=p_tenant_id and c.environment='certification'
     and c.caf_sha256=p_caf_sha256;
  if found then
    if v_existing.document_type<>p_document_type or v_existing.issuer_rut<>p_issuer_rut
       or v_existing.secure_path<>p_secure_path or v_existing.idk<>p_idk
       or v_existing.range_from<>p_range_from or v_existing.range_to<>p_range_to
       or v_existing.authorization_date<>p_authorization_date
       or v_existing.frma_verification_status<>p_frma_verification_status
       or v_existing.exception_reason<>pg_catalog.btrim(p_exception_reason)
       or v_existing.exception_actor_id<>p_exception_actor_id
       or v_existing.exception_authorized_at<>p_exception_authorized_at then
      raise exception 'DTE_CERTIFICATION_CAF_REPLAY_METADATA_MISMATCH';
    end if;
    return query select v_existing.id,true,(select count(*)::integer
      from public.dte_certification_folios f where f.caf_id=v_existing.id);
    return;
  end if;
  if exists(select 1 from public.dte_certification_cafs c
      where c.tenant_id=p_tenant_id and c.environment='certification'
        and c.document_type=39 and c.status='active'
        and pg_catalog.int4range(c.range_from,c.range_to,'[]') &&
          pg_catalog.int4range(p_range_from,p_range_to,'[]')) then
    raise exception 'DTE_CERTIFICATION_CAF_RANGE_OVERLAP';
  end if;
  insert into public.dte_certification_cafs(
    tenant_id,environment,document_type,issuer_rut,caf_sha256,secure_path,idk,
    range_from,range_to,authorization_date,frma_verification_status,
    exception_reason,exception_actor_id,exception_authorized_at
  ) values(p_tenant_id,p_environment,p_document_type,p_issuer_rut,p_caf_sha256,
    p_secure_path,p_idk,p_range_from,p_range_to,p_authorization_date,
    p_frma_verification_status,pg_catalog.btrim(p_exception_reason),
    p_exception_actor_id,p_exception_authorized_at) returning id into v_id;
  insert into public.dte_certification_folios(
    tenant_id,environment,document_type,folio,caf_id
  ) select p_tenant_id,'certification',39,n,v_id
    from pg_catalog.generate_series(p_range_from,p_range_to) n;
  update public.dte_tenant_document_capabilities set
    certification_status='caf_imported',updated_at=pg_catalog.now()
    where tenant_id=p_tenant_id and environment='certification' and dte_type=39
      and certification_status='pre_caf_ready' and not issuance_enabled;
  return query select v_id,false,p_range_to-p_range_from+1;
end;
$$;

create or replace function public.begin_dte_certification_run(
  p_tenant_id uuid,p_environment text,p_document_type integer,p_caf_id uuid,
  p_idempotency_key text,p_case_folio_map jsonb,p_actor_id uuid,p_caller text
) returns table(run_id uuid,replayed boolean,status text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_existing public.dte_certification_runs%rowtype;v_id uuid;v_case text;v_folio integer;
begin
  if coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
     and session_user<>'postgres' then raise exception 'DTE_CERTIFICATION_SERVICE_ROLE_REQUIRED';end if;
  if p_environment<>'certification' then raise exception 'DTE_CERTIFICATION_ENVIRONMENT_REQUIRED';end if;
  if p_document_type<>39 then raise exception 'DTE_CERTIFICATION_TYPE39_REQUIRED';end if;
  if p_caller<>'offline_certification_cli' then raise exception 'DTE_CERTIFICATION_CALLER_REJECTED';end if;
  if not public.is_platform_admin(p_actor_id) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  if p_case_folio_map<>jsonb_build_object('CASO-1',1,'CASO-2',2,'CASO-3',3,'CASO-4',4,'CASO-5',5) then
    raise exception 'DTE_CERTIFICATION_CASE_FOLIO_MAP_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'citaya:certification:run:'||p_tenant_id::text||':39',0));
  select * into v_existing from public.dte_certification_runs r
    where r.tenant_id=p_tenant_id and r.environment='certification'
      and r.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.caf_id<>p_caf_id or v_existing.document_type<>39
       or v_existing.case_folio_map<>p_case_folio_map or v_existing.actor_id<>p_actor_id then
      raise exception 'DTE_CERTIFICATION_RUN_REPLAY_MISMATCH';
    end if;
    return query select v_existing.id,true,v_existing.status;return;
  end if;
  if not exists(select 1 from public.dte_certification_cafs c where c.id=p_caf_id
      and c.tenant_id=p_tenant_id and c.environment='certification'
      and c.document_type=39 and c.status='active') then raise exception 'DTE_CERTIFICATION_CAF_INVALID';end if;
  insert into public.dte_certification_runs(
    tenant_id,environment,document_type,caf_id,idempotency_key,case_folio_map,actor_id
  ) values(p_tenant_id,'certification',39,p_caf_id,p_idempotency_key,p_case_folio_map,p_actor_id)
    returning id into v_id;
  for v_case,v_folio in select key,value::text::integer from pg_catalog.jsonb_each(p_case_folio_map) loop
    update public.dte_certification_folios set state='reserved',run_id=v_id,
      case_id=v_case,reserved_at=pg_catalog.now()
      where tenant_id=p_tenant_id and environment='certification' and document_type=39
        and folio=v_folio and caf_id=p_caf_id and state='available';
    if not found then raise exception 'DTE_CERTIFICATION_FOLIO_NOT_AVAILABLE';end if;
  end loop;
  return query select v_id,false,'preparing'::text;
end;
$$;

create or replace function public.validate_dte_certification_run(
  p_tenant_id uuid,p_run_id uuid,p_artifacts jsonb,p_final_hashes jsonb,p_caller text
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_run public.dte_certification_runs%rowtype;v_item jsonb;v_kind text;v_case text;
begin
  if coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
     and session_user<>'postgres' then raise exception 'DTE_CERTIFICATION_SERVICE_ROLE_REQUIRED';end if;
  if p_caller<>'offline_certification_cli' then raise exception 'DTE_CERTIFICATION_CALLER_REJECTED';end if;
  select * into v_run from public.dte_certification_runs r
    where r.id=p_run_id and r.tenant_id=p_tenant_id for update;
  if not found then raise exception 'DTE_CERTIFICATION_RUN_NOT_FOUND';end if;
  if v_run.status='validated' then return v_run.id;end if;
  if v_run.status<>'preparing' then raise exception 'DTE_CERTIFICATION_RUN_NOT_PREPARING';end if;
  if pg_catalog.jsonb_array_length(p_artifacts)<>9 or pg_catalog.jsonb_typeof(p_final_hashes)<>'object' then
    raise exception 'DTE_CERTIFICATION_ARTIFACT_SET_INVALID';
  end if;
  update public.dte_certification_runs set status='generated',generated_at=pg_catalog.now(),
    final_hashes=p_final_hashes where id=v_run.id;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_artifacts) loop
    v_kind:=v_item->>'kind';v_case:=nullif(v_item->>'caseId','');
    insert into public.dte_certification_artifacts(
      tenant_id,environment,document_type,run_id,artifact_kind,case_id,
      private_path,sha256,byte_length
    ) values(v_run.tenant_id,'certification',39,v_run.id,v_kind,v_case,
      v_item->>'path',v_item->>'sha256',(v_item->>'byteLength')::bigint);
  end loop;
  if (select count(*) from public.dte_certification_artifacts a where a.run_id=v_run.id
      and a.artifact_kind='boleta_xml')<>5
     or (select count(*) from public.dte_certification_artifacts a where a.run_id=v_run.id
      and a.artifact_kind in ('envelope_xml','rcof_xml','sanitized_report','sha256_manifest'))<>4 then
    raise exception 'DTE_CERTIFICATION_ARTIFACT_COVERAGE_INVALID';
  end if;
  update public.dte_certification_folios set state='generated',generated_at=pg_catalog.now()
    where tenant_id=v_run.tenant_id and run_id=v_run.id and state='reserved';
  if (select count(*) from public.dte_certification_folios f
      where f.run_id=v_run.id and f.state='generated')<>5 then
    raise exception 'DTE_CERTIFICATION_GENERATED_FOLIO_COUNT_INVALID';
  end if;
  update public.dte_certification_runs set status='validated',validated_at=pg_catalog.now()
    where id=v_run.id;
  return v_run.id;
end;
$$;

create or replace function public.fail_dte_certification_run(
  p_tenant_id uuid,p_run_id uuid,p_failure_code text,p_caller text
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
begin
  if coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
     and session_user<>'postgres' then raise exception 'DTE_CERTIFICATION_SERVICE_ROLE_REQUIRED';end if;
  if p_caller<>'offline_certification_cli' then raise exception 'DTE_CERTIFICATION_CALLER_REJECTED';end if;
  update public.dte_certification_folios set state='failed',failed_at=pg_catalog.now()
    where tenant_id=p_tenant_id and run_id=p_run_id and state='reserved';
  update public.dte_certification_runs set status='failed',failed_at=pg_catalog.now(),
    failure_code=pg_catalog.left(p_failure_code,120)
    where tenant_id=p_tenant_id and id=p_run_id and status in ('preparing','generated');
  if not found then raise exception 'DTE_CERTIFICATION_RUN_FAIL_INVALID';end if;
  return p_run_id;
end;
$$;
