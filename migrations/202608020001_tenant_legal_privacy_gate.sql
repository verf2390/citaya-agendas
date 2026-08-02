-- Local-only legal/privacy gate. Applying this migration is a separate,
-- reviewed production operation. It never imports CAFs, reserves folios or
-- enables issuance.

create table public.tenant_legal_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  trade_name text,
  contact_address text,
  support_email text,
  support_phone text,
  privacy_contact_name text,
  privacy_contact_email text,
  tenant_is_service_provider boolean not null default false,
  handles_sensitive_data boolean not null default false,
  sensitive_data_purpose text,
  administrative_review_status text not null default 'draft'
    check (administrative_review_status in ('draft','complete')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (support_email is null or (length(trim(support_email)) between 3 and 254 and support_email like '%@%')),
  check (privacy_contact_email is null or (length(trim(privacy_contact_email)) between 3 and 254 and privacy_contact_email like '%@%')),
  check (
    handles_sensitive_data is false or
    length(trim(coalesce(sensitive_data_purpose,''))) between 10 and 1000
  )
);

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('tenant','platform')),
  tenant_id uuid references public.tenants(id) on delete restrict,
  document_type text not null check (document_type in (
    'consumer_terms','privacy_notice','cancellation_refund_policy',
    'sensitive_data_authorization','dte_mandate','saas_terms'
  )),
  version integer not null check (version > 0),
  title text not null check (length(trim(title)) between 3 and 180),
  content text not null,
  content_sha256 text not null,
  status text not null default 'draft'
    check (status in ('draft','published','retired')),
  effective_at timestamptz,
  published_at timestamptz,
  retired_at timestamptz,
  created_by uuid,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_kind='tenant' and tenant_id is not null) or
    (owner_kind='platform' and tenant_id is null)
  ),
  check (content_sha256 ~ '^[a-f0-9]{64}$'),
  check (
    status='draft' or
    (published_at is not null and effective_at is not null)
  )
);

create unique index legal_documents_tenant_version_uidx
  on public.legal_documents(tenant_id,document_type,version)
  where owner_kind='tenant';
create unique index legal_documents_platform_version_uidx
  on public.legal_documents(document_type,version)
  where owner_kind='platform';
create unique index legal_documents_one_published_tenant_uidx
  on public.legal_documents(tenant_id,document_type)
  where owner_kind='tenant' and status='published';
create unique index legal_documents_one_published_platform_uidx
  on public.legal_documents(document_type)
  where owner_kind='platform' and status='published';

create or replace function public.legal_document_guard()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    if old.status <> 'draft' then raise exception 'LEGAL_DOCUMENT_IMMUTABLE'; end if;
    return old;
  end if;

  new.content_sha256 := encode(digest(convert_to(new.content,'UTF8'),'sha256'),'hex');
  if length(trim(new.content)) < 40 then raise exception 'LEGAL_DOCUMENT_CONTENT_INCOMPLETE'; end if;

  if tg_op='UPDATE' and old.status in ('published','retired') then
    if old.owner_kind is distinct from new.owner_kind or
       old.tenant_id is distinct from new.tenant_id or
       old.document_type is distinct from new.document_type or
       old.version is distinct from new.version or
       old.title is distinct from new.title or
       old.content is distinct from new.content or
       old.content_sha256 is distinct from new.content_sha256 or
       old.effective_at is distinct from new.effective_at or
       old.published_at is distinct from new.published_at or
       old.created_by is distinct from new.created_by or
       old.created_at is distinct from new.created_at or
       (old.status='retired' and new.status <> 'retired') or
       (old.status='published' and new.status not in ('published','retired')) then
      raise exception 'LEGAL_DOCUMENT_IMMUTABLE';
    end if;
  end if;

  if new.status='published' then
    if position('[PENDIENTE:' in upper(new.content)) > 0 then
      raise exception 'LEGAL_DOCUMENT_HAS_PENDING_FIELDS';
    end if;
    new.published_at := coalesce(new.published_at,now());
    new.effective_at := coalesce(new.effective_at,new.published_at);
  elsif new.status='retired' then
    new.retired_at := coalesce(new.retired_at,now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger legal_document_guard
before insert or update or delete on public.legal_documents
for each row execute function public.legal_document_guard();

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  document_version integer not null,
  document_hash text not null check (document_hash ~ '^[a-f0-9]{64}$'),
  actor_type text not null check (actor_type in ('tenant_admin','consumer')),
  actor_user_id uuid,
  customer_id uuid references public.customers(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  acceptance_context text not null check (acceptance_context in (
    'booking','payment','saas_onboarding','dte_mandate'
  )),
  accepted_declaration text not null
    check (length(trim(accepted_declaration)) between 10 and 1000),
  source_ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 500),
  retention_until timestamptz not null default (now() + interval '6 years'),
  created_at timestamptz not null default now()
);
create index legal_acceptances_tenant_appointment_idx
  on public.legal_acceptances(tenant_id,appointment_id,accepted_at desc);

create or replace function public.append_only_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'APPEND_ONLY_RECORD';
end;
$$;
create trigger legal_acceptances_append_only
before update or delete on public.legal_acceptances
for each row execute function public.append_only_guard();

create or replace function public.legal_acceptance_tenant_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (
    select 1 from public.legal_documents d where d.id=new.document_id and (
      (d.owner_kind='tenant' and d.tenant_id=new.tenant_id) or
      (d.owner_kind='platform' and new.acceptance_context in ('saas_onboarding','dte_mandate'))
    ) and d.version=new.document_version and d.content_sha256=new.document_hash
  ) then raise exception 'LEGAL_EVIDENCE_TENANT_MISMATCH'; end if;
  if new.customer_id is not null and not exists (
    select 1 from public.customers c where c.id=new.customer_id and c.tenant_id=new.tenant_id
  ) then raise exception 'LEGAL_CUSTOMER_TENANT_MISMATCH'; end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id=new.appointment_id and a.tenant_id=new.tenant_id
  ) then raise exception 'LEGAL_APPOINTMENT_TENANT_MISMATCH'; end if;
  return new;
end;
$$;
create trigger legal_acceptance_tenant_guard
before insert on public.legal_acceptances
for each row execute function public.legal_acceptance_tenant_guard();

create table public.tenant_dte_mandates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  legal_acceptance_id uuid not null unique references public.legal_acceptances(id) on delete restrict,
  signer_full_name text not null check (length(trim(signer_full_name)) between 3 and 180),
  signer_rut text not null,
  signer_capacity text not null check (length(trim(signer_capacity)) between 2 and 180),
  has_representative_authority boolean not null check (has_representative_authority),
  may_generate boolean not null check (may_generate),
  may_sign boolean not null check (may_sign),
  may_submit boolean not null check (may_submit),
  may_query boolean not null check (may_query),
  may_retain boolean not null check (may_retain),
  may_custody_certificate boolean not null check (may_custody_certificate),
  may_custody_caf boolean not null check (may_custody_caf),
  evidence_kind text not null default 'electronic_contract_acceptance'
    check (evidence_kind='electronic_contract_acceptance'),
  accepted_at timestamptz not null default now(),
  check (signer_rut = public.normalize_chilean_rut(signer_rut))
);
create trigger tenant_dte_mandates_append_only
before update or delete on public.tenant_dte_mandates
for each row execute function public.append_only_guard();

create or replace function public.tenant_dte_mandate_tenant_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (select 1 from public.legal_acceptances a
    where a.id=new.legal_acceptance_id and a.tenant_id=new.tenant_id
      and a.acceptance_context='dte_mandate' and a.actor_type='tenant_admin') then
    raise exception 'DTE_MANDATE_TENANT_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger tenant_dte_mandate_tenant_guard
before insert on public.tenant_dte_mandates
for each row execute function public.tenant_dte_mandate_tenant_guard();

create table public.marketing_consent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  channel text not null check (channel in ('email','sms','whatsapp')),
  purpose text not null check (length(trim(purpose)) between 10 and 500),
  event_type text not null check (event_type in ('granted','revoked')),
  privacy_document_id uuid not null references public.legal_documents(id) on delete restrict,
  privacy_document_version integer not null,
  destination_hash text not null check (destination_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default now(),
  source_context text not null check (source_context in ('booking','admin','unsubscribe'))
);
create trigger marketing_consent_events_append_only
before update or delete on public.marketing_consent_events
for each row execute function public.append_only_guard();

create or replace function public.marketing_consent_tenant_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (select 1 from public.legal_documents d
    where d.id=new.privacy_document_id and d.owner_kind='tenant'
      and d.tenant_id=new.tenant_id and d.document_type='privacy_notice'
      and d.version=new.privacy_document_version) then
    raise exception 'MARKETING_DOCUMENT_TENANT_MISMATCH';
  end if;
  if new.customer_id is not null and not exists (select 1 from public.customers c
    where c.id=new.customer_id and c.tenant_id=new.tenant_id) then
    raise exception 'MARKETING_CUSTOMER_TENANT_MISMATCH';
  end if;
  if new.appointment_id is not null and not exists (select 1 from public.appointments a
    where a.id=new.appointment_id and a.tenant_id=new.tenant_id) then
    raise exception 'MARKETING_APPOINTMENT_TENANT_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger marketing_consent_tenant_guard
before insert on public.marketing_consent_events
for each row execute function public.marketing_consent_tenant_guard();

create table public.marketing_suppressions (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  channel text not null check (channel in ('email','sms','whatsapp')),
  destination_hash text not null check (destination_hash ~ '^[a-f0-9]{64}$'),
  suppressed_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) between 3 and 500),
  source_event_id uuid references public.marketing_consent_events(id) on delete restrict,
  primary key (tenant_id,channel,destination_hash)
);

create or replace function public.marketing_suppression_tenant_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.source_event_id is not null and not exists (
    select 1 from public.marketing_consent_events e
    where e.id=new.source_event_id and e.tenant_id=new.tenant_id
      and e.channel=new.channel and e.destination_hash=new.destination_hash
  ) then raise exception 'MARKETING_SUPPRESSION_TENANT_MISMATCH'; end if;
  return new;
end;
$$;
create trigger marketing_suppression_tenant_guard
before insert or update on public.marketing_suppressions
for each row execute function public.marketing_suppression_tenant_guard();

create or replace function public.revoke_marketing_consent(
  p_tenant_id uuid,p_channel text,p_destination text,p_reason text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_hash text; v_doc public.legal_documents%rowtype; v_event_id uuid;
begin
  if p_channel not in ('email','sms','whatsapp') or length(trim(p_destination)) < 3 then
    raise exception 'MARKETING_REVOCATION_INVALID';
  end if;
  select * into v_doc from public.legal_documents d
   where d.tenant_id=p_tenant_id and d.owner_kind='tenant'
     and d.document_type='privacy_notice' and d.status='published'
     and d.effective_at<=now();
  if not found then raise exception 'PRIVACY_NOTICE_NOT_PUBLISHED'; end if;
  v_hash := encode(digest(convert_to(lower(trim(p_destination)),'UTF8'),'sha256'),'hex');
  insert into public.marketing_consent_events(
    tenant_id,channel,purpose,event_type,privacy_document_id,
    privacy_document_version,destination_hash,source_context
  ) values (
    p_tenant_id,p_channel,'Revocación de comunicaciones comerciales','revoked',
    v_doc.id,v_doc.version,v_hash,'unsubscribe'
  ) returning id into v_event_id;
  insert into public.marketing_suppressions(
    tenant_id,channel,destination_hash,reason,source_event_id
  ) values (p_tenant_id,p_channel,v_hash,left(p_reason,500),v_event_id)
  on conflict (tenant_id,channel,destination_hash) do update set
    suppressed_at=now(),reason=excluded.reason,source_event_id=excluded.source_event_id;
  return v_event_id;
end;
$$;

create or replace function public.publish_legal_document(
  p_tenant_id uuid,
  p_document_id uuid,
  p_actor_id uuid,
  p_effective_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_doc public.legal_documents%rowtype;
begin
  select * into v_doc from public.legal_documents
   where id=p_document_id and owner_kind='tenant' and tenant_id=p_tenant_id
   for update;
  if not found or v_doc.status <> 'draft' then raise exception 'LEGAL_DOCUMENT_NOT_PUBLISHABLE'; end if;
  if position('[PENDIENTE:' in upper(v_doc.content)) > 0 then
    raise exception 'LEGAL_DOCUMENT_HAS_PENDING_FIELDS';
  end if;
  update public.legal_documents set status='retired',retired_at=now()
   where tenant_id=p_tenant_id and owner_kind='tenant'
     and document_type=v_doc.document_type and status='published';
  update public.legal_documents set status='published',published_by=p_actor_id,
    published_at=now(),effective_at=greatest(p_effective_at,now()),updated_at=now()
   where id=p_document_id;
  return p_document_id;
end;
$$;

create or replace function public.accept_tenant_dte_mandate(
  p_tenant_id uuid,
  p_document_id uuid,
  p_actor_id uuid,
  p_signer_full_name text,
  p_signer_rut text,
  p_signer_capacity text,
  p_authority_confirmed boolean,
  p_declaration text,
  p_source_ip inet,
  p_user_agent text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_doc public.legal_documents%rowtype; v_acceptance_id uuid;
begin
  if not p_authority_confirmed then raise exception 'DTE_MANDATE_AUTHORITY_REQUIRED'; end if;
  select * into v_doc from public.legal_documents
   where id=p_document_id and status='published' and (
     (owner_kind='tenant' and tenant_id=p_tenant_id) or owner_kind='platform'
   );
  if not found or v_doc.document_type <> 'dte_mandate' then raise exception 'DTE_MANDATE_DOCUMENT_INVALID'; end if;
  insert into public.legal_acceptances(
    tenant_id,document_id,document_version,document_hash,actor_type,actor_user_id,
    acceptance_context,accepted_declaration,source_ip,user_agent
  ) values (
    p_tenant_id,v_doc.id,v_doc.version,v_doc.content_sha256,'tenant_admin',p_actor_id,
    'dte_mandate',p_declaration,p_source_ip,left(p_user_agent,500)
  ) returning id into v_acceptance_id;
  insert into public.tenant_dte_mandates(
    tenant_id,legal_acceptance_id,signer_full_name,signer_rut,signer_capacity,
    has_representative_authority,may_generate,may_sign,may_submit,may_query,
    may_retain,may_custody_certificate,may_custody_caf
  ) values (
    p_tenant_id,v_acceptance_id,trim(p_signer_full_name),
    public.normalize_chilean_rut(p_signer_rut),trim(p_signer_capacity),
    true,true,true,true,true,true,true,true
  );
  return v_acceptance_id;
end;
$$;

create or replace function public.legal_identity_complete(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.tenant_legal_profiles l
    join public.tenants t on t.id=l.tenant_id
    join public.dte_production_tenant_settings d on d.tenant_id=l.tenant_id
    where l.tenant_id=p_tenant_id
      and l.administrative_review_status='complete'
      and l.tenant_is_service_provider
      and length(trim(coalesce(l.trade_name,t.name,''))) >= 2
      and length(trim(coalesce(l.contact_address,t.address,''))) >= 5
      and length(trim(coalesce(l.support_email,t.contact_email,''))) >= 3
      and length(trim(coalesce(l.privacy_contact_name,''))) >= 3
      and length(trim(coalesce(l.privacy_contact_email,''))) >= 3
      and length(trim(d.issuer_legal_name)) >= 2
      and public.normalize_chilean_rut(d.issuer_rut)=d.issuer_rut
      and length(trim(d.issuer_address)) >= 5
  );
$$;

create or replace function public.tenant_legal_gate_report(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with facts as (
    select
      public.legal_identity_complete(p_tenant_id) identity_complete,
      exists(select 1 from public.dte_production_tenant_settings d where d.tenant_id=p_tenant_id
        and length(trim(d.issuer_legal_name))>=2 and length(trim(d.issuer_rut))>=8
        and length(trim(d.issuer_address))>=5 and length(trim(d.issuer_commune))>=2
        and length(trim(d.issuer_city))>=2) tax_data_complete,
      exists(select 1 from public.legal_documents d where d.tenant_id=p_tenant_id and d.owner_kind='tenant' and d.document_type='consumer_terms' and d.status='published' and d.effective_at<=now()) terms_published,
      exists(select 1 from public.legal_documents d where d.tenant_id=p_tenant_id and d.owner_kind='tenant' and d.document_type='privacy_notice' and d.status='published' and d.effective_at<=now()) privacy_published,
      exists(select 1 from public.legal_documents d where d.tenant_id=p_tenant_id and d.owner_kind='tenant' and d.document_type='cancellation_refund_policy' and d.status='published' and d.effective_at<=now()) cancellation_published,
      exists(select 1 from public.tenant_dte_mandates m where m.tenant_id=p_tenant_id) dte_mandate_accepted,
      coalesce((select not l.handles_sensitive_data or exists(
        select 1 from public.legal_documents d where d.tenant_id=p_tenant_id and d.owner_kind='tenant'
          and d.document_type='sensitive_data_authorization' and d.status='published' and d.effective_at<=now()
      ) from public.tenant_legal_profiles l where l.tenant_id=p_tenant_id),false) sensitive_consent_configured
  ), value as (
    select jsonb_build_object(
      'identityLegalComplete',identity_complete,
      'taxDataComplete',tax_data_complete,
      'termsPublished',terms_published,
      'privacyPublished',privacy_published,
      'cancellationRefundPublished',cancellation_published,
      'dteMandateAccepted',dte_mandate_accepted,
      'sensitiveConsentConfigured',sensitive_consent_configured
    ) gates from facts
  ) select gates || jsonb_build_object('ready',not exists(
    select 1 from jsonb_each(gates) e where e.value <> 'true'::jsonb
  )) from value;
$$;

create or replace function public.dte_type39_enablement_gate_report(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with reports as (
    select public.tenant_legal_gate_report(p_tenant_id) legal,
      public.dte_activation_gate_report(p_tenant_id,39,true) technical
  ), readiness as (
    select legal,technical,
      coalesce((legal->>'ready')::boolean,false) legal_ready,
      not exists (
        select 1 from jsonb_each(technical) e
        where e.key not in ('ready','documentEngineReady','globalFeatureEnabled')
          and e.value <> 'true'::jsonb
      ) technical_ready,
      exists(select 1 from public.dte_tenant_document_capabilities c
        where c.tenant_id=p_tenant_id and c.environment='production' and c.dte_type=39
          and c.certification_status='production_authorized'
          and length(trim(coalesce(c.endpoint_profile,'')))>0
          and length(trim(coalesce(c.schema_version,'')))>0) capability_ready
    from reports
  ) select jsonb_build_object(
    'legal',legal,'technical',technical,'legalReady',legal_ready,
    'technicalReady',technical_ready,'capabilityReady',capability_ready,
    'ready',legal_ready and technical_ready and capability_ready
  ) from readiness;
$$;

create or replace function public.dte_type39_legal_gate_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_gate jsonb;
begin
  if new.environment='production' and new.dte_type=39 and new.issuance_enabled
     and (tg_op='INSERT' or old.issuance_enabled is distinct from new.issuance_enabled) then
    v_gate := public.dte_type39_enablement_gate_report(new.tenant_id);
    if coalesce((v_gate->>'ready')::boolean,false) is not true then
      raise exception 'DTE_TYPE39_LEGAL_OR_TECHNICAL_GATE_INCOMPLETE';
    end if;
  end if;
  return new;
end;
$$;
create trigger dte_type39_legal_gate_guard_insert
before insert on public.dte_tenant_document_capabilities
for each row execute function public.dte_type39_legal_gate_guard();
create trigger dte_type39_legal_gate_guard_update
before update of issuance_enabled on public.dte_tenant_document_capabilities
for each row execute function public.dte_type39_legal_gate_guard();

create or replace function public.create_public_appointment_with_legal_acceptance(
  p_tenant_id uuid,p_professional_id uuid,p_service_id uuid,p_start_at timestamptz,
  p_customer_id uuid,p_customer_name text,p_customer_phone text,p_customer_email text,
  p_notes text,p_payment_required boolean,p_payment_status text,p_manage_token_hash text,
  p_manage_token_expires_at timestamptz,p_idempotency_key text,p_legal jsonb,
  p_source_ip inet,p_user_agent text
) returns table(appointment_id uuid,duplicate boolean)
language plpgsql security definer set search_path=public as $$
declare v_result record; v_kind text; v_doc public.legal_documents%rowtype;
  v_required text[] := array['consumer_terms','privacy_notice','cancellation_refund_policy'];
  v_item jsonb; v_sensitive boolean; v_destination text;
begin
  select coalesce(l.handles_sensitive_data,false) into v_sensitive
    from public.tenant_legal_profiles l where l.tenant_id=p_tenant_id;
  if not public.legal_identity_complete(p_tenant_id) then raise exception 'LEGAL_IDENTITY_INCOMPLETE'; end if;
  if v_sensitive then v_required := array_append(v_required,'sensitive_data_authorization'); end if;

  foreach v_kind in array v_required loop
    v_item := p_legal->v_kind;
    select * into v_doc from public.legal_documents d
     where d.id=nullif(v_item->>'documentId','')::uuid
       and d.owner_kind='tenant' and d.tenant_id=p_tenant_id
       and d.document_type=v_kind and d.status='published' and d.effective_at<=now()
       and d.version=(v_item->>'version')::integer
       and d.content_sha256=v_item->>'hash';
    if not found or coalesce((v_item->>'accepted')::boolean,false) is not true then
      raise exception 'LEGAL_ACCEPTANCE_REQUIRED';
    end if;
  end loop;

  select * into v_result from public.create_public_appointment(
    p_tenant_id,p_professional_id,p_service_id,p_start_at,p_customer_id,
    p_customer_name,p_customer_phone,p_customer_email,p_notes,p_payment_required,
    p_payment_status,p_manage_token_hash,p_manage_token_expires_at,p_idempotency_key
  );
  appointment_id := v_result.appointment_id; duplicate := v_result.duplicate;
  if duplicate then return next; return; end if;

  foreach v_kind in array v_required loop
    v_item := p_legal->v_kind;
    select * into v_doc from public.legal_documents where id=(v_item->>'documentId')::uuid;
    insert into public.legal_acceptances(
      tenant_id,document_id,document_version,document_hash,actor_type,customer_id,
      appointment_id,acceptance_context,accepted_declaration,source_ip,user_agent
    ) values (
      p_tenant_id,v_doc.id,v_doc.version,v_doc.content_sha256,'consumer',p_customer_id,
      appointment_id,'booking',left(v_item->>'declaration',1000),p_source_ip,left(p_user_agent,500)
    );
  end loop;

  if coalesce((p_legal#>>'{marketing,accepted}')::boolean,false) then
    select * into v_doc from public.legal_documents d
      where d.id=(p_legal#>>'{privacy_notice,documentId}')::uuid
        and d.tenant_id=p_tenant_id and d.document_type='privacy_notice';
    v_destination := lower(trim(p_customer_email));
    insert into public.marketing_consent_events(
      tenant_id,customer_id,appointment_id,channel,purpose,event_type,
      privacy_document_id,privacy_document_version,destination_hash,source_context
    ) values (
      p_tenant_id,p_customer_id,appointment_id,'email',
      left(p_legal#>>'{marketing,purpose}',500),'granted',v_doc.id,v_doc.version,
      encode(digest(convert_to(v_destination,'UTF8'),'sha256'),'hex'),'booking'
    );
  end if;
  return next;
end;
$$;

create or replace function public.legal_appointment_payment_ready(
  p_tenant_id uuid,p_appointment_id uuid
) returns boolean language sql stable security definer set search_path=public as $$
  select public.legal_identity_complete(p_tenant_id) and
    not exists (
      select 1 from unnest(array['consumer_terms','privacy_notice','cancellation_refund_policy']::text[]) required(document_type)
      where not exists (
        select 1 from public.legal_acceptances a join public.legal_documents d on d.id=a.document_id
        where a.tenant_id=p_tenant_id and a.appointment_id=p_appointment_id
          and a.acceptance_context='booking' and d.document_type=required.document_type
      )
    ) and (
      not coalesce((select handles_sensitive_data from public.tenant_legal_profiles where tenant_id=p_tenant_id),false)
      or exists (
        select 1 from public.legal_acceptances a join public.legal_documents d on d.id=a.document_id
        where a.tenant_id=p_tenant_id and a.appointment_id=p_appointment_id
          and d.document_type='sensitive_data_authorization'
      )
    );
$$;

alter table public.tenant_legal_profiles enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.tenant_dte_mandates enable row level security;
alter table public.marketing_consent_events enable row level security;
alter table public.marketing_suppressions enable row level security;

revoke all on public.tenant_legal_profiles,public.legal_documents,
  public.legal_acceptances,public.tenant_dte_mandates,
  public.marketing_consent_events,public.marketing_suppressions from anon,authenticated;
grant select on public.tenant_legal_profiles,public.legal_documents to authenticated;

create policy tenant_legal_profiles_member_read on public.tenant_legal_profiles
  for select to authenticated using (
    public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid())
  );
create policy legal_documents_member_read on public.legal_documents
  for select to authenticated using (
    (tenant_id is not null and public.is_tenant_member(tenant_id,auth.uid())) or
    public.is_platform_admin(auth.uid())
  );

revoke all on function public.publish_legal_document(uuid,uuid,uuid,timestamptz),
  public.accept_tenant_dte_mandate(uuid,uuid,uuid,text,text,text,boolean,text,inet,text),
  public.legal_identity_complete(uuid),public.tenant_legal_gate_report(uuid),
  public.dte_type39_enablement_gate_report(uuid),
  public.revoke_marketing_consent(uuid,text,text,text),
  public.create_public_appointment_with_legal_acceptance(uuid,uuid,uuid,timestamptz,uuid,text,text,text,text,boolean,text,text,timestamptz,text,jsonb,inet,text),
  public.legal_appointment_payment_ready(uuid,uuid) from public;
grant execute on function public.publish_legal_document(uuid,uuid,uuid,timestamptz),
  public.accept_tenant_dte_mandate(uuid,uuid,uuid,text,text,text,boolean,text,inet,text),
  public.legal_identity_complete(uuid),public.tenant_legal_gate_report(uuid),
  public.dte_type39_enablement_gate_report(uuid),
  public.revoke_marketing_consent(uuid,text,text,text),
  public.create_public_appointment_with_legal_acceptance(uuid,uuid,uuid,timestamptz,uuid,text,text,text,text,boolean,text,text,timestamptz,text,jsonb,inet,text),
  public.legal_appointment_payment_ready(uuid,uuid) to service_role;

comment on table public.legal_documents is 'Immutable once published. Tenant documents never fall back to another tenant.';
comment on table public.legal_acceptances is 'Append-only minimal electronic acceptance evidence; technical fields are restricted.';
comment on table public.tenant_dte_mandates is 'Electronic contractual evidence, not an advanced electronic signature.';
comment on table public.marketing_consent_events is 'Promotional consent is separate from transactional communications.';
comment on function public.dte_type39_enablement_gate_report(uuid) is 'Composes tenant legal readiness with all existing type 39 tax and infrastructure facts without reserving a folio.';
