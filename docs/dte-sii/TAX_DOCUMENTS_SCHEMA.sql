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
