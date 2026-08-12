-- Immutable artifact revisions: existing rows remain version 1 and cannot be
-- updated/deleted. New cryptographic repairs are appended as higher versions.
alter table public.dte_production_artifacts
  add column if not exists version integer not null default 1;

alter table public.dte_production_artifacts
  drop constraint if exists dte_production_artifacts_tenant_id_document_id_kind_key;

alter table public.dte_production_artifacts
  drop constraint if exists dte_production_artifacts_version_positive;

alter table public.dte_production_artifacts
  add constraint dte_production_artifacts_version_positive
  check (version > 0);

create unique index if not exists dte_production_artifacts_document_kind_version_unique
  on public.dte_production_artifacts(tenant_id, document_id, kind, version);

create index if not exists dte_production_artifacts_latest_version_idx
  on public.dte_production_artifacts(tenant_id, document_id, kind, version desc);

-- A current revision is selected explicitly. Artifact rows remain immutable;
-- promotion only changes this small pointer row.
create unique index if not exists dte_production_artifacts_head_fk_unique
  on public.dte_production_artifacts(tenant_id, document_id, kind, version, id);

create table if not exists public.dte_production_artifact_heads (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null references public.dte_production_documents(id) on delete restrict,
  kind text not null check (kind in ('dte_xml','envio_xml','pdf','sii_response')),
  version integer not null check (version > 0),
  artifact_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, document_id, kind),
  unique (artifact_id),
  foreign key (tenant_id, document_id, kind, version, artifact_id)
    references public.dte_production_artifacts(tenant_id, document_id, kind, version, id)
    on delete restrict
);

insert into public.dte_production_artifact_heads(
  tenant_id,
  document_id,
  kind,
  version,
  artifact_id
)
select distinct on (tenant_id, document_id, kind)
  tenant_id,
  document_id,
  kind,
  version,
  id
from public.dte_production_artifacts
order by tenant_id, document_id, kind, version desc, created_at desc, id
on conflict (tenant_id, document_id, kind) do nothing;

alter table public.dte_production_artifact_heads enable row level security;

comment on table public.dte_production_artifact_heads is
  'Explicit current pointer for immutable DTE production artifact revisions.';
