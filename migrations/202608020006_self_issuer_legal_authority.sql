-- Self-issuer authority is legal/administrative evidence, separate from both
-- SII type authorization and an external tenant mandate. This migration is
-- additive and never creates evidence, publishes documents, enables DTE,
-- imports CAFs, allocates folios or changes tenant classifications.

create or replace function public.is_valid_chilean_rut(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path=pg_catalog
as $$
begin
  perform public.normalize_chilean_rut(p_value);
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.tenant_tax_identity_complete(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select exists(
    select 1
    from public.dte_production_tenant_settings d
    where d.tenant_id=p_tenant_id
      and pg_catalog.length(pg_catalog.btrim(d.issuer_legal_name))>=2
      and public.is_valid_chilean_rut(d.issuer_rut)
      and pg_catalog.length(pg_catalog.btrim(d.issuer_activity))>=2
      and pg_catalog.length(pg_catalog.btrim(d.issuer_address))>=5
      and pg_catalog.length(pg_catalog.btrim(d.issuer_commune))>=2
      and pg_catalog.length(pg_catalog.btrim(d.issuer_city))>=2
  );
$$;

create or replace function public.tenant_tax_identity_fingerprint(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select case when public.tenant_tax_identity_complete(p_tenant_id) then
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      public.normalize_chilean_rut(d.issuer_rut)||E'\n'||
      pg_catalog.btrim(d.issuer_legal_name)||E'\n'||
      pg_catalog.btrim(d.issuer_activity)||E'\n'||
      pg_catalog.btrim(d.issuer_address)||E'\n'||
      pg_catalog.btrim(d.issuer_commune)||E'\n'||
      pg_catalog.btrim(d.issuer_city),
      'UTF8'),'sha256'::text),'hex')
  else null end
  from public.dte_production_tenant_settings d
  where d.tenant_id=p_tenant_id;
$$;

alter table public.tenant_legal_profiles
  alter column handles_sensitive_data drop not null,
  alter column handles_sensitive_data set default null,
  add column if not exists sensitive_data_review_status text not null default 'pending'
    check (sensitive_data_review_status in ('pending','confirmed_no','confirmed_yes'));

alter table public.tenant_legal_profiles
  drop constraint if exists tenant_legal_profiles_sensitive_review_shape;
alter table public.tenant_legal_profiles
  add constraint tenant_legal_profiles_sensitive_review_shape check (
    sensitive_data_review_status='pending' or
    (sensitive_data_review_status='confirmed_no'
      and handles_sensitive_data=false and sensitive_data_purpose is null) or
    (sensitive_data_review_status='confirmed_yes'
      and handles_sensitive_data=true
      and pg_catalog.length(pg_catalog.btrim(coalesce(sensitive_data_purpose,''))) between 10 and 1000)
  );

create table public.tenant_self_issuer_authority_events (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  authority_id uuid not null,
  event_type text not null check (event_type in ('granted','revoked')),
  issuer_rut_snapshot text not null,
  tax_identity_fingerprint text not null
    check (tax_identity_fingerprint ~ '^[a-f0-9]{64}$'),
  evidence_fingerprint text not null
    check (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  administrative_reference text not null
    check (pg_catalog.length(pg_catalog.btrim(administrative_reference)) between 3 and 300),
  reason text not null
    check (pg_catalog.length(pg_catalog.btrim(reason)) between 10 and 500),
  actor_user_id uuid not null,
  actor_role_snapshot text not null check (actor_role_snapshot='super_admin'),
  occurred_at timestamptz not null default pg_catalog.now(),
  unique (tenant_id,id),
  unique (tenant_id,event_type,evidence_fingerprint),
  foreign key (tenant_id,authority_id)
    references public.tenant_self_issuer_authority_events(tenant_id,id)
    on delete restrict,
  check (
    (event_type='granted' and id=authority_id) or
    (event_type='revoked' and id<>authority_id)
  ),
  check (issuer_rut_snapshot=public.normalize_chilean_rut(issuer_rut_snapshot))
);

create unique index tenant_self_issuer_one_revocation_idx
  on public.tenant_self_issuer_authority_events(tenant_id,authority_id)
  where event_type='revoked';
create index tenant_self_issuer_tenant_time_idx
  on public.tenant_self_issuer_authority_events(tenant_id,occurred_at desc);

create or replace function public.tenant_self_issuer_authority_event_guard()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_master_rut text;
  v_master_fingerprint text;
  v_grant public.tenant_self_issuer_authority_events%rowtype;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'SELF_ISSUER_AUTHORITY_APPEND_ONLY';
  end if;
  if not public.is_platform_admin(new.actor_user_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if not public.is_valid_chilean_rut(new.issuer_rut_snapshot) then
    raise exception 'RUT_INVALID';
  end if;
  if new.event_type='granted' then
    select public.normalize_chilean_rut(d.issuer_rut),
           public.tenant_tax_identity_fingerprint(new.tenant_id)
      into v_master_rut,v_master_fingerprint
    from public.dte_production_tenant_settings d
    where d.tenant_id=new.tenant_id;
    if v_master_rut is null or v_master_rut<>new.issuer_rut_snapshot
       or v_master_fingerprint is null
       or v_master_fingerprint<>new.tax_identity_fingerprint then
      raise exception 'SELF_ISSUER_TAX_IDENTITY_MISMATCH';
    end if;
    if not exists(select 1 from public.tenants t
        where t.id=new.tenant_id and t.lifecycle_status='active'
          and t.operational_mode='internal')
       or not exists(select 1 from public.tenant_legal_profiles l
        where l.tenant_id=new.tenant_id and l.tenant_is_service_provider) then
      raise exception 'SELF_ISSUER_TENANT_NOT_INTERNAL_ACTIVE';
    end if;
  else
    select * into v_grant
    from public.tenant_self_issuer_authority_events e
    where e.tenant_id=new.tenant_id and e.id=new.authority_id
      and e.event_type='granted';
    if not found
       or v_grant.issuer_rut_snapshot<>new.issuer_rut_snapshot
       or v_grant.tax_identity_fingerprint<>new.tax_identity_fingerprint then
      raise exception 'SELF_ISSUER_GRANT_NOT_FOUND';
    end if;
  end if;
  return new;
end;
$$;

create trigger tenant_self_issuer_authority_events_guard
before insert or update or delete on public.tenant_self_issuer_authority_events
for each row execute function public.tenant_self_issuer_authority_event_guard();

create or replace function public.register_tenant_self_issuer_authority(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_issuer_rut_snapshot text,
  p_reason text,
  p_administrative_reference text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_authority_id uuid;
  v_normalized_rut text;
  v_master_rut text;
  v_tax_fingerprint text;
  v_evidence_fingerprint text;
begin
  if not public.is_platform_admin(p_actor_user_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,''))) not between 10 and 500
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_administrative_reference,''))) not between 3 and 300 then
    raise exception 'SELF_ISSUER_EVIDENCE_INPUT_INVALID';
  end if;
  v_normalized_rut:=public.normalize_chilean_rut(p_issuer_rut_snapshot);
  select public.normalize_chilean_rut(d.issuer_rut),
         public.tenant_tax_identity_fingerprint(p_tenant_id)
    into v_master_rut,v_tax_fingerprint
  from public.dte_production_tenant_settings d
  where d.tenant_id=p_tenant_id;
  if v_master_rut is null or v_tax_fingerprint is null or v_normalized_rut<>v_master_rut then
    raise exception 'SELF_ISSUER_TAX_IDENTITY_MISMATCH';
  end if;
  if not exists(select 1 from public.tenants t
      where t.id=p_tenant_id and t.lifecycle_status='active' and t.operational_mode='internal')
     or not exists(select 1 from public.tenant_legal_profiles l
      where l.tenant_id=p_tenant_id and l.tenant_is_service_provider) then
    raise exception 'SELF_ISSUER_TENANT_NOT_INTERNAL_ACTIVE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('citaya:self-issuer:'||p_tenant_id::text,0));
  v_evidence_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    p_tenant_id::text||E'\nself-issued\n'||v_tax_fingerprint||E'\n'||
    pg_catalog.lower(pg_catalog.btrim(p_administrative_reference)),
    'UTF8'),'sha256'::text),'hex');

  select e.authority_id into v_authority_id
  from public.tenant_self_issuer_authority_events e
  where e.tenant_id=p_tenant_id and e.event_type='granted'
    and e.evidence_fingerprint=v_evidence_fingerprint;
  if found then return v_authority_id; end if;
  if exists(select 1 from public.tenant_self_issuer_authority_events grant_event
      where grant_event.tenant_id=p_tenant_id and grant_event.event_type='granted'
        and not exists(select 1 from public.tenant_self_issuer_authority_events revoke_event
          where revoke_event.tenant_id=grant_event.tenant_id
            and revoke_event.authority_id=grant_event.authority_id
            and revoke_event.event_type='revoked')) then
    raise exception 'SELF_ISSUER_AUTHORITY_ALREADY_ACTIVE';
  end if;

  v_authority_id:=pg_catalog.gen_random_uuid();
  insert into public.tenant_self_issuer_authority_events(
    id,tenant_id,authority_id,event_type,issuer_rut_snapshot,
    tax_identity_fingerprint,evidence_fingerprint,administrative_reference,
    reason,actor_user_id,actor_role_snapshot
  ) values(
    v_authority_id,p_tenant_id,v_authority_id,'granted',v_normalized_rut,
    v_tax_fingerprint,v_evidence_fingerprint,pg_catalog.btrim(p_administrative_reference),
    pg_catalog.btrim(p_reason),p_actor_user_id,'super_admin'
  );
  return v_authority_id;
end;
$$;

create or replace function public.revoke_tenant_self_issuer_authority(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_administrative_reference text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_grant public.tenant_self_issuer_authority_events%rowtype;
  v_revocation_id uuid;
  v_evidence_fingerprint text;
begin
  if not public.is_platform_admin(p_actor_user_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,''))) not between 10 and 500
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_administrative_reference,''))) not between 3 and 300 then
    raise exception 'SELF_ISSUER_EVIDENCE_INPUT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('citaya:self-issuer:'||p_tenant_id::text,0));
  select grant_event.* into v_grant
  from public.tenant_self_issuer_authority_events grant_event
  where grant_event.tenant_id=p_tenant_id and grant_event.event_type='granted'
  order by grant_event.occurred_at desc limit 1;
  if not found then raise exception 'SELF_ISSUER_ACTIVE_AUTHORITY_NOT_FOUND'; end if;

  select revoke_event.id into v_revocation_id
  from public.tenant_self_issuer_authority_events revoke_event
  where revoke_event.tenant_id=p_tenant_id
    and revoke_event.authority_id=v_grant.authority_id
    and revoke_event.event_type='revoked';
  if found then return v_revocation_id; end if;

  v_evidence_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    p_tenant_id::text||E'\nself-issued-revocation\n'||v_grant.authority_id::text||E'\n'||
    pg_catalog.lower(pg_catalog.btrim(p_administrative_reference)),
    'UTF8'),'sha256'::text),'hex');
  select e.id into v_revocation_id
  from public.tenant_self_issuer_authority_events e
  where e.tenant_id=p_tenant_id and e.event_type='revoked'
    and e.evidence_fingerprint=v_evidence_fingerprint;
  if found then return v_revocation_id; end if;

  v_revocation_id:=pg_catalog.gen_random_uuid();
  insert into public.tenant_self_issuer_authority_events(
    id,tenant_id,authority_id,event_type,issuer_rut_snapshot,
    tax_identity_fingerprint,evidence_fingerprint,administrative_reference,
    reason,actor_user_id,actor_role_snapshot
  ) values(
    v_revocation_id,p_tenant_id,v_grant.authority_id,'revoked',
    v_grant.issuer_rut_snapshot,v_grant.tax_identity_fingerprint,
    v_evidence_fingerprint,pg_catalog.btrim(p_administrative_reference),
    pg_catalog.btrim(p_reason),p_actor_user_id,'super_admin'
  );
  return v_revocation_id;
end;
$$;

create or replace function public.tenant_self_issuer_authority_report(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog
as $$
  with latest_grant as (
    select e.*
    from public.tenant_self_issuer_authority_events e
    where e.tenant_id=p_tenant_id and e.event_type='granted'
    order by e.occurred_at desc limit 1
  ), facts as (
    select
      g.id is not null evidence_exists,
      exists(select 1 from public.tenant_self_issuer_authority_events r
        where r.tenant_id=p_tenant_id and r.authority_id=g.authority_id
          and r.event_type='revoked') revoked,
      exists(select 1 from public.tenants t where t.id=p_tenant_id
        and t.lifecycle_status='active' and t.operational_mode='internal') internal_active,
      exists(select 1 from public.tenant_legal_profiles l where l.tenant_id=p_tenant_id
        and l.tenant_is_service_provider) service_provider_profile,
      public.tenant_tax_identity_complete(p_tenant_id) tax_identity_complete,
      coalesce(g.issuer_rut_snapshot=(select case when public.is_valid_chilean_rut(d.issuer_rut)
        then public.normalize_chilean_rut(d.issuer_rut) else null end
        from public.dte_production_tenant_settings d where d.tenant_id=p_tenant_id),false) rut_matches,
      coalesce(g.tax_identity_fingerprint=public.tenant_tax_identity_fingerprint(p_tenant_id),false) identity_matches,
      coalesce(g.actor_role_snapshot='super_admin',false) platform_admin_evidence,
      g.authority_id,g.occurred_at,g.administrative_reference
    from latest_grant g right join (select 1) singleton on true
  ), result as (
    select *,evidence_exists and not revoked and internal_active
      and service_provider_profile and tax_identity_complete and rut_matches
      and identity_matches and platform_admin_evidence as valid
    from facts
  )
  select pg_catalog.jsonb_build_object(
    'kind','self_issued','status',case when not evidence_exists then 'none'
      when revoked then 'revoked' when valid then 'active' else 'invalidated' end,
    'valid',valid,'evidenceExists',evidence_exists,'revoked',revoked,
    'internalActive',internal_active,'serviceProviderProfile',service_provider_profile,
    'taxIdentityComplete',tax_identity_complete,'rutMatches',rut_matches,
    'identityMatches',identity_matches,'platformAdminEvidence',platform_admin_evidence,
    'authorityId',authority_id,'recordedAt',occurred_at,
    'administrativeReference',administrative_reference
  ) from result;
$$;

create or replace function public.tenant_dte_authority_report(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog
as $$
  with self_report as (
    select public.tenant_self_issuer_authority_report(p_tenant_id) value
  ), external_mandate as (
    select exists(select 1 from public.tenant_dte_mandates m
      join public.tenants t on t.id=m.tenant_id
      where m.tenant_id=p_tenant_id and t.lifecycle_status='active'
        and t.operational_mode<>'internal') valid
  )
  select pg_catalog.jsonb_build_object(
    'ready',case when coalesce((self_report.value->>'valid')::boolean,false)
      then true else external_mandate.valid end,
    'kind',case when coalesce((self_report.value->>'valid')::boolean,false)
      then 'self_issued' when external_mandate.valid then 'tenant_mandate' else 'none' end,
    'selfIssuerValid',coalesce((self_report.value->>'valid')::boolean,false),
    'externalMandateValid',external_mandate.valid
  ) from self_report cross join external_mandate;
$$;

create or replace function public.legal_document_guard()
returns trigger
language plpgsql
set search_path=pg_catalog
as $$
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception 'LEGAL_DOCUMENT_IMMUTABLE'; end if;
    return old;
  end if;
  new.content_sha256:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(new.content,'UTF8'),'sha256'::text),'hex');
  if pg_catalog.length(pg_catalog.btrim(new.content))<40 then
    raise exception 'LEGAL_DOCUMENT_CONTENT_INCOMPLETE';
  end if;
  if tg_op='UPDATE' and old.status in ('published','retired') then
    if old.owner_kind is distinct from new.owner_kind or old.tenant_id is distinct from new.tenant_id
       or old.document_type is distinct from new.document_type or old.version is distinct from new.version
       or old.title is distinct from new.title or old.content is distinct from new.content
       or old.content_sha256 is distinct from new.content_sha256
       or old.effective_at is distinct from new.effective_at
       or old.published_at is distinct from new.published_at
       or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at
       or (old.status='retired' and new.status<>'retired')
       or (old.status='published' and new.status not in ('published','retired')) then
      raise exception 'LEGAL_DOCUMENT_IMMUTABLE';
    end if;
  end if;
  if new.status='published' then
    if pg_catalog.strpos(pg_catalog.upper(new.content),'[PENDIENTE:')>0 then
      raise exception 'LEGAL_DOCUMENT_HAS_PENDING_FIELDS';
    end if;
    new.published_at:=coalesce(new.published_at,pg_catalog.now());
    new.effective_at:=coalesce(new.effective_at,new.published_at);
  elsif new.status='retired' then
    new.retired_at:=coalesce(new.retired_at,pg_catalog.now());
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

create or replace function public.revoke_marketing_consent(
  p_tenant_id uuid,p_channel text,p_destination text,p_reason text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare v_hash text;v_doc public.legal_documents%rowtype;v_event_id uuid;
begin
  if p_channel not in ('email','sms','whatsapp')
     or pg_catalog.length(pg_catalog.btrim(p_destination))<3 then
    raise exception 'MARKETING_REVOCATION_INVALID';
  end if;
  select * into v_doc from public.legal_documents d
  where d.tenant_id=p_tenant_id and d.owner_kind='tenant'
    and d.document_type='privacy_notice' and d.status='published'
    and d.effective_at<=pg_catalog.now();
  if not found then raise exception 'PRIVACY_NOTICE_NOT_PUBLISHED'; end if;
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.lower(pg_catalog.btrim(p_destination)),'UTF8'),'sha256'::text),'hex');
  insert into public.marketing_consent_events(
    tenant_id,channel,purpose,event_type,privacy_document_id,
    privacy_document_version,destination_hash,source_context
  ) values(p_tenant_id,p_channel,'Revocación de comunicaciones comerciales','revoked',
    v_doc.id,v_doc.version,v_hash,'unsubscribe') returning id into v_event_id;
  insert into public.marketing_suppressions(
    tenant_id,channel,destination_hash,reason,source_event_id
  ) values(p_tenant_id,p_channel,v_hash,pg_catalog.left(p_reason,500),v_event_id)
  on conflict (tenant_id,channel,destination_hash) do update set
    suppressed_at=pg_catalog.now(),reason=excluded.reason,source_event_id=excluded.source_event_id;
  return v_event_id;
end;
$$;

create or replace function public.accept_tenant_dte_mandate(
  p_tenant_id uuid,p_document_id uuid,p_actor_id uuid,p_signer_full_name text,
  p_signer_rut text,p_signer_capacity text,p_authority_confirmed boolean,
  p_declaration text,p_source_ip inet,p_user_agent text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare v_doc public.legal_documents%rowtype;v_acceptance_id uuid;
begin
  if not p_authority_confirmed then raise exception 'DTE_MANDATE_AUTHORITY_REQUIRED'; end if;
  if not exists(select 1 from public.tenants t where t.id=p_tenant_id
      and t.lifecycle_status='active' and t.operational_mode<>'internal') then
    raise exception 'DTE_MANDATE_EXTERNAL_TENANT_REQUIRED';
  end if;
  select * into v_doc from public.legal_documents d
  where d.id=p_document_id and d.status='published' and (
    (d.owner_kind='tenant' and d.tenant_id=p_tenant_id) or d.owner_kind='platform');
  if not found or v_doc.document_type<>'dte_mandate' then
    raise exception 'DTE_MANDATE_DOCUMENT_INVALID';
  end if;
  insert into public.legal_acceptances(
    tenant_id,document_id,document_version,document_hash,actor_type,actor_user_id,
    acceptance_context,accepted_declaration,source_ip,user_agent
  ) values(p_tenant_id,v_doc.id,v_doc.version,v_doc.content_sha256,'tenant_admin',p_actor_id,
    'dte_mandate',p_declaration,p_source_ip,pg_catalog.left(p_user_agent,500))
  returning id into v_acceptance_id;
  insert into public.tenant_dte_mandates(
    tenant_id,legal_acceptance_id,signer_full_name,signer_rut,signer_capacity,
    has_representative_authority,may_generate,may_sign,may_submit,may_query,
    may_retain,may_custody_certificate,may_custody_caf
  ) values(p_tenant_id,v_acceptance_id,pg_catalog.btrim(p_signer_full_name),
    public.normalize_chilean_rut(p_signer_rut),pg_catalog.btrim(p_signer_capacity),
    true,true,true,true,true,true,true,true);
  return v_acceptance_id;
end;
$$;

create or replace function public.legal_identity_complete(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select exists(
    select 1 from public.tenant_legal_profiles l
    join public.tenants t on t.id=l.tenant_id
    where l.tenant_id=p_tenant_id and l.administrative_review_status='complete'
      and l.tenant_is_service_provider
      and l.sensitive_data_review_status in ('confirmed_no','confirmed_yes')
      and ((l.sensitive_data_review_status='confirmed_no' and l.handles_sensitive_data=false)
        or (l.sensitive_data_review_status='confirmed_yes' and l.handles_sensitive_data=true
          and pg_catalog.length(pg_catalog.btrim(coalesce(l.sensitive_data_purpose,'')))>=10))
      and pg_catalog.length(pg_catalog.btrim(coalesce(l.trade_name,t.name,'')))>=2
      and pg_catalog.length(pg_catalog.btrim(coalesce(l.contact_address,t.address,'')))>=5
      and pg_catalog.length(pg_catalog.btrim(coalesce(l.support_email,t.contact_email,'')))>=3
      and pg_catalog.length(pg_catalog.btrim(coalesce(l.privacy_contact_name,'')))>=3
      and pg_catalog.length(pg_catalog.btrim(coalesce(l.privacy_contact_email,'')))>=3
      and public.tenant_tax_identity_complete(p_tenant_id)
  );
$$;

create or replace function public.create_public_appointment_with_legal_acceptance(
  p_tenant_id uuid,p_professional_id uuid,p_service_id uuid,p_start_at timestamptz,
  p_customer_id uuid,p_customer_name text,p_customer_phone text,p_customer_email text,
  p_notes text,p_payment_required boolean,p_payment_status text,p_manage_token_hash text,
  p_manage_token_expires_at timestamptz,p_idempotency_key text,p_legal jsonb,
  p_source_ip inet,p_user_agent text
) returns table(appointment_id uuid,duplicate boolean)
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_result record;v_kind text;v_doc public.legal_documents%rowtype;
  v_required text[]:=array['consumer_terms','privacy_notice','cancellation_refund_policy'];
  v_item jsonb;v_sensitive boolean;v_destination text;
begin
  if not public.legal_identity_complete(p_tenant_id) then
    raise exception 'LEGAL_IDENTITY_INCOMPLETE';
  end if;
  select l.handles_sensitive_data into v_sensitive
  from public.tenant_legal_profiles l
  where l.tenant_id=p_tenant_id and l.sensitive_data_review_status<>'pending';
  if not found or v_sensitive is null then raise exception 'SENSITIVE_DATA_REVIEW_PENDING'; end if;
  if v_sensitive then v_required:=pg_catalog.array_append(v_required,'sensitive_data_authorization'); end if;

  foreach v_kind in array v_required loop
    v_item:=p_legal->v_kind;
    select * into v_doc from public.legal_documents d
    where d.id=nullif(v_item->>'documentId','')::uuid
      and d.owner_kind='tenant' and d.tenant_id=p_tenant_id
      and d.document_type=v_kind and d.status='published' and d.effective_at<=pg_catalog.now()
      and d.version=(v_item->>'version')::integer and d.content_sha256=v_item->>'hash';
    if not found or coalesce((v_item->>'accepted')::boolean,false) is not true then
      raise exception 'LEGAL_ACCEPTANCE_REQUIRED';
    end if;
  end loop;

  select * into v_result from public.create_public_appointment(
    p_tenant_id,p_professional_id,p_service_id,p_start_at,p_customer_id,
    p_customer_name,p_customer_phone,p_customer_email,p_notes,p_payment_required,
    p_payment_status,p_manage_token_hash,p_manage_token_expires_at,p_idempotency_key);
  appointment_id:=v_result.appointment_id;duplicate:=v_result.duplicate;
  if duplicate then return next;return;end if;

  foreach v_kind in array v_required loop
    v_item:=p_legal->v_kind;
    select * into v_doc from public.legal_documents d where d.id=(v_item->>'documentId')::uuid;
    insert into public.legal_acceptances(
      tenant_id,document_id,document_version,document_hash,actor_type,customer_id,
      appointment_id,acceptance_context,accepted_declaration,source_ip,user_agent
    ) values(p_tenant_id,v_doc.id,v_doc.version,v_doc.content_sha256,'consumer',p_customer_id,
      appointment_id,'booking',pg_catalog.left(v_item->>'declaration',1000),
      p_source_ip,pg_catalog.left(p_user_agent,500));
  end loop;

  if coalesce((p_legal#>>'{marketing,accepted}')::boolean,false) then
    select * into v_doc from public.legal_documents d
    where d.id=(p_legal#>>'{privacy_notice,documentId}')::uuid
      and d.tenant_id=p_tenant_id and d.document_type='privacy_notice';
    v_destination:=pg_catalog.lower(pg_catalog.btrim(p_customer_email));
    insert into public.marketing_consent_events(
      tenant_id,customer_id,appointment_id,channel,purpose,event_type,
      privacy_document_id,privacy_document_version,destination_hash,source_context
    ) values(p_tenant_id,p_customer_id,appointment_id,'email',
      pg_catalog.left(p_legal#>>'{marketing,purpose}',500),'granted',v_doc.id,v_doc.version,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_destination,'UTF8'),'sha256'::text),'hex'),
      'booking');
  end if;
  return next;
end;
$$;

create or replace function public.tenant_legal_gate_report(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog
as $$
  with authority as (select public.tenant_dte_authority_report(p_tenant_id) value), facts as (
    select public.legal_identity_complete(p_tenant_id) identity_complete,
      public.tenant_tax_identity_complete(p_tenant_id) tax_data_complete,
      exists(select 1 from public.legal_documents d where d.tenant_id=p_tenant_id
        and d.owner_kind='tenant' and d.document_type='consumer_terms'
        and d.status='published' and d.effective_at<=pg_catalog.now()) terms_published,
      exists(select 1 from public.legal_documents d where d.tenant_id=p_tenant_id
        and d.owner_kind='tenant' and d.document_type='privacy_notice'
        and d.status='published' and d.effective_at<=pg_catalog.now()) privacy_published,
      exists(select 1 from public.legal_documents d where d.tenant_id=p_tenant_id
        and d.owner_kind='tenant' and d.document_type='cancellation_refund_policy'
        and d.status='published' and d.effective_at<=pg_catalog.now()) cancellation_published,
      coalesce((authority.value->>'ready')::boolean,false) authority_ready,
      coalesce((authority.value->>'externalMandateValid')::boolean,false) mandate_valid,
      coalesce((authority.value->>'selfIssuerValid')::boolean,false) self_issuer_valid,
      coalesce((select l.sensitive_data_review_status<>'pending'
        from public.tenant_legal_profiles l where l.tenant_id=p_tenant_id),false) sensitive_reviewed,
      coalesce((select case l.sensitive_data_review_status
        when 'confirmed_no' then true when 'confirmed_yes' then exists(
          select 1 from public.legal_documents d where d.tenant_id=p_tenant_id
            and d.owner_kind='tenant' and d.document_type='sensitive_data_authorization'
            and d.status='published' and d.effective_at<=pg_catalog.now()) else false end
        from public.tenant_legal_profiles l where l.tenant_id=p_tenant_id),false) sensitive_consent,
      authority.value->>'kind' authority_kind,
      coalesce((select l.sensitive_data_review_status
        from public.tenant_legal_profiles l where l.tenant_id=p_tenant_id),'pending') sensitive_status
    from authority
  ), boolean_gates as (
    select pg_catalog.jsonb_build_object(
      'identityLegalComplete',identity_complete,'taxDataComplete',tax_data_complete,
      'termsPublished',terms_published,'privacyPublished',privacy_published,
      'cancellationRefundPublished',cancellation_published,
      'dteAuthorityReady',authority_ready,'sensitiveDataReviewed',sensitive_reviewed,
      'sensitiveConsentConfigured',sensitive_consent
    ) value,* from facts
  )
  select value||pg_catalog.jsonb_build_object(
    'dteMandateAccepted',mandate_valid,'selfIssuerAuthorityValid',self_issuer_valid,
    'dteAuthorityKind',authority_kind,'sensitiveDataReviewStatus',sensitive_status,
    'ready',not exists(select 1 from pg_catalog.jsonb_each(value) e where e.value<>'true'::jsonb)
  ) from boolean_gates;
$$;

create or replace function public.legal_appointment_payment_ready(
  p_tenant_id uuid,p_appointment_id uuid
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.legal_identity_complete(p_tenant_id) and not exists(
    select 1 from pg_catalog.unnest(array[
      'consumer_terms','privacy_notice','cancellation_refund_policy']::text[]) required(document_type)
    where not exists(select 1 from public.legal_acceptances a
      join public.legal_documents d on d.id=a.document_id
      where a.tenant_id=p_tenant_id and a.appointment_id=p_appointment_id
        and a.acceptance_context='booking' and d.document_type=required.document_type)
  ) and exists(select 1 from public.tenant_legal_profiles l
    where l.tenant_id=p_tenant_id and (
      (l.sensitive_data_review_status='confirmed_no' and l.handles_sensitive_data=false) or
      (l.sensitive_data_review_status='confirmed_yes' and l.handles_sensitive_data=true and exists(
        select 1 from public.legal_acceptances a join public.legal_documents d on d.id=a.document_id
        where a.tenant_id=p_tenant_id and a.appointment_id=p_appointment_id
          and d.document_type='sensitive_data_authorization'))));
$$;

create or replace function public.dte_type39_enablement_gate_report(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog
as $$
  with reports as (
    select public.tenant_legal_gate_report(p_tenant_id) legal,
      public.tenant_dte_authority_report(p_tenant_id) authority,
      public.dte_activation_gate_report(p_tenant_id,39,true) technical,
      (select pg_catalog.to_jsonb(s) from public.dte_tenant_issuance_settings s
        where s.tenant_id=p_tenant_id) settings
  ), readiness as (
    select *,public.tenant_tax_identity_complete(p_tenant_id) tax_identity_ready,
      coalesce((authority->>'ready')::boolean,false) authority_ready,
      technical @> '{
        "issuerDataExact":true,"issuerLegalNameMatch":true,"typeAuthorized":true,
        "certificateCurrent":true,"certificateKeyMatch":true,"certificateRutMatch":true,
        "officialTrustAnchor":true,"tenantAwareLedger":true,"privateStorage":true,
        "productionEndpoints":true,"officialXsd":true,"xmlDsig":true,
        "workerConfigured":true,"migrationsApplied":true,"offlinePreflightComplete":true
      }'::jsonb certification_technical_ready,
      exists(select 1 from public.dte_tenant_document_capabilities c
        where c.tenant_id=p_tenant_id and c.environment='certification' and c.dte_type=39
          and c.certification_status in ('pre_caf_ready','caf_imported','set_submitted',
            'sii_approved','compliance_declared','production_authorized')
          and c.admin_draft_enabled and pg_catalog.length(pg_catalog.btrim(coalesce(c.endpoint_profile,'')))>0
          and pg_catalog.length(pg_catalog.btrim(coalesce(c.schema_version,'')))>0) certification_capability_ready,
      coalesce((legal->>'ready')::boolean,false) legal_ready,
      coalesce((technical->>'ready')::boolean,false) production_technical_ready,
      exists(select 1 from public.dte_tenant_document_capabilities c
        where c.tenant_id=p_tenant_id and c.environment='production' and c.dte_type=39
          and c.certification_status='production_authorized'
          and pg_catalog.length(pg_catalog.btrim(coalesce(c.endpoint_profile,'')))>0
          and pg_catalog.length(pg_catalog.btrim(coalesce(c.schema_version,'')))>0) production_capability_ready,
      coalesce(settings->>'boleta_payment_document_model','unconfigured')<>'unconfigured'
        and nullif(settings->>'boleta_model_verified_at','') is not null
        and nullif(settings->>'boleta_model_verified_by','') is not null
        and pg_catalog.length(pg_catalog.btrim(coalesce(settings->>'boleta_model_evidence_reference','')))>=3 model_ready,
      public.tenant_operational_capability_allowed(p_tenant_id,'enqueueDte') production_operational_ready
    from reports
  ), result as (
    select *,tax_identity_ready and authority_ready and certification_technical_ready
      and certification_capability_ready as certification_ready,
      legal_ready and production_technical_ready and production_capability_ready
      and model_ready and production_operational_ready as production_ready
    from readiness
  )
  select pg_catalog.jsonb_build_object(
    'legal',legal,'authority',authority,'technical',technical,
    'taxIdentityReady',tax_identity_ready,'authorityReady',authority_ready,
    'certificationTechnicalReady',certification_technical_ready,
    'certificationCapabilityReady',certification_capability_ready,
    'certificationReady',certification_ready,'legalReady',legal_ready,
    'technicalReady',production_technical_ready,'capabilityReady',production_capability_ready,
    'productionOperationalReady',production_operational_ready,
    'boletaPaymentDocumentModel',coalesce(settings->>'boleta_payment_document_model','unconfigured'),
    'boletaModelReady',model_ready,'productionIssuanceReady',production_ready,
    'ready',production_ready
  ) from result;
$$;

alter table public.tenant_self_issuer_authority_events enable row level security;
revoke all on public.tenant_self_issuer_authority_events from public,anon,authenticated;
grant select on public.tenant_self_issuer_authority_events to authenticated;
create policy tenant_self_issuer_authority_platform_read
  on public.tenant_self_issuer_authority_events
  for select to authenticated
  using(public.is_platform_admin(auth.uid()));

revoke all on function public.register_tenant_self_issuer_authority(uuid,uuid,text,text,text),
  public.revoke_tenant_self_issuer_authority(uuid,uuid,text,text),
  public.tenant_self_issuer_authority_report(uuid),
  public.tenant_dte_authority_report(uuid),public.tenant_tax_identity_complete(uuid),
  public.tenant_tax_identity_fingerprint(uuid),public.is_valid_chilean_rut(text),
  public.tenant_self_issuer_authority_event_guard()
  from public,anon,authenticated;
grant execute on function public.register_tenant_self_issuer_authority(uuid,uuid,text,text,text),
  public.revoke_tenant_self_issuer_authority(uuid,uuid,text,text),
  public.tenant_self_issuer_authority_report(uuid),
  public.tenant_dte_authority_report(uuid),public.tenant_tax_identity_complete(uuid),
  public.tenant_tax_identity_fingerprint(uuid),public.is_valid_chilean_rut(text)
  to service_role;

comment on table public.tenant_self_issuer_authority_events is
  'Append-only platform evidence for an internal tenant operating its own DTE; never substitutes an external tenant mandate or SII authorization.';
comment on column public.tenant_legal_profiles.sensitive_data_review_status is
  'Explicit legal review state. pending never means that sensitive data is absent.';
comment on function public.dte_type39_enablement_gate_report(uuid) is
  'Separates certification preparation from productive type 39 issuance; neither path mutates capabilities, CAFs, folios or issuance settings.';
