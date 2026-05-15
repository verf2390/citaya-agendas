-- Citaya DTE/SII post-migration checks.
-- LAB / PENDIENTE / NO PRODUCTIVO.
-- Ejecutar manualmente despues de aplicar DTE_SUPABASE_MIGRATION.sql en Supabase LAB/certification.
-- Las secciones marcadas LAB TEST son opcionales y deben ejecutarse solo con tenants de prueba.

-- 1) Tablas esperadas.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'tenant_dte_settings',
    'tenant_dte_certificates_metadata',
    'tenant_dte_caf_files_metadata',
    'tenant_dte_folio_ranges',
    'tenant_dte_folio_ledger',
    'tax_documents',
    'tax_document_sii_submissions',
    'tax_document_status_history',
    'tax_document_audit_log'
  )
order by table_name;

-- 2) RLS habilitado.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and (tablename like 'tenant_dte%' or tablename like 'tax_document%' or tablename = 'tax_documents')
order by tablename;

-- 3) Policies DTE.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    tablename like 'tenant_dte%'
    or tablename like 'tax_document%'
    or tablename = 'tax_documents'
  )
order by tablename, policyname;

-- 4) Indices.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and (
    tablename like 'tenant_dte%'
    or tablename like 'tax_document%'
    or tablename = 'tax_documents'
  )
order by tablename, indexname;

-- 5) Constraints.
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid::regclass::text in (
  'tenant_dte_settings',
  'tenant_dte_certificates_metadata',
  'tenant_dte_caf_files_metadata',
  'tenant_dte_folio_ranges',
  'tenant_dte_folio_ledger',
  'tax_documents',
  'tax_document_sii_submissions',
  'tax_document_status_history',
  'tax_document_audit_log'
)
order by table_name::text, conname;

-- 6) No debe haber columnas para tokens completos o private keys planas.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    table_name like 'tenant_dte%'
    or table_name like 'tax_document%'
    or table_name = 'tax_documents'
  )
  and lower(column_name) similar to '%(token|private_key|password|secret)%'
order by table_name, column_name;
-- Esperado: token_fingerprint y secret_ref pueden existir; no deben existir token/private_key/password planos.

-- 7) Comments existen.
select c.relname as table_name, obj_description(c.oid) as table_comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'tenant_dte_settings',
    'tenant_dte_certificates_metadata',
    'tenant_dte_caf_files_metadata',
    'tenant_dte_folio_ranges',
    'tenant_dte_folio_ledger',
    'tax_documents',
    'tax_document_sii_submissions',
    'tax_document_status_history',
    'tax_document_audit_log'
  )
order by c.relname;

-- 8) RLS helper readiness.
select
  to_regclass('public.tenant_members') as tenant_members_table,
  to_regclass('public.platform_admins') as platform_admins_table,
  public.dte_current_user_is_tenant_admin(gen_random_uuid()) as tenant_admin_false_for_random,
  public.dte_current_user_is_platform_admin() as platform_admin_for_current_user;

-- 9) LAB TEST opcional: unique tenant/environment/document_type/folio.
-- Reemplazar UUID por tenant demo real. Ejecutar en transaccion y rollback.
/*
begin;
insert into public.tax_documents (
  tenant_id, environment, document_type, folio, status, sii_status,
  emitter_rut, emitter_name, receiver_rut, receiver_name,
  issue_date, total_amount
) values (
  '00000000-0000-0000-0000-000000000000', 'lab', 'boleta_afecta', 1001,
  'draft', 'not_sent', '76.123.456-0', 'Tenant Demo', '11.111.111-1',
  'Cliente Demo', current_date, 11900
);

-- Debe fallar por unique constraint:
insert into public.tax_documents (
  tenant_id, environment, document_type, folio, status, sii_status,
  emitter_rut, emitter_name, receiver_rut, receiver_name,
  issue_date, total_amount
) values (
  '00000000-0000-0000-0000-000000000000', 'lab', 'boleta_afecta', 1001,
  'draft', 'not_sent', '76.123.456-0', 'Tenant Demo', '11.111.111-1',
  'Cliente Demo', current_date, 11900
);
rollback;
*/

-- 10) LAB TEST opcional: constraints de status/environment deben fallar.
/*
begin;
insert into public.tax_documents (
  tenant_id, environment, document_type, folio, status, sii_status,
  emitter_rut, emitter_name, receiver_rut, receiver_name,
  issue_date, total_amount
) values (
  '00000000-0000-0000-0000-000000000000', 'production', 'boleta_afecta', 1002,
  'draft', 'not_sent', '76.123.456-0', 'Tenant Demo', '11.111.111-1',
  'Cliente Demo', current_date, 11900
);
rollback;
*/

-- 11) Tenant A no ve tenant B.
-- Ejecutar desde Supabase con usuarios/memberships LAB reales y comparar resultados:
-- set role authenticated;
-- set request.jwt.claim.sub = '<user_id_tenant_a>';
-- select tenant_id, id from public.tax_documents;
-- Esperado: solo tenant A si public.tenant_members esta configurado.

-- 12) Service role puede insertar.
-- Validar desde backend LAB con DTE_PERSISTENCE_BACKEND=supabase y npm run dte:persistence:trace.
