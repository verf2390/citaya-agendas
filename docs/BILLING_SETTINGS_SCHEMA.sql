-- Base de facturacion electronica para Citaya.
-- Etapa 1: solo configuracion tributaria por tenant. No integra SII ni emite DTE.

create table if not exists public.tenant_billing_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  legal_name text,
  tax_id text,
  business_activity text,
  tax_address text,
  tax_commune text,
  tax_city text,
  tax_email text,
  tax_phone text,
  default_document_type text default 'boleta',
  provider text default 'none',
  provider_status text default 'not_configured',
  auto_issue_on_paid boolean default false,
  allow_invoice_request boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id),
  constraint tenant_billing_default_document_type_check
    check (default_document_type in ('boleta', 'factura', 'exenta')),
  constraint tenant_billing_provider_check
    check (provider in ('none', 'manual_sii', 'api_provider')),
  constraint tenant_billing_provider_status_check
    check (provider_status in ('not_configured', 'pending', 'connected', 'error'))
);

create index if not exists tenant_billing_settings_tenant_id_idx
  on public.tenant_billing_settings (tenant_id);

-- Tabla futura para historial de documentos tributarios.
-- Mantener comentada hasta conectar proveedor DTE/API y definir el flujo final.
--
-- create table if not exists public.tax_documents (
--   id uuid primary key default gen_random_uuid(),
--   tenant_id uuid not null references public.tenants(id) on delete cascade,
--   appointment_id uuid null,
--   payment_id uuid null,
--   customer_id uuid null,
--   document_type text not null,
--   status text not null default 'draft',
--   folio text,
--   amount integer,
--   recipient_name text,
--   recipient_tax_id text,
--   recipient_email text,
--   provider text,
--   provider_document_id text,
--   pdf_url text,
--   xml_url text,
--   sii_track_id text,
--   issued_at timestamptz,
--   created_at timestamptz default now(),
--   updated_at timestamptz default now(),
--   constraint tax_documents_status_check
--     check (status in ('draft', 'pending', 'issued', 'rejected', 'cancelled', 'error'))
-- );
