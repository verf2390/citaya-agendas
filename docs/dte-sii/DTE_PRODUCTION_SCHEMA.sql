-- Citaya DTE/SII future schema.
-- NO PRODUCTIVO hasta completar certificacion/aprobacion SII real por tenant.
-- No aplicar automaticamente: revisar RLS, storage seguro, backups y migraciones.

create table if not exists tenant_dte_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enabled boolean not null default false,
  environment text not null default 'lab' check (environment in ('lab', 'certification', 'production')),
  issuer_rut text not null,
  issuer_legal_name text not null,
  issuer_business_activity text not null,
  issuer_business_activity_code text,
  issuer_address text not null,
  issuer_commune text not null,
  issuer_city text not null,
  sii_resolution_date date,
  sii_resolution_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create table if not exists tenant_dte_certificates_metadata (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null check (environment in ('certification', 'production')),
  certificate_rut text not null,
  subject text,
  issuer text,
  serial_number text,
  valid_from timestamptz,
  valid_to timestamptz,
  public_certificate_storage_ref text not null,
  private_key_secret_ref text not null,
  private_key_encrypted boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tenant_dte_caf_files_metadata (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_type text not null,
  environment text not null check (environment in ('certification', 'production')),
  issuer_rut text not null,
  range_from integer not null,
  range_to integer not null,
  authorization_date date not null,
  expires_at date,
  caf_hash text not null,
  caf_storage_ref text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (range_from > 0 and range_to >= range_from),
  unique (tenant_id, document_type, range_from, range_to)
);

create table if not exists tenant_dte_folio_ranges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  caf_file_id uuid not null references tenant_dte_caf_files_metadata(id),
  document_type text not null,
  range_from integer not null,
  range_to integer not null,
  next_candidate integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (range_from > 0 and range_to >= range_from),
  check (next_candidate between range_from and range_to)
);

create table if not exists tenant_dte_folio_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  folio_range_id uuid not null references tenant_dte_folio_ranges(id),
  document_type text not null,
  folio integer not null,
  status text not null check (status in ('available', 'reserved', 'used', 'voided', 'expired')),
  tax_document_id uuid,
  appointment_id uuid,
  payment_id uuid,
  document_reference text,
  reserved_at timestamptz,
  used_at timestamptz,
  voided_at timestamptz,
  expires_at date,
  created_at timestamptz not null default now(),
  unique (tenant_id, document_type, folio),
  unique (tenant_id, document_reference)
);

create table if not exists tax_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_type text not null,
  folio integer not null,
  status text not null check (status in ('draft', 'xml_generated', 'signed', 'submitted', 'accepted', 'accepted_with_observations', 'rejected', 'cancelled', 'failed')),
  sii_status text not null default 'not_sent' check (sii_status in ('not_sent', 'sent', 'processing', 'accepted', 'accepted_with_observations', 'rejected', 'unknown')),
  issuer_rut text not null,
  recipient_rut text not null,
  issue_date date not null,
  net_amount integer default 0,
  exempt_amount integer default 0,
  tax_amount integer default 0,
  total_amount integer not null,
  appointment_id uuid,
  payment_id uuid,
  payment_reference text,
  customer_id uuid,
  xml_storage_ref text,
  signed_xml_storage_ref text,
  print_sample_storage_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, document_type, folio),
  unique (tenant_id, appointment_id, document_type),
  unique (tenant_id, payment_id, document_type),
  unique (tenant_id, payment_reference, document_type)
);

create table if not exists tax_document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid not null references tax_documents(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tax_document_sii_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid not null references tax_documents(id) on delete cascade,
  environment text not null check (environment in ('certification', 'production')),
  track_id text,
  token_redacted text,
  token_requested_at timestamptz,
  submitted_at timestamptz,
  checked_at timestamptz,
  sii_status text not null default 'unknown',
  request_storage_ref text,
  response_storage_ref text,
  safe_raw_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique (tenant_id, track_id)
);

create table if not exists tax_document_sii_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sii_submission_id uuid not null references tax_document_sii_submissions(id) on delete cascade,
  track_id text,
  raw_status text,
  internal_status text not null,
  message text,
  safe_raw_response jsonb,
  checked_at timestamptz not null default now()
);

create table if not exists tax_document_print_samples (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid not null references tax_documents(id) on delete cascade,
  sample_type text not null default 'pre_certification',
  storage_ref text not null,
  watermark text not null default 'LAB / NO PRODUCTIVO / MUESTRA PRE-CERTIFICACION',
  created_at timestamptz not null default now()
);

create table if not exists tax_document_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid,
  actor_user_id uuid,
  action text not null,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tenant_dte_folio_ledger_lookup on tenant_dte_folio_ledger (tenant_id, document_type, folio, status);
create index if not exists idx_tax_documents_tenant_status on tax_documents (tenant_id, status, sii_status);
create index if not exists idx_tax_documents_folio on tax_documents (tenant_id, document_type, folio);
create index if not exists idx_tax_documents_appointment on tax_documents (tenant_id, appointment_id);
create index if not exists idx_tax_documents_payment on tax_documents (tenant_id, payment_id);
create index if not exists idx_sii_submissions_track_id on tax_document_sii_submissions (tenant_id, track_id);

-- RLS sugerido:
-- alter table tenant_dte_settings enable row level security;
-- Repetir para todas las tablas DTE.
-- Politicas: tenant_id debe coincidir con membresia del usuario autenticado.
-- Platform admin solo soporte auditado; nunca emitir cruzado sin evento en tax_document_audit_log.
-- Private keys no se guardan planas: usar private_key_secret_ref hacia vault/KMS/storage seguro.
