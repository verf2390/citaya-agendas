-- Citaya DTE / Tax Documents
-- Tabla futura para registrar documentos tributarios asociados a pagos, reservas y clientes.
-- Fase inicial pensada para emisión asistida vía SII MiPyme.
-- No emite DTE real todavía.

create table if not exists tax_documents (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null references tenants(id) on delete cascade,

  appointment_id uuid null,
  payment_id uuid null,
  customer_id uuid null,

  document_type text not null default 'boleta',
  issue_mode text not null default 'manual_mipyme',
  status text not null default 'pending_manual_issue',

  folio text null,

  amount integer not null default 0,
  net_amount integer null,
  tax_amount integer null,

  recipient_name text null,
  recipient_tax_id text null,
  recipient_email text null,

  sii_track_id text null,
  sii_status text null,

  pdf_url text null,
  xml_url text null,

  error_message text null,

  issued_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tax_documents_tenant_id_idx
  on tax_documents (tenant_id);

create index if not exists tax_documents_status_idx
  on tax_documents (status);

create index if not exists tax_documents_appointment_id_idx
  on tax_documents (appointment_id);

create index if not exists tax_documents_payment_id_idx
  on tax_documents (payment_id);

-- Fase futura citaya_own_dte.
-- Documentación SQL solamente: no aplicar como migración real todavía.
-- Estas tablas deben revisarse contra el diseño final de seguridad, RLS,
-- cifrado por tenant, auditoría y transacciones antes de producción.

-- Perfil tributario por tenant/contribuyente.
-- Cada tenant emite con su propio RUT, razón social, giro, certificado,
-- CAF/folios y habilitación tributaria.
create table if not exists tenant_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  tax_id text not null,
  legal_name text not null,
  business_activity text not null,
  business_activity_code text null,
  tax_address text not null,
  tax_commune text not null,
  tax_city text not null,

  dte_environment text not null default 'certification',
  sii_resolution_date date null,
  sii_resolution_number text null,

  certificate_secret_ref text null,
  certificate_subject text null,
  certificate_rut text null,
  certificate_expires_at timestamptz null,

  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rangos de folios autorizados por CAF.
-- CAF reales nunca deben quedar en texto plano ni en el repositorio.
create table if not exists tax_folio_ranges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  document_type text not null,
  range_from integer not null,
  range_to integer not null,
  current_folio integer not null,

  caf_secret_ref text not null,
  caf_hash text not null,
  authorization_date date null,
  expires_at timestamptz null,
  environment text not null default 'certification',
  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reservas de folio. En producción esto debe ser transaccional para evitar
-- doble emisión por concurrencia, reintentos o jobs duplicados.
create table if not exists tax_folio_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  folio_range_id uuid not null references tax_folio_ranges(id),
  tax_document_id uuid null references tax_documents(id),

  document_type text not null,
  folio integer not null,
  status text not null default 'reserved',

  reserved_at timestamptz not null default now(),
  used_at timestamptz null,
  released_at timestamptz null,
  voided_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tax_folio_reservations_unique_used_folio_idx
  on tax_folio_reservations (tenant_id, document_type, folio)
  where status in ('reserved', 'used');
