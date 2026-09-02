# Persistencia Supabase DTE/SII

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Citaya opera como `citaya_own_dte`: cada tenant debe emitir con su propio RUT, certificado, CAF, folios y autorizacion SII. Esta capa solo deja persistencia multi-tenant lista para laboratorio/certification.

## Tablas

La migracion revisable esta en `docs/dte-sii/DTE_SUPABASE_MIGRATION.sql` e incluye:

- `tenant_dte_settings`
- `tenant_dte_certificates_metadata`
- `tenant_dte_caf_files_metadata`
- `tenant_dte_folio_ranges`
- `tenant_dte_folio_ledger`
- `tax_documents`
- `tax_document_sii_submissions`
- `tax_document_status_history`
- `tax_document_audit_log`

Todas usan `tenant_id`, UUID primary keys, timestamps, constraints de ambiente y estados, indices por tenant/status/folio/track_id y unique constraints para evitar doble folio o doble referencia.

La migracion aun **no fue aplicada**. Antes de aplicarla se debe revisar:

- `DTE_SCHEMA_COMPATIBILITY_AUDIT.md`
- `DTE_SUPABASE_POST_MIGRATION_CHECKS.sql`
- `DTE_SUPABASE_APPLY_PLAN.md`

## Que No Se Guarda

- Private keys planas.
- Tokens SII completos.
- Certificados completos.
- CAF XML completo.
- XML tributario completo en respuestas admin.
- Rutas privadas completas.

Se guardan solo hashes, fingerprints, metadata, `storage_path` redactado o referencias seguras.

## Feature Flag

Default seguro:

```bash
DTE_PERSISTENCE_BACKEND=memory
```

Supabase solo para LAB/certification revisado:

```bash
DTE_PERSISTENCE_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Si falta configuracion o tablas, el repositorio falla controladamente con:

```text
DTE_SUPABASE_PERSISTENCE_NOT_READY
```

## RLS

La migracion incluye RLS sugerida:

- Tenant admin ve solo filas de su `tenant_id` si `tenant_members` existe con columnas esperadas.
- Roles DTE iniciales: `owner`, `admin`; `staff`, `viewer` y `professional` no tienen DTE por defecto.
- Platform admin puede soporte/revision si `platform_admins` existe con columnas esperadas.
- Si existe columna `active`, debe ser true.
- Ningun tenant ve certificados, CAF, folios, documentos o auditoria de otro tenant.
- Inserts/updates quedan para backend controlado con service role.
- Policies separadas para `select`; `insert/update` directo desde cliente queda bloqueado hasta disenar self-service estricto.

El repo no incluye schema SQL confirmado para `tenant_members` ni `platform_admins`. La migracion endurecida valida existencia de tabla y columnas; si faltan, las funciones RLS retornan `false`. Si el proyecto usa tablas distintas, ajustar `dte_current_user_is_tenant_admin` y `dte_current_user_is_platform_admin` antes de aplicar.

## Como Probar Sin Produccion

```bash
npm run dte:persistence:check
npm run dte:persistence:trace
node scripts/dte/sii-certification-smoke.mjs --dry-run
```

Con Supabase activado, aplicar primero la migracion manualmente en un proyecto LAB/certification y ejecutar los checks post-migracion. No usar production.

## Endpoints Admin

- `GET /api/admin/dte-lab/traces?tenantId=...&tenantSlug=...`
- `GET /api/admin/dte-lab/traces/[id]?tenantId=...&tenantSlug=...`

Respuesta base:

```json
{
  "ok": true,
  "globalStatus": "LAB / PENDIENTE / NO PRODUCTIVO",
  "backend": "memory",
  "documents": [],
  "submissions": [],
  "auditLog": [],
  "warnings": []
}
```

Las respuestas redactan paths, tokens, IP hash, no devuelven `tokenFingerprint` y no devuelven XML completo. `requireTenantAdmin` valida JWT, tenant por host/slug/id, y usa `tenant_members`/`platform_admins` si existen; si no existen, mantiene fallback legacy solo para compatibilidad del admin actual en estado no productivo.

## Aplicacion Manual

1. Revisar `DTE_SUPABASE_MIGRATION.sql`.
2. Ajustar RLS a las tablas reales de membresia/admin.
3. Ejecutar en Supabase LAB/certification.
4. Validar indices, constraints y RLS con usuarios de tenants distintos.
5. Configurar `DTE_PERSISTENCE_BACKEND=supabase` solo en backend controlado.
6. Ejecutar `npm run dte:persistence:check`.

## Rollback Sugerido

Antes de datos reales: desactivar flag y dropear tablas DTE en orden inverso. Con datos de certification: exportar auditoria y documentos, desactivar flag, bloquear endpoints, luego planificar rollback con backup.

## Riesgos

- RLS mal adaptada puede exponer datos entre tenants.
- Service role debe quedar solo en server.
- `production` sigue bloqueado por constraints y proceso; habilitarlo requiere migracion posterior.
- Track IDs solo son validos si vienen de respuesta real SII.

## Conexion Futura Agenda/Pagos

Pendiente hasta certificacion/aprobacion SII real:

- Reservar folio transaccional al evento aprobado.
- Crear DTE desde pago/agenda.
- Firmar con certificado del tenant.
- Enviar a SII certification/production segun autorizacion.
- Persistir track_id real y estados.

## Por Que Sigue No Productivo

No hay aprobacion SII, no hay emision legal, no hay submit real desde UI, no hay agenda/pagos conectados y no se aplica migracion automaticamente.
