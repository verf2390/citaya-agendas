\set ON_ERROR_STOP on

do $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_caf uuid;
  v_replayed boolean;
  v_count integer;
  v_run uuid;
  v_status text;
begin
  select t.id,e.actor_user_id into strict v_tenant,v_actor
  from public.tenants t
  join public.tenant_self_issuer_authority_events e on e.tenant_id=t.id
  where t.slug='rg-spa' and e.event_type='granted';

  if (select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'dte_certification_cafs','dte_certification_folios',
        'dte_certification_runs','dte_certification_artifacts'
      ) and c.relrowsecurity and c.relforcerowsecurity)<>4
     or exists(select 1 from (values
       ('anon'::text),('authenticated'::text)
     ) r(role_name) where exists(select 1 from pg_catalog.pg_roles pr
       where pr.rolname=r.role_name) and exists(select 1 from (values
       ('dte_certification_cafs'::text),('dte_certification_folios'::text),
       ('dte_certification_runs'::text),('dte_certification_artifacts'::text)
     ) t(table_name) where pg_catalog.has_table_privilege(
       r.role_name,'public.'||t.table_name,'SELECT,INSERT,UPDATE,DELETE')))
  then raise exception 'DTE_CERTIFICATION_RLS_OR_GRANTS_INVALID';end if;

  begin
    perform public.import_dte_certification_caf(
      v_tenant,'certification',39,'78195645-7',repeat('a',64),
      '/home/verf/secure/certification/smoke.xml','100',1,5,date '2026-08-03',
      'not_independently_verified_missing_official_idk100_anchor',
      'controlled PostgreSQL 17 certification smoke authorization',v_actor,
      timestamptz '2026-08-03 12:00:00-04','worker');
    raise exception 'DTE_CERTIFICATION_CALLER_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm<>'DTE_CERTIFICATION_CALLER_REJECTED' then raise;end if;
  end;

  select caf_id,replayed,folio_count into strict v_caf,v_replayed,v_count
  from public.import_dte_certification_caf(
    v_tenant,'certification',39,'78195645-7',repeat('a',64),
    '/home/verf/secure/certification/smoke.xml','100',1,5,date '2026-08-03',
    'not_independently_verified_missing_official_idk100_anchor',
    'controlled PostgreSQL 17 certification smoke authorization',v_actor,
    timestamptz '2026-08-03 12:00:00-04','offline_certification_cli');
  if v_replayed or v_count<>5 then raise exception 'DTE_CERTIFICATION_IMPORT_INVALID';end if;

  select caf_id,replayed,folio_count into strict v_caf,v_replayed,v_count
  from public.import_dte_certification_caf(
    v_tenant,'certification',39,'78195645-7',repeat('a',64),
    '/home/verf/secure/certification/smoke.xml','100',1,5,date '2026-08-03',
    'not_independently_verified_missing_official_idk100_anchor',
    'controlled PostgreSQL 17 certification smoke authorization',v_actor,
    timestamptz '2026-08-03 12:00:00-04','offline_certification_cli');
  if not v_replayed or v_count<>5 then raise exception 'DTE_CERTIFICATION_REPLAY_INVALID';end if;

  begin
    perform public.import_dte_certification_caf(
      v_tenant,'certification',39,'78195645-7',repeat('b',64),
      '/home/verf/secure/certification/overlap.xml','100',1,5,date '2026-08-03',
      'not_independently_verified_missing_official_idk100_anchor',
      'controlled PostgreSQL 17 certification smoke authorization',v_actor,
      timestamptz '2026-08-03 12:00:00-04','offline_certification_cli');
    raise exception 'DTE_CERTIFICATION_OVERLAP_WAS_NOT_REJECTED';
  exception when exclusion_violation then null;
    when others then
      if sqlerrm<>'DTE_CERTIFICATION_CAF_RANGE_OVERLAP' then raise;end if;
  end;

  select run_id,replayed,status into strict v_run,v_replayed,v_status
  from public.begin_dte_certification_run(
    v_tenant,'certification',39,v_caf,'boleta39-certification-smoke-20260803',
    jsonb_build_object('CASO-1',1,'CASO-2',2,'CASO-3',3,'CASO-4',4,'CASO-5',5),
    v_actor,'offline_certification_cli');
  if v_replayed or v_status<>'preparing' or
     (select count(*) from public.dte_certification_folios
      where run_id=v_run and state='reserved')<>5
  then raise exception 'DTE_CERTIFICATION_RESERVATION_INVALID';end if;

  perform public.validate_dte_certification_run(
    v_tenant,v_run,
    jsonb_build_array(
      jsonb_build_object('kind','boleta_xml','caseId','CASO-1','path','/home/verf/secure/certification/caso1.xml','sha256',repeat('1',64),'byteLength',100),
      jsonb_build_object('kind','boleta_xml','caseId','CASO-2','path','/home/verf/secure/certification/caso2.xml','sha256',repeat('2',64),'byteLength',100),
      jsonb_build_object('kind','boleta_xml','caseId','CASO-3','path','/home/verf/secure/certification/caso3.xml','sha256',repeat('3',64),'byteLength',100),
      jsonb_build_object('kind','boleta_xml','caseId','CASO-4','path','/home/verf/secure/certification/caso4.xml','sha256',repeat('4',64),'byteLength',100),
      jsonb_build_object('kind','boleta_xml','caseId','CASO-5','path','/home/verf/secure/certification/caso5.xml','sha256',repeat('5',64),'byteLength',100),
      jsonb_build_object('kind','envelope_xml','path','/home/verf/secure/certification/envelope.xml','sha256',repeat('6',64),'byteLength',100),
      jsonb_build_object('kind','rcof_xml','path','/home/verf/secure/certification/rcof.xml','sha256',repeat('7',64),'byteLength',100),
      jsonb_build_object('kind','sanitized_report','path','/home/verf/secure/certification/report.json','sha256',repeat('8',64),'byteLength',100),
      jsonb_build_object('kind','sha256_manifest','path','/home/verf/secure/certification/SHA256SUMS','sha256',repeat('9',64),'byteLength',100)
    ),jsonb_build_object('envelope',repeat('6',64),'rcof',repeat('7',64)),
    'offline_certification_cli');
  if (select count(*) from public.dte_certification_folios
      where run_id=v_run and state='generated')<>5
     or (select count(*) from public.dte_certification_artifacts where run_id=v_run)<>9
  then raise exception 'DTE_CERTIFICATION_VALIDATION_INVALID';end if;

  begin
    update public.dte_certification_folios set state='available'
    where tenant_id=v_tenant and environment='certification' and document_type=39 and folio=1;
    raise exception 'DTE_CERTIFICATION_GENERATED_TRANSITION_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm<>'DTE_CERTIFICATION_GENERATED_FOLIO_IMMUTABLE' then raise;end if;
  end;
end;
$$;

select 'DTE_CERTIFICATION_POSTGRES17_SMOKE_PASSED' as result;
