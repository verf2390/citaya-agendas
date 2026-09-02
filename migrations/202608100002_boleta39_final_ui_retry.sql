begin;

create table if not exists public.dte_boleta39_final_retry_attempts (
  document_id uuid primary key references public.dte_production_documents(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  intent_id uuid not null references public.dte_payment_document_intents(id) on delete restrict,
  outbox_id uuid not null references public.dte_issuance_outbox(id) on delete restrict,
  artifact_id uuid not null references public.dte_production_artifacts(id) on delete restrict,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  dte_type integer not null check (dte_type = 39),
  folio integer not null check (folio = 40014),
  status text not null check (status in ('claimed','received','failed')),
  actor_id uuid not null,
  preflight_safe jsonb not null default '{}'::jsonb,
  response_safe jsonb,
  response_sha256 text,
  track_id_fingerprint text,
  retry_after_seconds integer,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, document_id),
  unique (tenant_id, artifact_id)
);

alter table public.dte_boleta39_final_retry_attempts enable row level security;

comment on table public.dte_boleta39_final_retry_attempts is
  'One-shot UI retry lock and sanitized result for the existing Boleta 39 folio 40014. A row is permanent and forbids another upload.';

commit;
