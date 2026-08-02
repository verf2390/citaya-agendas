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

create table public.tenants(id uuid primary key,slug text unique,name text);
create table public.customers(id uuid primary key,tenant_id uuid not null references tenants(id),full_name text,email text,phone text,rut_normalized text,unique(tenant_id,id));
create table public.tenant_members(tenant_id uuid,user_id uuid,role text,is_active boolean,primary key(tenant_id,user_id));
create table public.platform_admins(user_id uuid primary key,role text,is_active boolean);
create function public.is_platform_admin(p_user_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from platform_admins where user_id=p_user_id and role='super_admin' and is_active)$$;
create function public.is_tenant_member(p_tenant_id uuid,p_user_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from tenant_members where tenant_id=p_tenant_id and user_id=p_user_id and role in ('owner','admin') and is_active)$$;
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
create table public.dte_payment_document_intents(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,appointment_id uuid not null);
create table public.dte_production_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,dte_type integer);
create table public.dte_invoice_drafts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,sale_id uuid,customer_id uuid,appointment_id uuid,payment_intent_id uuid,dte_type integer,source text,status text,issuer_preview jsonb,recipient_preview jsonb,net_amount bigint,tax_amount bigint,total_amount bigint,payment_amount_snapshot bigint,review_reason text,idempotency_key text,unique(tenant_id,id));
create table public.dte_invoice_draft_lines(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,draft_id uuid,service_id uuid,appointment_id uuid,position integer,description text,quantity integer,unit_net_amount bigint,discount_basis_points integer,discount_amount bigint,net_amount bigint,tax_amount bigint,total_amount bigint,pricing_mode text,catalog_unit_gross_amount bigint,catalog_snapshot jsonb);
create table public.tenant_payment_settings(tenant_id uuid primary key,active boolean,updated_at timestamptz);
create table public.dte_tenant_issuance_settings(tenant_id uuid primary key,production_enabled boolean,issuance_mode text,updated_at timestamptz);
create table public.dte_tenant_document_capabilities(tenant_id uuid,environment text,dte_type integer,customer_selection_enabled boolean,admin_draft_enabled boolean,issuance_enabled boolean,certification_status text,updated_at timestamptz,primary key(tenant_id,environment,dte_type));
