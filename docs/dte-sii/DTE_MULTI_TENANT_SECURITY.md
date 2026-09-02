# DTE Multi-Tenant Security

Estado: **LAB / PENDIENTE / NO PRODUCTIVO** hasta certificacion/aprobacion SII real.

## Reglas

- Un tenant no puede ver certificados, CAF, folios, documentos ni respuestas SII de otro tenant.
- RLS es obligatoria para todas las tablas DTE.
- Certificado, private key y CAF deben vivir fuera del repo y fuera del frontend.
- No exponer secretos al navegador, logs, errores, toasts ni payloads API.
- Logs solo pueden incluir hashes, rutas abstractas o metadata no sensible.
- Cada emision debe generar audit log con actor, tenant, documento, IP/evento y resultado.
- Platform admin opera solo soporte auditado; no emision cruzada sin trazabilidad.
- Cada tenant emite con su propio RUT. Citaya no emite por todos con su RUT.
- Separar `lab`, `certification` y `production` a nivel configuracion, storage y permisos.
- Backups deben cifrar metadata sensible y referencias a storage seguro.
- Rotacion de certificados debe permitir vigencia, reemplazo y desactivacion sin perder auditoria.

## Secretos

Permitido:

- Rutas absolutas fuera del repo.
- Referencias a vault/KMS/storage seguro.
- Metadata publica de certificado.

No permitido:

- `.pem`, `.pfx`, `.key`, CAF reales o XML sensibles dentro de `docs/`, `lib/`, `app/`, `scripts/`.
- Contenido de llaves privadas en DB plana.
- Certificados/CAF reales servidos por endpoints admin.

## Supabase/RLS DTE

`DTE_SUPABASE_MIGRATION.sql` propone RLS para todas las tablas DTE con estas reglas:

- `tenant_members` owner/admin puede leer solo su `tenant_id` si la tabla live existe con `tenant_id`, `user_id`, `role`.
- `staff`, `viewer` y `professional` no tienen acceso DTE inicialmente.
- `platform_admins` puede revisar soporte con trazabilidad si la tabla live existe con `user_id`.
- Si existe columna `active`, debe ser true.
- Inserts/updates quedan restringidos al backend con service role.
- Service role no debe existir en cliente/browser.
- Policies deben ajustarse al modelo real de membresia antes de aplicar.
- Si `tenant_members` o `platform_admins` no existen o no tienen columnas esperadas, las funciones RLS endurecidas retornan `false`.
- La migracion evita `on delete cascade` en documentos tributarios para no borrar auditoria por accidente.

Las rutas `/api/admin/dte-lab/traces` validan usuario + tenant por host/slug/id, usan `tenant_members`/`platform_admins` cuando existan, mantienen fallback legacy solo para compatibilidad del admin actual y devuelven solo metadata redactada. Siguen siendo **LAB / PENDIENTE / NO PRODUCTIVO**.

Pendiente antes de activar Supabase backend: aplicar en LAB/certification, ejecutar `DTE_SUPABASE_POST_MIGRATION_CHECKS.sql` y probar dos tenants distintos.
