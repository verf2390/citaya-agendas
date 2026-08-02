\set ON_ERROR_STOP on
begin;
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.test_uid',true),'')::uuid$$;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
end$$;

create table public.tenants(id uuid primary key,slug text unique,name text,address text,contact_email text);
create table public.customers(id uuid primary key,tenant_id uuid not null references tenants(id),full_name text,email text,phone text,rut_normalized text,unique(tenant_id,id));
create table public.customer_tax_profiles(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null,rut_normalized text,legal_name text,business_activity text,tax_address text,tax_commune text,tax_city text,tax_email text,unique(tenant_id,customer_id));
create table public.tenant_members(tenant_id uuid,user_id uuid,role text,is_active boolean,primary key(tenant_id,user_id));
create table public.platform_admins(user_id uuid primary key,role text,is_active boolean);
create function public.is_platform_admin(p_user_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from platform_admins where user_id=p_user_id and role='super_admin' and is_active)$$;
create function public.is_tenant_member(p_tenant_id uuid,p_user_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from tenant_members where tenant_id=p_tenant_id and user_id=p_user_id and role in ('owner','admin') and is_active)$$;
create function public.dte_activation_gate_report(uuid,integer,boolean) returns jsonb language sql stable as $$select '{
  "ready":false,"issuerDataExact":true,"issuerLegalNameMatch":true,
  "typeAuthorized":true,"certificateCurrent":true,"certificateKeyMatch":true,
  "certificateRutMatch":true,"officialTrustAnchor":true,"authenticTypeCaf":false,
  "foliosAvailable":false,"tenantAwareLedger":true,"privateStorage":true,
  "productionEndpoints":true,"officialXsd":true,"xmlDsig":true,
  "workerConfigured":true,"migrationsApplied":true,"offlinePreflightComplete":true,
  "documentEngineReady":false,"globalFeatureEnabled":true
}'::jsonb$$;
create function public.normalize_chilean_rut(text) returns text language sql immutable as $$select upper(regexp_replace(trim($1),'[^0-9Kk-]','','g'))$$;
create function public.create_public_appointment(
  p_tenant_id uuid,p_professional_id uuid,p_service_id uuid,p_start_at timestamptz,
  p_customer_id uuid,p_customer_name text,p_customer_phone text,p_customer_email text,
  p_notes text,p_payment_required boolean,p_payment_status text,p_manage_token_hash text,
  p_manage_token_expires_at timestamptz,p_idempotency_key text
) returns table(appointment_id uuid,duplicate boolean) language plpgsql as $$begin
  appointment_id:=gen_random_uuid();duplicate:=false;return next;
end$$;
grant execute on function public.is_platform_admin(uuid),public.is_tenant_member(uuid,uuid) to authenticated,service_role;

create table public.services(id uuid primary key,tenant_id uuid not null references tenants(id),name text not null,description text,duration_min integer,price numeric,currency text,is_active boolean,created_at timestamptz default now(),tax_treatment text,unique(tenant_id,id));
create table public.appointments(id uuid primary key,tenant_id uuid not null references tenants(id),customer_id uuid,service_id uuid,service_name text,service_price numeric,price numeric,payment_required boolean,payment_status text,payment_provider text,payment_reference text,payment_url text,payment_required_amount numeric,payment_paid_amount numeric,payment_remaining_amount numeric,status text,booking_status text,requested_document_type integer,updated_at timestamptz default now(),unique(tenant_id,id));
create table public.payment_intents(id uuid primary key,tenant_id uuid not null references tenants(id),appointment_id uuid not null,provider text,provider_payment_id text,buy_order text,session_id text,amount numeric,currency text,status text,idempotency_key text,audit_metadata jsonb default '{}',processed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),unique(tenant_id,id));
create table public.payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,appointment_id uuid,external_reference text,amount numeric,status text,provider text,currency text,payment_intent_id uuid,audit_metadata jsonb default '{}',processed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.billing_sales(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),customer_id uuid not null,payment_intent_id uuid,currency text,status text,net_amount bigint,tax_amount bigint,total_amount bigint,paid_amount bigint default 0,payment_snapshot jsonb,requested_document_type integer,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),unique(tenant_id,id));
create table public.billing_sale_items(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,sale_id uuid not null,service_id uuid,position integer,description text,quantity integer,unit_net_amount bigint,discount_basis_points integer default 0,discount_amount bigint,net_amount bigint,tax_amount bigint,total_amount bigint,pricing_mode text,catalog_unit_gross_amount bigint,service_snapshot jsonb default '{}',created_at timestamptz default now(),unique(tenant_id,sale_id,position));
create table public.billing_sale_appointments(tenant_id uuid,sale_id uuid,appointment_id uuid,created_at timestamptz default now(),primary key(tenant_id,sale_id,appointment_id));
alter table public.billing_sales enable row level security;
revoke all on public.billing_sales from anon,authenticated;
grant select on public.billing_sales to authenticated;
create policy billing_sales_tenant_read on public.billing_sales for select to authenticated
  using(public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));
create table public.dte_payment_document_intents(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,appointment_id uuid not null,payment_intent_id uuid,status text,immutable_snapshot jsonb default '{}');
create table public.dte_issuance_outbox(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  intent_id uuid not null references dte_payment_document_intents(id),
  status text not null default 'PENDING',
  available_at timestamptz not null default now(),
  last_safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,intent_id)
);
create table public.dte_production_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,dte_type integer,issue_date date not null default current_date,created_at timestamptz not null default now());
create table public.dte_production_cafs(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,dte_type integer,active boolean default true);
create table public.dte_production_folio_ledger(tenant_id uuid,dte_type integer,folio integer,state text,document_id uuid,issued_at timestamptz,primary key(tenant_id,dte_type,folio));
create table public.dte_production_artifacts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,document_id uuid not null,kind text,storage_key text,sha256 text,byte_length bigint,content_type text,created_at timestamptz default now());
create table public.dte_production_submission_attempts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,document_id uuid not null);
create table public.dte_production_audit(id bigint generated always as identity primary key,tenant_id uuid not null,document_id uuid,action text,metadata_safe jsonb default '{}');
create table public.dte_invoice_drafts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,sale_id uuid,customer_id uuid,appointment_id uuid,payment_intent_id uuid,dte_type integer,source text,status text,issuer_preview jsonb,recipient_preview jsonb,net_amount bigint,tax_amount bigint,total_amount bigint,payment_amount_snapshot bigint,review_reason text,idempotency_key text,unique(tenant_id,id));
create table public.dte_invoice_draft_lines(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,draft_id uuid,service_id uuid,appointment_id uuid,position integer,description text,quantity integer,unit_net_amount bigint,discount_basis_points integer,discount_amount bigint,net_amount bigint,tax_amount bigint,total_amount bigint,pricing_mode text,catalog_unit_gross_amount bigint,catalog_snapshot jsonb);
create table public.tenant_payment_settings(tenant_id uuid primary key,active boolean,updated_at timestamptz);
create table public.dte_tenant_issuance_settings(tenant_id uuid primary key,production_enabled boolean,issuance_mode text,updated_at timestamptz);
create table public.dte_tenant_document_capabilities(tenant_id uuid,environment text,dte_type integer,customer_selection_enabled boolean,admin_draft_enabled boolean,issuance_enabled boolean,certification_status text,endpoint_profile text,schema_version text,updated_at timestamptz,primary key(tenant_id,environment,dte_type));
create table public.dte_production_tenant_settings(
  tenant_id uuid primary key,issuer_legal_name text,issuer_rut text,
  issuer_activity text,issuer_activity_code text,issuer_address text,
  issuer_commune text,issuer_city text
);
