-- Migration: 202608040001_boleta39_manual_production_gate.sql
-- Production DTE settings and CAF model updates to support Type 39 in manual mode.
-- Safe strategy: legacy rows receive 'unclassified' or 'legacy_unknown' defaults.

begin;

-- 1. Expand dte_production_cafs to support DTE type 39.
alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_dte_type_check;

alter table public.dte_production_cafs
  add constraint dte_production_cafs_dte_type_check
  check (dte_type in (33, 34, 39, 41, 52, 56, 61));

-- Add environment column with safe default 'unclassified' (never auto-assumes production)
alter table public.dte_production_cafs
  add column if not exists environment text not null default 'unclassified';

alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_environment_check;

alter table public.dte_production_cafs
  add constraint dte_production_cafs_environment_check
  check (environment in ('unclassified', 'certification', 'production'));

-- Add status column with safe default 'unclassified' (never auto-assumes active)
alter table public.dte_production_cafs
  add column if not exists status text not null default 'unclassified';

alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_status_check;

alter table public.dte_production_cafs
  add constraint dte_production_cafs_status_check
  check (status in ('unclassified', 'pending_review', 'active', 'suspended', 'depleted', 'revoked'));

-- Safe Backfill for dte_production_cafs:
-- Mark certification/pre-caf CAFs (including Type 39 certification set and folios 16-20) explicitly as 'certification'.
update public.dte_production_cafs
set environment = 'certification',
    status = 'pending_review'
where (dte_type = 39 or (range_from >= 16 and range_to <= 20))
  and environment = 'unclassified';

-- 2. Expand dte_production_tenant_settings with authorized DTE types, authorization status and issuance mode.
alter table public.dte_production_tenant_settings
  add column if not exists authorized_types integer[] not null default '{33}';

alter table public.dte_production_tenant_settings
  add column if not exists sii_authorization_status text not null default 'pending';

alter table public.dte_production_tenant_settings
  drop constraint if exists dte_production_tenant_settings_sii_authorization_status_check;

alter table public.dte_production_tenant_settings
  add constraint dte_production_tenant_settings_sii_authorization_status_check
  check (sii_authorization_status in ('pending', 'approved', 'suspended', 'revoked'));

alter table public.dte_production_tenant_settings
  add column if not exists issuance_mode text not null default 'disabled';

alter table public.dte_production_tenant_settings
  drop constraint if exists dte_production_tenant_settings_issuance_mode_check;

alter table public.dte_production_tenant_settings
  add constraint dte_production_tenant_settings_issuance_mode_check
  check (issuance_mode in ('disabled', 'manual', 'automatic'));

-- 3. Add issuance_origin to dte_issuance_outbox with safe default 'legacy_unknown'.
alter table public.dte_issuance_outbox
  add column if not exists issuance_origin text not null default 'legacy_unknown';

alter table public.dte_issuance_outbox
  drop constraint if exists dte_issuance_outbox_origin_check;

alter table public.dte_issuance_outbox
  add constraint dte_issuance_outbox_origin_check
  check (issuance_origin in ('legacy_unknown', 'manual_admin', 'automatic_system', 'webhook_api'));

commit;
