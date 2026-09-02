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

-- Fase 7-10: schema objetivo citaya_own_dte.
-- Documentacion solamente; revisar nombres antes de aplicar.

create table if not exists tenant_dte_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null default 'certification',
  certificate_secret_ref text not null,
  certificate_subject text null,
  certificate_rut text null,
  certificate_fingerprint text null,
  expires_at timestamptz null,
  status text not null default 'pending_validation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_caf_ranges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_type text not null,
  environment text not null default 'certification',
  range_from integer not null,
  range_to integer not null,
  caf_secret_ref text not null,
  caf_hash text not null,
  authorization_date date not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, document_type, environment, range_from, range_to)
);

create table if not exists tenant_folio_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  caf_range_id uuid not null references tenant_caf_ranges(id),
  document_type text not null,
  environment text not null default 'certification',
  next_folio integer not null,
  locked_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, caf_range_id)
);

alter table tax_documents
  add column if not exists environment text not null default 'certification',
  add column if not exists document_type_code integer null,
  add column if not exists xml_path text null,
  add column if not exists xml_hash text null,
  add column if not exists pdf_path text null,
  add column if not exists sii_reject_code text null,
  add column if not exists sii_reject_message text null,
  add column if not exists signed_at timestamptz null,
  add column if not exists sent_at timestamptz null,
  add column if not exists accepted_at timestamptz null,
  add column if not exists rejected_at timestamptz null,
  add column if not exists idempotency_key text null;

create unique index if not exists tax_documents_unique_tenant_type_folio_idx
  on tax_documents (tenant_id, document_type, folio)
  where folio is not null;

create unique index if not exists tax_documents_unique_idempotency_idx
  on tax_documents (tenant_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists tax_document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid not null references tax_documents(id) on delete cascade,
  event_type text not null,
  previous_status text null,
  next_status text null,
  actor_user_id uuid null,
  actor_service text null,
  sii_track_id text null,
  sii_status text null,
  error_code text null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tax_document_events_document_idx
  on tax_document_events (tax_document_id, created_at desc);

create index if not exists tax_document_events_tenant_idx
  on tax_document_events (tenant_id, created_at desc);
