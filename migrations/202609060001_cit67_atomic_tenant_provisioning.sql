begin;

do $preflight$
declare
  required_column record;
  relation_oid oid;
  tenants_oid oid;
  tenant_members_oid oid;
  slug_attnum smallint;
  tenant_id_attnum smallint;
  user_id_attnum smallint;
begin
  for required_column in
    select required.*
    from (values
      ('public','tenants','id'),
      ('public','tenants','slug'),
      ('public','tenants','name'),
      ('public','tenants','lifecycle_status'),
      ('public','tenants','operational_mode'),
      ('public','tenants','show_address'),
      ('public','tenants','show_phone'),
      ('public','tenants','show_address_home'),
      ('public','tenants','show_phone_home'),
      ('public','tenants','show_address_after_booking'),
      ('public','tenants','show_phone_after_booking'),
      ('public','tenants','admin_email'),
      ('public','tenants','contact_email'),
      ('public','tenants','phone_display'),
      ('public','tenants','whatsapp'),
      ('public','tenants','address'),
      ('public','tenants','city'),
      ('public','tenants','min_lead_time_min'),
      ('public','tenant_members','tenant_id'),
      ('public','tenant_members','user_id'),
      ('public','tenant_members','role'),
      ('public','tenant_members','email'),
      ('public','tenant_members','is_active'),
      ('public','platform_admins','user_id'),
      ('public','platform_admins','role'),
      ('public','platform_admins','is_active'),
      ('public','tenant_payment_settings','tenant_id'),
      ('public','tenant_payment_settings','payment_mode'),
      ('public','tenant_payment_settings','provider'),
      ('public','tenant_payment_settings','active'),
      ('public','tenant_payment_settings','payment_methods_enabled'),
      ('public','tenant_payment_settings','payment_collection_mode'),
      ('public','tenant_legal_profiles','tenant_id'),
      ('public','tenant_legal_profiles','tenant_is_service_provider'),
      ('public','tenant_legal_profiles','handles_sensitive_data'),
      ('public','tenant_legal_profiles','sensitive_data_purpose'),
      ('public','tenant_legal_profiles','administrative_review_status'),
      ('public','tenant_legal_profiles','sensitive_data_review_status'),
      ('public','tenant_legal_profiles','created_by'),
      ('public','tenant_legal_profiles','updated_by'),
      ('public','dte_tenant_issuance_settings','tenant_id'),
      ('public','dte_tenant_issuance_settings','issuance_mode'),
      ('public','dte_tenant_issuance_settings','consumer_document_type'),
      ('public','dte_tenant_issuance_settings','invoice_on_request'),
      ('public','dte_tenant_issuance_settings','auto_email_delivery'),
      ('public','dte_tenant_issuance_settings','tax_treatment'),
      ('public','dte_tenant_issuance_settings','production_enabled'),
      ('public','dte_tenant_issuance_settings','sii_authorization_status'),
      ('public','dte_tenant_issuance_settings','certificate_ready'),
      ('public','dte_tenant_issuance_settings','certificate_valid_to'),
      ('public','dte_tenant_issuance_settings','caf_ready'),
      ('public','dte_tenant_issuance_settings','folio_ready'),
      ('public','dte_tenant_issuance_settings','endpoints_ready'),
      ('public','dte_tenant_issuance_settings','storage_ready'),
      ('public','dte_tenant_issuance_settings','worker_ready'),
      ('public','dte_tenant_issuance_settings','readiness_tests_green'),
      ('public','dte_tenant_issuance_settings','last_readiness_check'),
      ('public','dte_tenant_issuance_settings','safe_blocking_reason'),
      ('public','dte_tenant_issuance_settings','deposit_tax_document_policy_status'),
      ('public','dte_tenant_issuance_settings','boleta_payment_document_model'),
      ('public','dte_tenant_issuance_settings','boleta_model_verified_at'),
      ('public','dte_tenant_issuance_settings','boleta_model_verified_by'),
      ('public','dte_tenant_issuance_settings','boleta_model_evidence_reference'),
      ('public','data_retention_policies','tenant_id'),
      ('public','data_retention_policies','data_category'),
      ('public','data_retention_policies','legal_basis'),
      ('public','data_retention_policies','minimum_calendar_years'),
      ('public','data_retention_policies','configured_calendar_years'),
      ('public','data_retention_policies','disposition'),
      ('public','data_retention_policies','automation_enabled'),
      ('public','data_retention_policies','review_status'),
      ('public','data_retention_policies','updated_by'),
      ('auth','users','id'),
      ('auth','users','email')
    ) as required(schema_name,relation_name,column_name)
  loop
    select relation.oid
    into relation_oid
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid=relation.relnamespace
    where namespace.nspname=required_column.schema_name
      and relation.relname=required_column.relation_name
      and relation.relkind in ('r','p');

    if relation_oid is null then
      raise exception
        'CIT67_SCHEMA_PREFLIGHT_FAILED: required table %.% is missing',
        required_column.schema_name,
        required_column.relation_name;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid=relation_oid
        and attribute.attname=required_column.column_name
        and attribute.attnum>0
        and not attribute.attisdropped
    ) then
      raise exception
        'CIT67_SCHEMA_PREFLIGHT_FAILED: required column %.%.% is missing',
        required_column.schema_name,
        required_column.relation_name,
        required_column.column_name;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception
      'CIT67_SCHEMA_PREFLIGHT_FAILED: required function extensions.digest(bytea,text) is missing';
  end if;

  select relation.oid, attribute.attnum
  into tenants_oid, slug_attnum
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid=relation.relnamespace
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid=relation.oid
  where namespace.nspname='public'
    and relation.relname='tenants'
    and attribute.attname='slug'
    and attribute.attnum>0
    and not attribute.attisdropped;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_record
    where index_record.indrelid=tenants_oid
      and index_record.indisunique
      and index_record.indisvalid
      and index_record.indisready
      and index_record.indpred is null
      and index_record.indexprs is null
      and index_record.indnkeyatts=1
      and index_record.indkey[0]=slug_attnum
  ) then
    raise exception
      'CIT67_SCHEMA_PREFLIGHT_FAILED: public.tenants.slug requires effective uniqueness';
  end if;

  select relation.oid
  into tenant_members_oid
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid=relation.relnamespace
  where namespace.nspname='public'
    and relation.relname='tenant_members';

  select attribute.attnum
  into tenant_id_attnum
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid=tenant_members_oid
    and attribute.attname='tenant_id'
    and attribute.attnum>0
    and not attribute.attisdropped;

  select attribute.attnum
  into user_id_attnum
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid=tenant_members_oid
    and attribute.attname='user_id'
    and attribute.attnum>0
    and not attribute.attisdropped;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_record
    where index_record.indrelid=tenant_members_oid
      and index_record.indisunique
      and index_record.indisvalid
      and index_record.indisready
      and index_record.indpred is null
      and index_record.indexprs is null
      and index_record.indnkeyatts=2
      and (
        (index_record.indkey[0]=tenant_id_attnum
          and index_record.indkey[1]=user_id_attnum) or
        (index_record.indkey[0]=user_id_attnum
          and index_record.indkey[1]=tenant_id_attnum)
      )
  ) then
    raise exception
      'CIT67_SCHEMA_PREFLIGHT_FAILED: public.tenant_members(tenant_id,user_id) requires effective uniqueness';
  end if;
end;
$preflight$;

create table public.tenant_provisioning_requests (
  request_id uuid primary key,
  tenant_id uuid not null unique
    references public.tenants(id) on delete restrict,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  contract_version smallint not null default 1
    check (contract_version > 0),
  actor_user_id uuid not null,
  owner_user_id uuid not null,
  slug_snapshot text not null,
  completed_at timestamptz not null default pg_catalog.now()
);

comment on table public.tenant_provisioning_requests is
  'Append-only idempotency and audit ledger for atomic tenant provisioning. Contains no provider, DTE, certificate, CAF or folio data.';
comment on column public.tenant_provisioning_requests.request_fingerprint is
  'SHA-256 of the normalized provisioning payload, excluding request_id.';

alter table public.tenant_provisioning_requests enable row level security;
revoke all on table public.tenant_provisioning_requests
  from public, anon, authenticated, service_role;
grant select on table public.tenant_provisioning_requests to service_role;
create policy tenant_provisioning_requests_service_role_read
  on public.tenant_provisioning_requests
  for select
  to service_role
  using (true);

create or replace function public.provision_tenant(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_owner_user_id uuid,
  p_slug text,
  p_name text,
  p_contact_email text default null,
  p_phone_display text default null,
  p_whatsapp text default null,
  p_address text default null,
  p_city text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_slug text;
  normalized_name text;
  normalized_contact_email text;
  normalized_phone_display text;
  normalized_whatsapp text;
  normalized_address text;
  normalized_city text;
  owner_email text;
  payload jsonb;
  fingerprint text;
  provisioned_tenant_id uuid;
  previous_request public.tenant_provisioning_requests%rowtype;
begin
  if p_request_id is null then
    raise exception 'PROVISIONING_REQUEST_ID_REQUIRED';
  end if;
  if p_actor_user_id is null then
    raise exception 'PROVISIONING_ACTOR_REQUIRED';
  end if;
  if p_owner_user_id is null then
    raise exception 'PROVISIONING_OWNER_REQUIRED';
  end if;

  normalized_slug := pg_catalog.lower(pg_catalog.btrim(p_slug));
  normalized_name := pg_catalog.btrim(p_name);
  normalized_contact_email := nullif(
    pg_catalog.btrim(p_contact_email),
    ''
  );
  normalized_phone_display := nullif(
    pg_catalog.btrim(p_phone_display),
    ''
  );
  normalized_whatsapp := nullif(
    pg_catalog.btrim(p_whatsapp),
    ''
  );
  normalized_address := nullif(
    pg_catalog.btrim(p_address),
    ''
  );
  normalized_city := nullif(pg_catalog.btrim(p_city), '');

  if normalized_slug is null
      or normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'TENANT_SLUG_INVALID';
  end if;
  if normalized_slug = any (
    array['app','admin','www','n8n','localhost']::text[]
  ) then
    raise exception 'TENANT_SLUG_RESERVED';
  end if;
  if normalized_name is null or normalized_name = '' then
    raise exception 'TENANT_NAME_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.platform_admins as platform_admin
    where platform_admin.user_id = p_actor_user_id
      and platform_admin.role = 'super_admin'
      and platform_admin.is_active is true
  ) then
    raise exception 'PLATFORM_SUPER_ADMIN_REQUIRED';
  end if;

  payload := pg_catalog.jsonb_build_object(
    'actorUserId', p_actor_user_id,
    'ownerUserId', p_owner_user_id,
    'slug', normalized_slug,
    'name', normalized_name,
    'contactEmail', normalized_contact_email,
    'phoneDisplay', normalized_phone_display,
    'whatsapp', normalized_whatsapp,
    'address', normalized_address,
    'city', normalized_city
  );
  fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'tenant-provision-request:' || p_request_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'tenant-provision-slug:' || normalized_slug,
      0
    )
  );

  select request.*
  into previous_request
  from public.tenant_provisioning_requests as request
  where request.request_id = p_request_id
  for update;

  if found then
    if previous_request.request_fingerprint is distinct from fingerprint then
      raise exception 'PROVISIONING_REQUEST_PAYLOAD_MISMATCH';
    end if;

    return pg_catalog.jsonb_build_object(
      'requestId', previous_request.request_id,
      'tenantId', previous_request.tenant_id,
      'created', false
    );
  end if;

  select pg_catalog.btrim(auth_user.email)
  into owner_email
  from auth.users as auth_user
  where auth_user.id = p_owner_user_id;

  if not found then
    raise exception 'OWNER_USER_NOT_FOUND';
  end if;
  if nullif(owner_email, '') is null then
    raise exception 'OWNER_EMAIL_REQUIRED';
  end if;

  if exists (
    select 1
    from public.tenants as tenant
    where pg_catalog.lower(pg_catalog.btrim(tenant.slug)) = normalized_slug
  ) then
    raise exception 'TENANT_SLUG_ALREADY_EXISTS';
  end if;

  insert into public.tenants (
    slug,
    name,
    lifecycle_status,
    operational_mode,
    show_address,
    show_phone,
    show_address_home,
    show_phone_home,
    show_address_after_booking,
    show_phone_after_booking,
    admin_email,
    contact_email,
    phone_display,
    whatsapp,
    address,
    city,
    min_lead_time_min
  ) values (
    normalized_slug,
    normalized_name,
    'active',
    'unclassified',
    false,
    false,
    false,
    false,
    false,
    false,
    owner_email,
    normalized_contact_email,
    normalized_phone_display,
    normalized_whatsapp,
    normalized_address,
    normalized_city,
    null
  )
  returning id into provisioned_tenant_id;

  insert into public.tenant_members (
    tenant_id,
    user_id,
    role,
    email,
    is_active
  ) values (
    provisioned_tenant_id,
    p_owner_user_id,
    'owner',
    owner_email,
    true
  );

  insert into public.tenant_payment_settings (
    tenant_id,
    payment_mode,
    provider,
    active,
    payment_methods_enabled,
    payment_collection_mode
  ) values (
    provisioned_tenant_id,
    'none',
    'mercadopago',
    false,
    '[]'::jsonb,
    'none'
  );

  insert into public.tenant_legal_profiles (
    tenant_id,
    tenant_is_service_provider,
    handles_sensitive_data,
    sensitive_data_purpose,
    administrative_review_status,
    sensitive_data_review_status,
    created_by,
    updated_by
  ) values (
    provisioned_tenant_id,
    false,
    null,
    null,
    'draft',
    'pending',
    p_actor_user_id,
    p_actor_user_id
  );

  insert into public.dte_tenant_issuance_settings (
    tenant_id,
    issuance_mode,
    consumer_document_type,
    invoice_on_request,
    auto_email_delivery,
    tax_treatment,
    production_enabled,
    sii_authorization_status,
    certificate_ready,
    certificate_valid_to,
    caf_ready,
    folio_ready,
    endpoints_ready,
    storage_ready,
    worker_ready,
    readiness_tests_green,
    last_readiness_check,
    safe_blocking_reason,
    deposit_tax_document_policy_status,
    boleta_payment_document_model,
    boleta_model_verified_at,
    boleta_model_verified_by,
    boleta_model_evidence_reference
  ) values (
    provisioned_tenant_id,
    'manual',
    'unsupported',
    false,
    false,
    'unconfigured',
    false,
    'not_configured',
    false,
    null,
    false,
    false,
    false,
    false,
    false,
    false,
    null,
    'TENANT_NOT_CONFIGURED',
    'unconfigured',
    'unconfigured',
    null,
    null,
    null
  );

  insert into public.data_retention_policies (
    tenant_id,
    data_category,
    legal_basis,
    minimum_calendar_years,
    configured_calendar_years,
    disposition,
    automation_enabled,
    review_status,
    updated_by
  ) values
    (
      provisioned_tenant_id,
      'dte_tax_artifacts',
      'Mínimo legal de seis años calendario sujeto a validación tributaria',
      6,
      6,
      'RETAIN',
      false,
      'PENDING_LEGAL_ACCOUNTING_REVIEW',
      p_actor_user_id
    ),
    (
      provisioned_tenant_id,
      'payments_sales_contract',
      'Integridad contractual, contable y tributaria; plazo pendiente de revisión',
      null,
      null,
      'REVIEW_REQUIRED',
      false,
      'PENDING_LEGAL_ACCOUNTING_REVIEW',
      p_actor_user_id
    ),
    (
      provisioned_tenant_id,
      'booking_operations',
      'Finalidad operativa separada; definir anonimización posterior',
      null,
      null,
      'ANONYMIZE',
      false,
      'PENDING_LEGAL_ACCOUNTING_REVIEW',
      p_actor_user_id
    ),
    (
      provisioned_tenant_id,
      'marketing_evidence_suppression',
      'Conservar evidencia y supresión mínima para respetar revocaciones',
      null,
      null,
      'RETAIN',
      false,
      'PENDING_LEGAL_ACCOUNTING_REVIEW',
      p_actor_user_id
    ),
    (
      provisioned_tenant_id,
      'technical_logs',
      'Retención limitada sin secretos ni datos sensibles; plazo pendiente',
      null,
      null,
      'DELETE',
      false,
      'PENDING_LEGAL_ACCOUNTING_REVIEW',
      p_actor_user_id
    );

  insert into public.tenant_provisioning_requests (
    request_id,
    tenant_id,
    request_fingerprint,
    contract_version,
    actor_user_id,
    owner_user_id,
    slug_snapshot
  ) values (
    p_request_id,
    provisioned_tenant_id,
    fingerprint,
    1,
    p_actor_user_id,
    p_owner_user_id,
    normalized_slug
  );

  return pg_catalog.jsonb_build_object(
    'requestId', p_request_id,
    'tenantId', provisioned_tenant_id,
    'created', true
  );
end;
$function$;

alter function public.provision_tenant(
  uuid,uuid,uuid,text,text,text,text,text,text,text
) owner to postgres;

revoke all on function public.provision_tenant(
  uuid,uuid,uuid,text,text,text,text,text,text,text
) from public, anon, authenticated;

grant execute on function public.provision_tenant(
  uuid,uuid,uuid,text,text,text,text,text,text,text
) to service_role;

comment on function public.provision_tenant(
  uuid,uuid,uuid,text,text,text,text,text,text,text
) is
  'Atomically creates one fail-closed tenant, its owner and non-productive policy skeletons. Service role only; no external effects.';

commit;
