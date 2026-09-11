begin;

-- Keep the OFF precondition stable until DML grants and audit triggers are closed.
-- Concurrent writers must finish before the check or wait until this transaction commits.
lock table public.tenant_bhe_automation_settings in share row exclusive mode;

-- Fail rather than silently converting a historical activation. No data backfill.
do $$
begin
  if exists(select 1 from public.tenant_bhe_automation_settings where automation_enabled) then
    raise exception 'BHE_LEGACY_AUTOMATION_MUST_BE_OFF';
  end if;
end;
$$;

create function public.bhe_require_platform_actor()
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare actor uuid := auth.uid();
begin
  -- current_user is the function owner inside a definer. The invoking SQL role
  -- and verified Auth subject must both identify an authenticated admin session.
  if pg_catalog.current_setting('role',true) is distinct from 'authenticated'
     or auth.role() is distinct from 'authenticated'
     or actor is null
     or not exists(select 1 from public.platform_admins p
       where p.user_id=actor and p.is_active is true and pg_catalog.lower(p.role)='super_admin') then
    raise exception 'BHE_PLATFORM_ADMIN_REQUIRED';
  end if;
  return actor;
end;
$$;

create function public.bhe_prepare_authority_change(p_tenant_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare actor uuid := public.bhe_require_platform_actor(); safe_reason text;
begin
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 10 and 500 then
    raise exception 'BHE_REASON_REQUIRED';
  end if;
  -- Reasons are operational prose, never a place to repeat taxpayer identifiers.
  safe_reason := pg_catalog.regexp_replace(pg_catalog.btrim(p_reason),
    '\m[0-9]{1,2}([.]?[0-9]{3}){2}-?[0-9kK]\M','[RUT_REDACTED]','g');
  -- One lock order for all administration: tenant, then entity. This also
  -- serializes revisions and generation changes across an issuer's dimensions.
  perform 1 from public.tenants where id=p_tenant_id for update;
  if not found then raise exception 'BHE_TENANT_NOT_FOUND'; end if;
  perform pg_catalog.set_config('citaya.bhe_change_reason',safe_reason,true);
  return actor;
end;
$$;

create function public.bhe_stamp_authority_entity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare actor uuid := public.bhe_require_platform_actor();
begin
  if nullif(pg_catalog.current_setting('citaya.bhe_change_reason',true),'') is null then
    raise exception 'BHE_AUDIT_CONTEXT_REQUIRED';
  end if;
  if tg_op='INSERT' then
    new.version:=1;
    new.created_at:=pg_catalog.clock_timestamp();
    new.created_by:=actor;
  else
    if (pg_catalog.to_jsonb(new) - array['status','evidence_reference','evidence_verified_at',
      'evidence_verified_by','verified_at','verified_by','valid_from','valid_until',
      'version','updated_at','updated_by']) is distinct from
      (pg_catalog.to_jsonb(old) - array['status','evidence_reference','evidence_verified_at',
      'evidence_verified_by','verified_at','verified_by','valid_from','valid_until',
      'version','updated_at','updated_by']) then
      raise exception 'BHE_IMMUTABLE_IDENTITY';
    end if;
    new.version:=old.version+1;
  end if;
  new.updated_at:=pg_catalog.clock_timestamp();
  new.updated_by:=actor;
  return new;
end;
$$;

create function public.bhe_audit_state(p_state jsonb)
returns jsonb language sql immutable security invoker set search_path=''
as $$
  select case when p_state is null then '{}'::jsonb else
    (p_state - array['tax_identifier_fingerprint','evidence_reference',
      'eligibility_evidence_reference','form_2117_reference','certification_reference','sii_authorization_reference'])
    || pg_catalog.jsonb_build_object('evidencePresent',p_state->>'evidence_reference' is not null,
      'evidenceFingerprint',case when p_state->>'evidence_reference' is not null then
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_state->>'evidence_reference','UTF8'),'sha256'),'hex')
      else null end)
  end;
$$;

create function public.bhe_capture_authority_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  before_row jsonb; after_row jsonb := pg_catalog.to_jsonb(new);
  actor uuid; actor_kind text := 'PLATFORM_ADMIN'; change_reason text;
  entity_domain text; entity_id uuid; entity_version bigint; generation_value bigint; action_value text;
begin
  if tg_op='UPDATE' then before_row:=pg_catalog.to_jsonb(old); end if;
  if tg_table_name='tenant_bhe_automation_settings' then
    entity_domain:='LEGACY_SETTINGS'; entity_id:=new.tenant_id;
    -- The existing provisioning trigger is the only application path that
    -- creates these defaults. This system event never attests to authority.
    if tg_op='INSERT' and after_row->>'authorization_status'='not_configured'
       and after_row->>'automation_mode'='external_manual'
       and not new.automation_enabled then
      actor_kind:='SYSTEM'; actor:=null;
      change_reason:='Create disabled legacy BHE defaults'; action_value:='DEFAULT_CREATED';
    else
      actor:=public.bhe_require_platform_actor();
      change_reason:=nullif(pg_catalog.current_setting('citaya.bhe_change_reason',true),'');
      action_value:='LEGACY_DISABLED';
    end if;
  else
    actor:=public.bhe_require_platform_actor();
    change_reason:=nullif(pg_catalog.current_setting('citaya.bhe_change_reason',true),'');
    entity_domain:=case when tg_table_name='bhe_issuers' then 'ISSUER' else after_row->>'domain' end;
    entity_id:=new.id; entity_version:=new.version;
    action_value:=case when tg_op='INSERT' then 'CREATED'
      else (before_row->>'status')||'_TO_'||(after_row->>'status') end;
  end if;
  if change_reason is null then raise exception 'BHE_AUDIT_CONTEXT_REQUIRED'; end if;
  insert into public.bhe_authority_controls(tenant_id) values(new.tenant_id)
    on conflict(tenant_id) do nothing;
  update public.bhe_authority_controls
    set generation=generation+1,requires_explicit_enablement=true,updated_at=pg_catalog.clock_timestamp()
    where tenant_id=new.tenant_id returning generation into generation_value;
  insert into public.bhe_authority_audit(tenant_id,domain,entity_id,action,actor_kind,
    actor_user_id,reason,previous_state,new_state,occurred_at,entity_version,generation)
  values(new.tenant_id,entity_domain,entity_id,action_value,actor_kind,actor,change_reason,
    public.bhe_audit_state(before_row),public.bhe_audit_state(after_row),pg_catalog.clock_timestamp(),
    coalesce(entity_version,generation_value),generation_value);
  return new;
end;
$$;

create function public.bhe_deny_history_mutation()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  raise exception 'BHE_HISTORY_APPEND_ONLY';
end;
$$;

create trigger bhe_issuers_stamp before insert or update on public.bhe_issuers
  for each row execute function public.bhe_stamp_authority_entity();
create trigger bhe_records_stamp before insert or update on public.bhe_authority_records
  for each row execute function public.bhe_stamp_authority_entity();
create trigger bhe_issuers_audit after insert or update on public.bhe_issuers
  for each row execute function public.bhe_capture_authority_change();
create trigger bhe_records_audit after insert or update on public.bhe_authority_records
  for each row execute function public.bhe_capture_authority_change();
create trigger bhe_legacy_settings_audit after insert or update on public.tenant_bhe_automation_settings
  for each row execute function public.bhe_capture_authority_change();
create trigger bhe_audit_immutable before update or delete or truncate on public.bhe_authority_audit
  for each statement execute function public.bhe_deny_history_mutation();
create trigger bhe_legacy_audit_immutable before update or delete or truncate on public.tenant_bhe_automation_audit
  for each statement execute function public.bhe_deny_history_mutation();
create trigger bhe_records_history before delete or truncate on public.bhe_authority_records
  for each statement execute function public.bhe_deny_history_mutation();
create trigger bhe_issuers_history before delete or truncate on public.bhe_issuers
  for each statement execute function public.bhe_deny_history_mutation();

create function public.bhe_disable_legacy_automation(p_tenant_id uuid,p_status text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
  perform public.bhe_require_platform_actor();
  update public.tenant_bhe_automation_settings
    set automation_enabled=false,
      authorization_status=case when p_status in ('SUSPENDED','REVOKED')
        then pg_catalog.lower(p_status) else authorization_status end,
      updated_at=pg_catalog.clock_timestamp(),updated_by=auth.uid()
    where tenant_id=p_tenant_id and (automation_enabled
      or (p_status in ('SUSPENDED','REVOKED') and authorization_status='authorized'));
end;
$$;

create function public.bhe_register_issuer(
  p_tenant_id uuid,p_tax_identifier text,p_evidence_reference text,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid; normalized text; result public.bhe_issuers%rowtype;
begin
  actor:=public.bhe_prepare_authority_change(p_tenant_id,p_reason);
  begin
    normalized:=public.normalize_chilean_rut(p_tax_identifier);
    if normalized is null then raise exception 'BHE_TAX_IDENTIFIER_INVALID'; end if;
  exception when others then raise exception 'BHE_TAX_IDENTIFIER_INVALID'; end;
  if p_evidence_reference is null or pg_catalog.length(pg_catalog.btrim(p_evidence_reference)) not between 3 and 300 then
    raise exception 'BHE_EVIDENCE_REQUIRED';
  end if;
  if exists(select 1 from public.bhe_issuers where tenant_id=p_tenant_id and status<>'INACTIVE') then
    raise exception 'BHE_CURRENT_ISSUER_EXISTS';
  end if;
  insert into public.bhe_issuers(tenant_id,tax_identifier_fingerprint,evidence_reference,created_by,updated_by)
  values(p_tenant_id,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    p_tenant_id::text||':'||normalized,'UTF8'),'sha256'),'hex'),pg_catalog.btrim(p_evidence_reference),actor,actor)
  returning * into result;
  perform public.bhe_disable_legacy_automation(p_tenant_id);
  return pg_catalog.jsonb_build_object('id',result.id,'status',result.status,'version',result.version);
end;
$$;

create function public.bhe_transition_issuer(
  p_tenant_id uuid,p_issuer_id uuid,p_expected_version bigint,p_new_status text,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid; item public.bhe_issuers%rowtype;
begin
  actor:=public.bhe_prepare_authority_change(p_tenant_id,p_reason);
  select * into item from public.bhe_issuers where tenant_id=p_tenant_id and id=p_issuer_id for update;
  if not found then raise exception 'BHE_ISSUER_NOT_FOUND'; end if;
  if p_expected_version is distinct from item.version then raise exception 'BHE_CONCURRENT_MODIFICATION'; end if;
  if not coalesce((item.status='UNVERIFIED' and p_new_status in ('VERIFIED','INACTIVE'))
    or (item.status='VERIFIED' and p_new_status='INACTIVE'),false) then
    raise exception 'BHE_INVALID_TRANSITION';
  end if;
  update public.bhe_issuers set status=p_new_status,
    verified_at=case when p_new_status='VERIFIED' then pg_catalog.clock_timestamp() else verified_at end,
    verified_by=case when p_new_status='VERIFIED' then actor else verified_by end
    where tenant_id=p_tenant_id and id=p_issuer_id returning * into item;
  perform public.bhe_disable_legacy_automation(p_tenant_id);
  return pg_catalog.jsonb_build_object('id',item.id,'status',item.status,'version',item.version);
end;
$$;

create function public.bhe_require_current_parent(
  p_tenant_id uuid,p_issuer_id uuid,p_domain text,p_parent_id uuid
) returns void language plpgsql stable security definer set search_path=''
as $$
declare item public.bhe_authority_records%rowtype; expected_domain text; expected_status text;
begin
  if not exists(select 1 from public.bhe_issuers where tenant_id=p_tenant_id and id=p_issuer_id and status='VERIFIED') then
    raise exception 'BHE_ISSUER_NOT_VERIFIED';
  end if;
  if p_domain='ELIGIBILITY' then
    if p_parent_id is not null then raise exception 'BHE_PARENT_INVALID'; end if;
    return;
  end if;
  expected_domain:=case p_domain when 'APPLICATION' then 'ELIGIBILITY'
    when 'CERTIFICATION' then 'APPLICATION' when 'AUTHORIZATION' then 'CERTIFICATION' end;
  expected_status:=case p_domain when 'APPLICATION' then 'ELIGIBLE'
    when 'CERTIFICATION' then 'APPROVED' when 'AUTHORIZATION' then 'VALID' end;
  select * into item from public.bhe_authority_records where tenant_id=p_tenant_id
    and issuer_id=p_issuer_id and id=p_parent_id and domain=expected_domain;
  if not found then raise exception 'BHE_PARENT_INVALID'; end if;
  if item.status<>expected_status or item.evidence_verified_at is null
     or item.evidence_verified_by is null or item.evidence_reference is null
     or (item.valid_from is not null and item.valid_from>pg_catalog.statement_timestamp())
     or (item.valid_until is not null and item.valid_until<=pg_catalog.statement_timestamp())
     or exists(select 1 from public.bhe_authority_records newer where newer.tenant_id=p_tenant_id
       and newer.issuer_id=p_issuer_id and newer.domain=expected_domain and newer.revision>item.revision) then
    raise exception 'BHE_PARENT_NOT_READY';
  end if;
  perform public.bhe_require_current_parent(p_tenant_id,p_issuer_id,item.domain,item.parent_id);
end;
$$;

create function public.bhe_open_authority_record(
  p_tenant_id uuid,p_issuer_id uuid,p_domain text,p_parent_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid; item public.bhe_authority_records%rowtype; next_revision bigint;
begin
  actor:=public.bhe_prepare_authority_change(p_tenant_id,p_reason);
  if p_domain is null or p_domain not in ('ELIGIBILITY','APPLICATION','CERTIFICATION','AUTHORIZATION') then
    raise exception 'BHE_DOMAIN_INVALID';
  end if;
  perform public.bhe_require_current_parent(p_tenant_id,p_issuer_id,p_domain,p_parent_id);
  if exists(select 1 from public.bhe_authority_records where tenant_id=p_tenant_id
    and issuer_id=p_issuer_id and domain=p_domain
    and status in ('NOT_ASSESSED','UNDER_REVIEW','DRAFT','SUBMITTED','NOT_STARTED','IN_PROGRESS','VALID','NOT_GRANTED','ACTIVE','SUSPENDED')) then
    raise exception 'BHE_OPEN_RECORD_EXISTS';
  end if;
  select coalesce(pg_catalog.max(revision),0)+1 into next_revision from public.bhe_authority_records
    where tenant_id=p_tenant_id and issuer_id=p_issuer_id and domain=p_domain;
  insert into public.bhe_authority_records(tenant_id,issuer_id,domain,revision,parent_id,parent_domain,status,created_by,updated_by)
  values(p_tenant_id,p_issuer_id,p_domain,next_revision,p_parent_id,
    case p_domain when 'APPLICATION' then 'ELIGIBILITY' when 'CERTIFICATION' then 'APPLICATION' when 'AUTHORIZATION' then 'CERTIFICATION' end,
    case p_domain when 'ELIGIBILITY' then 'NOT_ASSESSED' when 'APPLICATION' then 'DRAFT' when 'CERTIFICATION' then 'NOT_STARTED' when 'AUTHORIZATION' then 'NOT_GRANTED' end,
    actor,actor) returning * into item;
  perform public.bhe_disable_legacy_automation(p_tenant_id);
  return pg_catalog.jsonb_build_object('id',item.id,'domain',item.domain,'status',item.status,'revision',item.revision,'version',item.version);
end;
$$;

create function public.bhe_transition_authority_record(
  p_tenant_id uuid,p_record_id uuid,p_expected_version bigint,p_new_status text,p_reason text,
  p_evidence_reference text default null,p_valid_from timestamptz default null,p_valid_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid; item public.bhe_authority_records%rowtype; permitted boolean; positive boolean;
begin
  actor:=public.bhe_prepare_authority_change(p_tenant_id,p_reason);
  select * into item from public.bhe_authority_records where tenant_id=p_tenant_id and id=p_record_id for update;
  if not found then raise exception 'BHE_RECORD_NOT_FOUND'; end if;
  if p_expected_version is distinct from item.version then raise exception 'BHE_CONCURRENT_MODIFICATION'; end if;
  permitted:=case item.domain
    when 'ELIGIBILITY' then (item.status='NOT_ASSESSED' and p_new_status='UNDER_REVIEW')
      or (item.status='UNDER_REVIEW' and p_new_status in ('ELIGIBLE','INELIGIBLE'))
    when 'APPLICATION' then (item.status='DRAFT' and p_new_status in ('SUBMITTED','WITHDRAWN'))
      or (item.status='SUBMITTED' and p_new_status in ('UNDER_REVIEW','WITHDRAWN'))
      or (item.status='UNDER_REVIEW' and p_new_status in ('APPROVED','REJECTED','WITHDRAWN'))
    when 'CERTIFICATION' then (item.status='NOT_STARTED' and p_new_status='IN_PROGRESS')
      or (item.status='IN_PROGRESS' and p_new_status in ('VALID','FAILED'))
      or (item.status='VALID' and p_new_status='INVALIDATED')
    when 'AUTHORIZATION' then (item.status='NOT_GRANTED' and p_new_status in ('ACTIVE','REVOKED'))
      or (item.status='ACTIVE' and p_new_status in ('SUSPENDED','REVOKED'))
      or (item.status='SUSPENDED' and p_new_status in ('ACTIVE','REVOKED'))
    else false end;
  if permitted is not true then raise exception 'BHE_INVALID_TRANSITION'; end if;
  positive:=p_new_status in ('ELIGIBLE','APPROVED','VALID','ACTIVE');
  if positive or p_new_status in ('SUBMITTED','UNDER_REVIEW','IN_PROGRESS') then
    perform public.bhe_require_current_parent(p_tenant_id,item.issuer_id,item.domain,item.parent_id);
    if exists(select 1 from public.bhe_authority_records newer where newer.tenant_id=p_tenant_id
      and newer.issuer_id=item.issuer_id and newer.domain=item.domain and newer.revision>item.revision) then
      raise exception 'BHE_RECORD_SUPERSEDED';
    end if;
  end if;
  if positive and (p_evidence_reference is null or pg_catalog.length(pg_catalog.btrim(p_evidence_reference)) not between 3 and 300) then
    raise exception 'BHE_EVIDENCE_REQUIRED';
  end if;
  if p_evidence_reference is not null and pg_catalog.length(pg_catalog.btrim(p_evidence_reference)) not between 3 and 300 then
    raise exception 'BHE_EVIDENCE_REQUIRED';
  end if;
  -- Dates describe supplied evidence only; changing them requires explicit new
  -- evidence. Omitting evidence preserves dates, including during suspension.
  if (p_valid_from is not null or p_valid_until is not null) and p_evidence_reference is null then
    raise exception 'BHE_VALIDITY_REQUIRES_EVIDENCE';
  end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until<p_valid_from then
    raise exception 'BHE_VALIDITY_INVALID';
  end if;
  update public.bhe_authority_records set status=p_new_status,
    evidence_reference=coalesce(pg_catalog.btrim(p_evidence_reference),evidence_reference),
    evidence_verified_at=case when p_evidence_reference is not null then pg_catalog.clock_timestamp() else evidence_verified_at end,
    evidence_verified_by=case when p_evidence_reference is not null then actor else evidence_verified_by end,
    valid_from=case when p_evidence_reference is not null then p_valid_from else valid_from end,
    valid_until=case when p_evidence_reference is not null then p_valid_until else valid_until end
    where tenant_id=p_tenant_id and id=p_record_id returning * into item;
  perform public.bhe_disable_legacy_automation(p_tenant_id,
    case when item.domain='AUTHORIZATION' then p_new_status else null end);
  return pg_catalog.jsonb_build_object('id',item.id,'domain',item.domain,'status',item.status,'revision',item.revision,'version',item.version);
end;
$$;

create function public.tenant_bhe_authority_report(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  issuer public.bhe_issuers%rowtype;
  eligibility public.bhe_authority_records%rowtype;
  application public.bhe_authority_records%rowtype;
  certification public.bhe_authority_records%rowtype;
  authorization_record public.bhe_authority_records%rowtype;
  authority_control public.bhe_authority_controls%rowtype;
  control_valid boolean;
  issuer_verified boolean; authorization_active boolean; evidence_complete boolean; chain_ready boolean;
begin
  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    if pg_catalog.current_setting('role',true) is distinct from 'authenticated' or auth.role() is distinct from 'authenticated'
       or auth.uid() is null or not (public.is_platform_admin(auth.uid()) or public.is_tenant_member(p_tenant_id,auth.uid())) then
      raise exception 'BHE_AUTHORITY_REPORT_FORBIDDEN';
    end if;
  end if;
  select * into authority_control from public.bhe_authority_controls where tenant_id=p_tenant_id;
  -- A ready chain must have its control and the generation of its latest audit.
  -- Missing or inconsistent controls stay visible; this read never repairs them.
  control_valid:=coalesce(authority_control.tenant_id is not null
    and authority_control.requires_explicit_enablement is true
    and authority_control.generation>0
    and authority_control.generation=(select pg_catalog.max(generation)
      from public.bhe_authority_audit where tenant_id=p_tenant_id),false);
  select * into issuer from public.bhe_issuers where tenant_id=p_tenant_id and status<>'INACTIVE';
  select * into eligibility from public.bhe_authority_records where tenant_id=p_tenant_id and issuer_id=issuer.id and domain='ELIGIBILITY' order by revision desc limit 1;
  select * into application from public.bhe_authority_records where tenant_id=p_tenant_id and issuer_id=issuer.id and domain='APPLICATION' order by revision desc limit 1;
  select * into certification from public.bhe_authority_records where tenant_id=p_tenant_id and issuer_id=issuer.id and domain='CERTIFICATION' order by revision desc limit 1;
  select * into authorization_record from public.bhe_authority_records where tenant_id=p_tenant_id and issuer_id=issuer.id and domain='AUTHORIZATION' order by revision desc limit 1;
  issuer_verified:=coalesce(issuer.status='VERIFIED' and issuer.verified_at is not null and issuer.verified_by is not null,false);
  authorization_active:=coalesce(issuer_verified and authorization_record.status='ACTIVE'
    and (authorization_record.valid_from is null or authorization_record.valid_from<=pg_catalog.statement_timestamp())
    and (authorization_record.valid_until is null or authorization_record.valid_until>pg_catalog.statement_timestamp()),false);
  evidence_complete:=issuer_verified and not exists(
    select 1 from (values (eligibility.evidence_reference,eligibility.evidence_verified_at,eligibility.evidence_verified_by),
      (application.evidence_reference,application.evidence_verified_at,application.evidence_verified_by),
      (certification.evidence_reference,certification.evidence_verified_at,certification.evidence_verified_by),
      (authorization_record.evidence_reference,authorization_record.evidence_verified_at,authorization_record.evidence_verified_by)) e(ref,at_time,actor)
    where ref is null or at_time is null or actor is null);
  chain_ready:=coalesce(application.parent_id=eligibility.id and certification.parent_id=application.id
    and authorization_record.parent_id=certification.id and eligibility.status='ELIGIBLE'
    and application.status='APPROVED' and certification.status='VALID',false)
    and not exists(select 1 from (values (eligibility.valid_from,eligibility.valid_until),
      (application.valid_from,application.valid_until),(certification.valid_from,certification.valid_until)) v(starts,ends)
      where starts>pg_catalog.statement_timestamp() or ends<=pg_catalog.statement_timestamp());
  return pg_catalog.jsonb_build_object(
    'issuerVerified',issuer_verified,'eligibilityStatus',coalesce(eligibility.status,'NOT_ASSESSED'),
    'applicationStatus',coalesce(application.status,'DRAFT'),'certificationStatus',coalesce(certification.status,'NOT_STARTED'),
    'authorizationStatus',coalesce(authorization_record.status,'NOT_GRANTED'),'authorizationActive',authorization_active,
    'evidenceComplete',evidence_complete,'controlReady',control_valid and authorization_active and evidence_complete and chain_ready,
    'generation',coalesce(authority_control.generation,0),
    'requiresExplicitEnablement',true,'executionEnabled',false);
end;
$$;

-- Freeze the old configuration and its old audit. Default provisioning still
-- inserts only the original OFF profile through the pre-existing definer trigger.
revoke all on table public.tenant_bhe_automation_settings,public.tenant_bhe_automation_audit
  from public,anon,authenticated,service_role;
grant select on table public.tenant_bhe_automation_settings to service_role;
revoke all on function public.ensure_tenant_bhe_automation_settings() from public,anon,authenticated,service_role;

-- Close every helper and trigger function, including inherited Supabase grants.
revoke all on function public.bhe_require_platform_actor(),public.bhe_prepare_authority_change(uuid,text),
  public.bhe_stamp_authority_entity(),public.bhe_audit_state(jsonb),public.bhe_capture_authority_change(),
  public.bhe_deny_history_mutation(),public.bhe_disable_legacy_automation(uuid,text),
  public.bhe_require_current_parent(uuid,uuid,text,uuid),
  public.bhe_register_issuer(uuid,text,text,text),public.bhe_transition_issuer(uuid,uuid,bigint,text,text),
  public.bhe_open_authority_record(uuid,uuid,text,uuid,text),
  public.bhe_transition_authority_record(uuid,uuid,bigint,text,text,text,timestamptz,timestamptz),
  public.tenant_bhe_authority_report(uuid) from public,anon,authenticated,service_role;
grant execute on function public.bhe_register_issuer(uuid,text,text,text),
  public.bhe_transition_issuer(uuid,uuid,bigint,text,text),public.bhe_open_authority_record(uuid,uuid,text,uuid,text),
  public.bhe_transition_authority_record(uuid,uuid,bigint,text,text,text,timestamptz,timestamptz)
  to authenticated;
grant execute on function public.tenant_bhe_authority_report(uuid) to authenticated,service_role;

grant select on table public.bhe_authority_audit to authenticated;
create policy bhe_authority_audit_platform_read on public.bhe_authority_audit for select to authenticated
  using (public.is_platform_admin(auth.uid()));

comment on table public.tenant_bhe_automation_settings is
  'Legacy 003 snapshot. No application DML, no backfill, no authority promotion. OFF at installation; only audited disabling is allowed by phase 1A RPCs.';
comment on table public.tenant_bhe_automation_audit is
  'Frozen legacy history. All new authority and legacy disabling events are recorded by DB triggers in bhe_authority_audit.';
comment on function public.tenant_bhe_authority_report(uuid) is
  'Read-only administrative completeness, not execution permission. Independent of the operational capability resolver until phase 1B.';

commit;
