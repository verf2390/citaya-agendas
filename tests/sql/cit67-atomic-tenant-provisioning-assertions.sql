insert into auth.users(id,email) values
  ('67000000-0000-4000-8000-000000000001','actor@citaya.invalid'),
  ('67000000-0000-4000-8000-000000000002','owner-a@citaya.invalid'),
  ('67000000-0000-4000-8000-000000000003','owner-b@citaya.invalid'),
  ('67000000-0000-4000-8000-000000000004','support@citaya.invalid'),
  ('67000000-0000-4000-8000-000000000005','inactive@citaya.invalid');

insert into public.platform_admins(user_id,email,role,is_active) values
  ('67000000-0000-4000-8000-000000000001','actor@citaya.invalid','super_admin',true),
  ('67000000-0000-4000-8000-000000000004','support@citaya.invalid','support',true),
  ('67000000-0000-4000-8000-000000000005','inactive@citaya.invalid','super_admin',false);

do $$
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.provision_tenant(uuid,uuid,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then raise exception 'ANON_CAN_EXECUTE_PROVISIONING'; end if;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.provision_tenant(uuid,uuid,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then raise exception 'AUTHENTICATED_CAN_EXECUTE_PROVISIONING'; end if;
  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.provision_tenant(uuid,uuid,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then raise exception 'SERVICE_ROLE_CANNOT_EXECUTE_PROVISIONING'; end if;
  if pg_catalog.has_table_privilege(
    'service_role', 'public.tenant_provisioning_requests', 'INSERT'
  ) then raise exception 'SERVICE_ROLE_CAN_INSERT_LEDGER_DIRECTLY'; end if;
  if not pg_catalog.has_table_privilege(
    'service_role', 'public.tenant_provisioning_requests', 'SELECT'
  ) then raise exception 'SERVICE_ROLE_CANNOT_READ_LEDGER'; end if;
end;
$$;

set role service_role;
create temporary table cit67_creation_result as
select public.provision_tenant(
  '67000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000002',
  '  Tenant-A  ',
  '  Tenant A  ',
  ' contact-a@citaya.invalid ',
  ' +56 9 1111 1111 ',
  ' +56 9 2222 2222 ',
  ' Address A ',
  ' City A '
);
reset role;

set role service_role;
create temporary table cit67_ledger_visibility as
select count(*) as row_count from public.tenant_provisioning_requests;
reset role;

do $$
declare
  result jsonb;
  tenant_a_id uuid;
begin
  select tenant.id into strict tenant_a_id
  from public.tenants as tenant
  where tenant.slug='tenant-a';

  if (select row_count from cit67_ledger_visibility)<>1 then
    raise exception 'SERVICE_ROLE_CANNOT_READ_LEDGER_ROW';
  end if;

  if not exists (
    select 1 from cit67_creation_result
    where (provision_tenant->>'created')::boolean=true
      and (provision_tenant->>'tenantId')::uuid=tenant_a_id
      and (provision_tenant->>'requestId')::uuid=
        '67000000-0000-4000-8000-000000000101'
  ) then raise exception 'INITIAL_CREATION_RESULT_INVALID'; end if;

  if not exists (
    select 1 from public.tenants as tenant
    where tenant.id=tenant_a_id
      and tenant.name='Tenant A'
      and tenant.lifecycle_status='active'
      and tenant.operational_mode='unclassified'
      and tenant.show_address=false
      and tenant.show_phone=false
      and tenant.show_address_home=false
      and tenant.show_phone_home=false
      and tenant.show_address_after_booking=false
      and tenant.show_phone_after_booking=false
      and tenant.admin_email='owner-a@citaya.invalid'
      and tenant.contact_email='contact-a@citaya.invalid'
      and tenant.phone_display='+56 9 1111 1111'
      and tenant.whatsapp='+56 9 2222 2222'
      and tenant.address='Address A'
      and tenant.city='City A'
      and tenant.min_lead_time_min is null
  ) then raise exception 'TENANT_A_NOT_FAIL_CLOSED'; end if;

  if not exists (
    select 1 from public.tenant_members as member
    where member.tenant_id=tenant_a_id
      and member.user_id='67000000-0000-4000-8000-000000000002'
      and member.role='owner'
      and member.email='owner-a@citaya.invalid'
      and member.is_active=true
  ) then raise exception 'TENANT_A_OWNER_MISSING'; end if;

  if not exists (
    select 1 from public.tenant_payment_settings as settings
    where settings.tenant_id=tenant_a_id
      and settings.active=false
      and settings.payment_mode='none'
      and settings.provider='mercadopago'
      and settings.payment_methods_enabled='[]'::jsonb
      and settings.payment_collection_mode='none'
      and settings.mercadopago_public_key is null
      and settings.mercadopago_access_token is null
      and settings.webpay_commerce_code is null
      and settings.webpay_api_key is null
      and settings.khipu_receiver_id is null
      and settings.khipu_secret is null
      and settings.bank_name is null
      and settings.bank_account_type is null
      and settings.bank_account_number is null
      and settings.bank_account_holder is null
      and settings.bank_rut is null
      and settings.bank_email is null
  ) then raise exception 'TENANT_A_PAYMENTS_NOT_FAIL_CLOSED'; end if;

  if not exists (
    select 1 from public.tenant_legal_profiles as profile
    where profile.tenant_id=tenant_a_id
      and profile.administrative_review_status='draft'
      and profile.sensitive_data_review_status='pending'
      and profile.tenant_is_service_provider=false
      and profile.handles_sensitive_data is null
      and profile.sensitive_data_purpose is null
      and profile.created_by='67000000-0000-4000-8000-000000000001'
      and profile.updated_by='67000000-0000-4000-8000-000000000001'
  ) then raise exception 'TENANT_A_LEGAL_NOT_FAIL_CLOSED'; end if;

  if not exists (
    select 1 from public.dte_tenant_issuance_settings as settings
    where settings.tenant_id=tenant_a_id
      and settings.issuance_mode='manual'
      and settings.consumer_document_type='unsupported'
      and settings.invoice_on_request=false
      and settings.auto_email_delivery=false
      and settings.tax_treatment='unconfigured'
      and settings.production_enabled=false
      and settings.sii_authorization_status='not_configured'
      and settings.certificate_ready=false
      and settings.certificate_valid_to is null
      and settings.caf_ready=false
      and settings.folio_ready=false
      and settings.endpoints_ready=false
      and settings.storage_ready=false
      and settings.worker_ready=false
      and settings.readiness_tests_green=false
      and settings.last_readiness_check is null
      and settings.safe_blocking_reason='TENANT_NOT_CONFIGURED'
      and settings.deposit_tax_document_policy_status='unconfigured'
      and settings.boleta_payment_document_model='unconfigured'
      and settings.boleta_model_verified_at is null
      and settings.boleta_model_verified_by is null
      and settings.boleta_model_evidence_reference is null
  ) then raise exception 'TENANT_A_DTE_ISSUANCE_NOT_FAIL_CLOSED'; end if;

  if (select count(*) from public.data_retention_policies
      where tenant_id=tenant_a_id) <> 5 then
    raise exception 'TENANT_A_RETENTION_COUNT_INVALID';
  end if;
  if exists (
    select 1 from public.data_retention_policies
    where tenant_id=tenant_a_id
      and (automation_enabled<>false
        or review_status<>'PENDING_LEGAL_ACCOUNTING_REVIEW')
  ) then raise exception 'TENANT_A_RETENTION_NOT_FAIL_CLOSED'; end if;
  if not exists (
    select 1 from public.data_retention_policies
    where tenant_id=tenant_a_id and data_category='dte_tax_artifacts'
      and minimum_calendar_years=6 and configured_calendar_years=6
      and disposition='RETAIN'
  ) then raise exception 'TENANT_A_DTE_RETENTION_INVALID'; end if;
  if exists (
    select expected.*
    from (values
      ('dte_tax_artifacts',6::smallint,6::smallint,'RETAIN'),
      ('payments_sales_contract',null::smallint,null::smallint,'REVIEW_REQUIRED'),
      ('booking_operations',null::smallint,null::smallint,'ANONYMIZE'),
      ('marketing_evidence_suppression',null::smallint,null::smallint,'RETAIN'),
      ('technical_logs',null::smallint,null::smallint,'DELETE')
    ) as expected(
      data_category,minimum_calendar_years,configured_calendar_years,disposition
    )
    except
    select policy.data_category,policy.minimum_calendar_years,
      policy.configured_calendar_years,policy.disposition
    from public.data_retention_policies as policy
    where policy.tenant_id=tenant_a_id
  ) then raise exception 'TENANT_A_RETENTION_POLICY_SET_INVALID'; end if;

  result := public.provision_tenant(
    '67000000-0000-4000-8000-000000000101',
    '67000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000002',
    'tenant-a', 'Tenant A', 'contact-a@citaya.invalid',
    '+56 9 1111 1111', '+56 9 2222 2222', 'Address A', 'City A'
  );
  if (result->>'created')::boolean <> false
      or (result->>'tenantId')::uuid <> tenant_a_id then
    raise exception 'IDENTICAL_REPLAY_INVALID';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000101',
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000000002',
      'tenant-a', 'Changed Tenant A'
    );
    raise exception 'EXPECTED_PAYLOAD_MISMATCH_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'PROVISIONING_REQUEST_PAYLOAD_MISMATCH' then raise; end if;
  end;

  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000102',
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000000003',
      'tenant-a', 'Tenant collision'
    );
    raise exception 'EXPECTED_SLUG_CONFLICT_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'TENANT_SLUG_ALREADY_EXISTS' then raise; end if;
  end;

  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000103',
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000009999',
      'missing-owner', 'Missing owner'
    );
    raise exception 'EXPECTED_MISSING_OWNER_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'OWNER_USER_NOT_FOUND' then raise; end if;
  end;

  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000104',
      '67000000-0000-4000-8000-000000000004',
      '67000000-0000-4000-8000-000000000003',
      'support-actor', 'Support actor'
    );
    raise exception 'EXPECTED_SUPPORT_ACTOR_REJECTION_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'PLATFORM_SUPER_ADMIN_REQUIRED' then raise; end if;
  end;

  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000105',
      '67000000-0000-4000-8000-000000000005',
      '67000000-0000-4000-8000-000000000003',
      'inactive-actor', 'Inactive actor'
    );
    raise exception 'EXPECTED_INACTIVE_ACTOR_REJECTION_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'PLATFORM_SUPER_ADMIN_REQUIRED' then raise; end if;
  end;

  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000108',
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000000003',
      'admin', 'Reserved slug'
    );
    raise exception 'EXPECTED_RESERVED_SLUG_REJECTION_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'TENANT_SLUG_RESERVED' then raise; end if;
  end;

  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000109',
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000000003',
      'invalid_slug', 'Invalid slug'
    );
    raise exception 'EXPECTED_INVALID_SLUG_REJECTION_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'TENANT_SLUG_INVALID' then raise; end if;
  end;
end;
$$;

do $$
begin
  if exists(select 1 from public.tenants where slug in (
    'missing-owner','support-actor','inactive-actor'
  )) then raise exception 'FAILED_PROVISIONING_LEFT_TENANT'; end if;
  if exists(select 1 from public.tenant_provisioning_requests where request_id in (
    '67000000-0000-4000-8000-000000000102',
    '67000000-0000-4000-8000-000000000103',
    '67000000-0000-4000-8000-000000000104',
    '67000000-0000-4000-8000-000000000105',
    '67000000-0000-4000-8000-000000000108',
    '67000000-0000-4000-8000-000000000109'
  )) then raise exception 'FAILED_PROVISIONING_LEFT_LEDGER'; end if;
end;
$$;

select public.provision_tenant(
  '67000000-0000-4000-8000-000000000106',
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000003',
  'tenant-b',
  'Tenant B'
);

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
begin
  select id into strict tenant_a_id from public.tenants where slug='tenant-a';
  select id into strict tenant_b_id from public.tenants where slug='tenant-b';
  if tenant_a_id=tenant_b_id then raise exception 'TENANTS_NOT_DISTINCT'; end if;
  if (select count(*) from public.tenant_members where tenant_id in (tenant_a_id,tenant_b_id))<>2
    or (select count(*) from public.tenant_payment_settings where tenant_id in (tenant_a_id,tenant_b_id))<>2
    or (select count(*) from public.tenant_legal_profiles where tenant_id in (tenant_a_id,tenant_b_id))<>2
    or (select count(*) from public.dte_tenant_issuance_settings where tenant_id in (tenant_a_id,tenant_b_id))<>2
    or (select count(*) from public.data_retention_policies where tenant_id in (tenant_a_id,tenant_b_id))<>10
  then raise exception 'TENANT_SKELETON_COUNTS_INVALID'; end if;
  if not exists (
    select 1 from public.tenants
    where id=tenant_b_id and admin_email='owner-b@citaya.invalid'
      and contact_email is null and phone_display is null and whatsapp is null
      and address is null and city is null
  ) then raise exception 'TENANT_B_INHERITED_TENANT_A_DATA'; end if;
  if exists (
    select 1 from public.tenant_members
    where tenant_id=tenant_a_id
      and user_id='67000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1 from public.tenant_members
    where tenant_id=tenant_b_id
      and user_id='67000000-0000-4000-8000-000000000002'
  ) then raise exception 'TENANT_OWNER_CROSS_CONTAMINATION'; end if;

  if exists(select 1 from public.dte_production_tenant_settings where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.dte_tenant_document_capabilities where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.tenant_payment_method_tax_policies where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.tenant_dte_certificates_metadata where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.dte_production_cafs where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.dte_production_folio_ledger where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.dte_certification_cafs where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.dte_certification_folios where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.tenant_self_issuer_authority_events where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.services where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.professionals where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.availability where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.customers where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.appointments where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.campaigns where tenant_id in (tenant_a_id,tenant_b_id))
    or exists(select 1 from public.message_logs where tenant_id in (tenant_a_id,tenant_b_id))
  then raise exception 'FORBIDDEN_TENANT_SCOPED_ROW_CREATED'; end if;
end;
$$;

select pg_catalog.set_config(
  'cit67.tenant_a_id',
  (select id::text from public.tenants where slug='tenant-a'),
  false
);
select pg_catalog.set_config(
  'cit67.tenant_b_id',
  (select id::text from public.tenants where slug='tenant-b'),
  false
);
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '67000000-0000-4000-8000-000000000002',
  false
);
do $cit67_authenticated_isolation$
declare
  tenant_a_id uuid := pg_catalog.current_setting('cit67.tenant_a_id')::uuid;
  tenant_b_id uuid := pg_catalog.current_setting('cit67.tenant_b_id')::uuid;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id=tenant_a_id
  ) then
    raise exception 'CIT67_RLS_OWNER_A_CANNOT_READ_OWN_MEMBERSHIP';
  end if;
  if exists (
    select 1 from public.tenant_members
    where tenant_id=tenant_b_id
  ) then
    raise exception 'CIT67_RLS_TENANT_MEMBERS_A_CAN_READ_B';
  end if;

  if not exists (
    select 1 from public.tenant_legal_profiles
    where tenant_id=tenant_a_id
  ) then
    raise exception 'CIT67_RLS_OWNER_A_CANNOT_READ_OWN_LEGAL_PROFILE';
  end if;
  if exists (
    select 1 from public.tenant_legal_profiles
    where tenant_id=tenant_b_id
  ) then
    raise exception 'CIT67_RLS_LEGAL_PROFILES_A_CAN_READ_B';
  end if;

  if not exists (
    select 1 from public.dte_tenant_issuance_settings
    where tenant_id=tenant_a_id
  ) then
    raise exception 'CIT67_RLS_OWNER_A_CANNOT_READ_OWN_DTE_SETTINGS';
  end if;
  if exists (
    select 1 from public.dte_tenant_issuance_settings
    where tenant_id=tenant_b_id
  ) then
    raise exception 'CIT67_RLS_DTE_SETTINGS_A_CAN_READ_B';
  end if;

  if (
    select pg_catalog.count(*) from public.data_retention_policies
    where tenant_id=tenant_a_id
  )<>5 then
    raise exception 'CIT67_RLS_OWNER_A_CANNOT_READ_OWN_RETENTION_POLICIES';
  end if;
  if exists (
    select 1 from public.data_retention_policies
    where tenant_id=tenant_b_id
  ) then
    raise exception 'CIT67_RLS_RETENTION_POLICIES_A_CAN_READ_B';
  end if;

  if pg_catalog.has_table_privilege(
    'authenticated',
    'public.tenant_payment_settings',
    'SELECT'
  ) then
    raise exception 'CIT67_RLS_AUTHENTICATED_HAS_PAYMENT_SETTINGS_SELECT';
  end if;
  begin
    perform 1 from public.tenant_payment_settings
    where tenant_id=tenant_b_id;
    raise exception 'CIT67_RLS_AUTHENTICATED_READ_PAYMENT_SETTINGS';
  exception
    when insufficient_privilege then null;
  end;
end;
$cit67_authenticated_isolation$;
reset role;

create function public.cit67_force_skeleton_failure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tenants as tenant
    where tenant.id=new.tenant_id and tenant.slug='rollback-skeleton'
  ) then
    raise exception 'CIT67_FORCED_SKELETON_FAILURE';
  end if;
  return new;
end;
$$;
create trigger cit67_force_skeleton_failure
before insert on public.dte_tenant_issuance_settings
for each row execute function public.cit67_force_skeleton_failure();

do $$
begin
  begin
    perform public.provision_tenant(
      '67000000-0000-4000-8000-000000000107',
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000000003',
      'rollback-skeleton', 'Rollback skeleton'
    );
    raise exception 'EXPECTED_SKELETON_FAILURE_NOT_RAISED';
  exception when others then
    if sqlerrm <> 'CIT67_FORCED_SKELETON_FAILURE' then raise; end if;
  end;
end;
$$;

drop trigger cit67_force_skeleton_failure
  on public.dte_tenant_issuance_settings;
drop function public.cit67_force_skeleton_failure();

do $$
begin
  if exists(select 1 from public.tenants where slug='rollback-skeleton') then
    raise exception 'SKELETON_FAILURE_DID_NOT_ROLL_BACK_TENANT';
  end if;
  if exists(
    select 1 from public.tenant_provisioning_requests
    where request_id='67000000-0000-4000-8000-000000000107'
  ) then raise exception 'SKELETON_FAILURE_DID_NOT_ROLL_BACK_LEDGER'; end if;
  if (select count(*) from public.tenants)<>2
    or (select count(*) from public.tenant_members)<>2
    or (select count(*) from public.tenant_payment_settings)<>2
    or (select count(*) from public.tenant_legal_profiles)<>2
    or (select count(*) from public.dte_tenant_issuance_settings)<>2
    or (select count(*) from public.data_retention_policies)<>10
    or (select count(*) from public.tenant_provisioning_requests)<>2
  then raise exception 'SKELETON_FAILURE_LEFT_PARTIAL_ROWS'; end if;
end;
$$;
