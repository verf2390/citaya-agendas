-- Citaya DTE/SII Supabase migration draft.
-- LAB / PENDIENTE / NO PRODUCTIVO.
-- Revisar y aplicar manualmente. Este archivo NO activa emision legal, submit SII,
-- track_id real, agenda/pagos ni produccion.
-- Enfoque citaya_own_dte: cada tenant emite con su propio RUT/certificado/CAF/folios.
-- No guardar private keys planas, tokens completos, certificados completos ni CAF XML completo.

create extension if not exists pgcrypto;

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
  unique (tenant_id),
  check (environment <> 'production' or enabled = false)
);

comment on table tenant_dte_settings is
  'Citaya DTE settings por tenant. NO PRODUCTIVO hasta certificacion/aprobacion SII real por tenant.';

create table if not exists tenant_dte_certificates_metadata (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null check (environment in ('lab', 'certification', 'production')),
  certificate_rut text not null,
  subject text,
  issuer text,
  serial_number text,
  fingerprint_sha256 text not null,
  valid_from timestamptz,
  valid_to timestamptz,
  storage_path_redacted text,
  secret_ref text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment, fingerprint_sha256)
);

comment on table tenant_dte_certificates_metadata is
  'Solo metadata/fingerprint/referencias seguras de certificados DTE. Nunca private keys planas ni certificados completos.';

create table if not exists tenant_dte_caf_files_metadata (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_type text not null,
  environment text not null check (environment in ('lab', 'certification', 'production')),
  issuer_rut text not null,
  range_from integer not null,
  range_to integer not null,
  authorization_date date not null,
  expires_at date,
  caf_sha256 text not null,
  storage_path_redacted text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (range_from > 0 and range_to >= range_from),
  unique (tenant_id, environment, document_type, range_from, range_to),
  unique (tenant_id, environment, document_type, caf_sha256)
);

comment on table tenant_dte_caf_files_metadata is
  'Metadata CAF por tenant/document_type. No guardar XML CAF completo ni llave CAF plana.';

create table if not exists tenant_dte_folio_ranges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  caf_file_id uuid references tenant_dte_caf_files_metadata(id) on delete restrict,
  document_type text not null,
  environment text not null check (environment in ('lab', 'certification', 'production')),
  range_from integer not null,
  range_to integer not null,
  next_candidate integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (range_from > 0 and range_to >= range_from),
  check (next_candidate between range_from and range_to),
  unique (tenant_id, environment, document_type, range_from, range_to)
);

comment on table tenant_dte_folio_ranges is
  'Rangos de folios por tenant/CAF. Requiere transacciones antes de emision real.';

create table if not exists tenant_dte_folio_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  folio_range_id uuid references tenant_dte_folio_ranges(id) on delete restrict,
  document_type text not null,
  environment text not null check (environment in ('lab', 'certification', 'production')),
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
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment, document_type, folio),
  unique (tenant_id, document_reference)
);

comment on table tenant_dte_folio_ledger is
  'Ledger de folios por tenant. Evita doble uso; no conecta agenda/pagos todavia.';

create table if not exists tax_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null default 'lab' check (environment in ('lab', 'certification', 'production')),
  document_type text not null,
  folio integer not null,
  status text not null check (status in ('draft', 'xml_generated', 'signed', 'submitted', 'accepted', 'accepted_with_observations', 'rejected', 'cancelled', 'failed')),
  sii_status text not null default 'not_sent' check (sii_status in ('not_sent', 'sent', 'processing', 'accepted', 'accepted_with_observations', 'rejected', 'unknown', 'failed')),
  emitter_rut text not null,
  emitter_name text not null,
  receiver_rut text not null,
  receiver_name text not null,
  issue_date date not null,
  total_amount integer not null check (total_amount >= 0),
  net_amount integer,
  tax_amount integer,
  exempt_amount integer,
  xml_storage_path text,
  xml_sha256 text,
  pdf_storage_path text,
  appointment_id uuid,
  payment_id uuid,
  payment_reference text,
  customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment, document_type, folio),
  unique (tenant_id, appointment_id, document_type),
  unique (tenant_id, payment_id, document_type),
  unique (tenant_id, payment_reference, document_type),
  check (environment <> 'production')
);

comment on table tax_documents is
  'Documentos tributarios Citaya LAB/certification. NO PRODUCTIVO; production bloqueado hasta aprobacion SII real.';

create table if not exists tax_document_sii_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid not null references tax_documents(id) on delete cascade,
  environment text not null check (environment in ('lab', 'certification', 'production')),
  track_id text,
  submission_status text not null default 'draft' check (submission_status in ('draft', 'dry_run', 'blocked', 'submitted', 'failed')),
  sii_status text not null default 'unknown' check (sii_status in ('not_sent', 'sent', 'processing', 'accepted', 'accepted_with_observations', 'rejected', 'unknown', 'failed')),
  request_xml_sha256 text,
  response_sha256 text,
  raw_response_redacted jsonb,
  token_fingerprint text,
  submitted_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, track_id),
  check (environment <> 'production')
);

comment on table tax_document_sii_submissions is
  'Submissions SII LAB/certification. Guardar token_fingerprint, nunca token completo. track_id solo si viene de SII real.';

create table if not exists tax_document_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid not null references tax_documents(id) on delete cascade,
  submission_id uuid references tax_document_sii_submissions(id) on delete set null,
  previous_status text,
  next_status text not null check (next_status in ('draft', 'xml_generated', 'signed', 'submitted', 'accepted', 'accepted_with_observations', 'rejected', 'cancelled', 'failed')),
  previous_sii_status text,
  next_sii_status text not null check (next_sii_status in ('not_sent', 'sent', 'processing', 'accepted', 'accepted_with_observations', 'rejected', 'unknown', 'failed')),
  reason text not null,
  source text not null check (source in ('system', 'admin', 'sii', 'webhook', 'script')),
  created_by uuid,
  created_at timestamptz not null default now()
);

comment on table tax_document_status_history is
  'Historial auditable de estados DTE/SII por tenant. No acredita emision legal por si solo.';

create table if not exists tax_document_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tax_document_id uuid references tax_documents(id) on delete set null,
  submission_id uuid references tax_document_sii_submissions(id) on delete set null,
  action text not null,
  actor_type text not null check (actor_type in ('system', 'admin', 'tenant_user', 'script')),
  actor_id uuid,
  metadata_redacted jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

comment on table tax_document_audit_log is
  'Audit log redactado. No guardar secretos, XML completo, tokens completos ni rutas privadas completas.';

create index if not exists idx_tenant_dte_settings_tenant on tenant_dte_settings (tenant_id);
create index if not exists idx_tenant_dte_certificates_tenant on tenant_dte_certificates_metadata (tenant_id, environment, active);
create index if not exists idx_tenant_dte_caf_tenant_type on tenant_dte_caf_files_metadata (tenant_id, environment, document_type, active);
create index if not exists idx_tenant_dte_folio_ranges_tenant_type on tenant_dte_folio_ranges (tenant_id, environment, document_type, active);
create index if not exists idx_tenant_dte_folio_ledger_lookup on tenant_dte_folio_ledger (tenant_id, document_type, folio, status);
create index if not exists idx_tax_documents_tenant_status on tax_documents (tenant_id, status, sii_status);
create index if not exists idx_tax_documents_folio on tax_documents (tenant_id, document_type, folio);
create index if not exists idx_tax_documents_track_status on tax_document_sii_submissions (tenant_id, track_id, sii_status);
create index if not exists idx_sii_submissions_document on tax_document_sii_submissions (tenant_id, tax_document_id, created_at desc);
create index if not exists idx_sii_submissions_status on tax_document_sii_submissions (tenant_id, submission_status, sii_status);
create index if not exists idx_tax_document_status_history_document on tax_document_status_history (tenant_id, tax_document_id, created_at desc);
create index if not exists idx_tax_document_audit_log_document on tax_document_audit_log (tenant_id, tax_document_id, created_at desc);

alter table tenant_dte_settings enable row level security;
alter table tenant_dte_certificates_metadata enable row level security;
alter table tenant_dte_caf_files_metadata enable row level security;
alter table tenant_dte_folio_ranges enable row level security;
alter table tenant_dte_folio_ledger enable row level security;
alter table tax_documents enable row level security;
alter table tax_document_sii_submissions enable row level security;
alter table tax_document_status_history enable row level security;
alter table tax_document_audit_log enable row level security;

-- RLS sugerida. Ajustar nombres si el proyecto usa tablas distintas.
-- tenant_members: tenant_id uuid, user_id uuid, role text
-- platform_admins: user_id uuid
create or replace function dte_current_user_is_tenant_admin(row_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from tenant_members tm
    where tm.tenant_id = row_tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
  );
$$;

create or replace function dte_current_user_is_platform_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from platform_admins pa where pa.user_id = auth.uid()
  );
$$;

-- SELECT: tenant admin ve solo su tenant; platform admin puede soporte/revision.
create policy tenant_dte_settings_select on tenant_dte_settings
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tenant_dte_certificates_select on tenant_dte_certificates_metadata
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tenant_dte_caf_select on tenant_dte_caf_files_metadata
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tenant_dte_folio_ranges_select on tenant_dte_folio_ranges
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tenant_dte_folio_ledger_select on tenant_dte_folio_ledger
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tax_documents_select on tax_documents
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tax_document_sii_submissions_select on tax_document_sii_submissions
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tax_document_status_history_select on tax_document_status_history
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());
create policy tax_document_audit_log_select on tax_document_audit_log
  for select using (dte_current_user_is_tenant_admin(tenant_id) or dte_current_user_is_platform_admin());

-- INSERT/UPDATE: backend controlado con service role. Usuarios autenticados no insertan DTE directo.
-- Supabase service role bypasses RLS; mantenerlo solo en server/API controlada y auditar accion.
-- Si se requiere self-service admin futuro, crear policies separadas y estrictas por tenant_id.
