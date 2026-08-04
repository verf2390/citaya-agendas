-- Rollback Migration: 202608040001_boleta39_manual_production_gate.down.sql
-- Reverts schema changes introduced by 202608040001_boleta39_manual_production_gate.sql

begin;

alter table public.dte_issuance_outbox
  drop constraint if exists dte_issuance_outbox_origin_check,
  drop column if exists issuance_origin;

alter table public.dte_production_tenant_settings
  drop constraint if exists dte_production_tenant_settings_sii_authorization_status_check,
  drop constraint if exists dte_production_tenant_settings_issuance_mode_check,
  drop column if exists issuance_mode,
  drop column if exists sii_authorization_status,
  drop column if exists authorized_types;

alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_status_check,
  drop constraint if exists dte_production_cafs_environment_check,
  drop column if exists status,
  drop column if exists environment;

alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_dte_type_check;

alter table public.dte_production_cafs
  add constraint dte_production_cafs_dte_type_check
  check (dte_type in (33, 34, 41, 52, 56, 61));

commit;
