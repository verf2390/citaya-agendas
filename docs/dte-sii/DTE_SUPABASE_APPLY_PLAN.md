# DTE Supabase Apply Plan

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Este plan no activa produccion, no emite documentos legales, no conecta agenda/pagos y no hace submit real al SII.

## A. Antes De Aplicar

- Tomar backup/snapshot Supabase o export SQL del proyecto LAB/certification.
- Confirmar que el proyecto objetivo **no es production**.
- Leer `docs/dte-sii/DTE_SCHEMA_COMPATIBILITY_AUDIT.md` completo.
- Revisar `docs/dte-sii/DTE_SUPABASE_MIGRATION.sql` completo.
- Confirmar que no hay `on delete cascade` en tablas tributarias DTE.
- Confirmar si existe `public.tenant_members` y sus columnas reales:
  - requerido para RLS DTE: `tenant_id`, `user_id`, `role`
  - opcional soportado: `active`
  - roles DTE iniciales: `owner`, `admin`
- Confirmar si existe `public.platform_admins` y sus columnas reales:
  - requerido para soporte: `user_id`
  - opcional soportado: `active`
- Confirmar que `appointments`, `payments` y `customers` tienen IDs UUID antes de agregar FKs futuras. Esta migracion no agrega esas FKs.
- Confirmar variables de entorno disponibles para pruebas, sin activar aun:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DTE_PERSISTENCE_BACKEND=supabase` solo cuando termine la validacion SQL
- Confirmar que no se usaran certificados, CAF, tokens ni folios productivos reales.

## B. Aplicacion Manual En LAB/Certification

- Aplicar `docs/dte-sii/DTE_SUPABASE_MIGRATION.sql` manualmente en Supabase SQL editor o migracion controlada.
- No cambiar `DTE_PERSISTENCE_BACKEND` durante la aplicacion SQL.
- Ejecutar `docs/dte-sii/DTE_SUPABASE_POST_MIGRATION_CHECKS.sql`.
- Verificar tablas, RLS, policies, indices, constraints y comments.
- Probar tenant demo LAB con datos no reales.
- Probar aislamiento tenant A/B:
  - usuario tenant A no ve tenant B
  - platform admin solo si tabla real existe y fue revisada
  - sin `tenant_members/platform_admins`, SELECT autenticado debe quedar cerrado
- Validar que service role/backend puede insertar solo desde entorno server controlado.

## C. Activacion Controlada

- Activar temporalmente solo en LAB/certification:

```bash
DTE_PERSISTENCE_BACKEND=supabase
```

- Ejecutar:

```bash
npm run dte:persistence:check
npm run dte:persistence:trace
node scripts/dte/sii-certification-smoke.mjs --dry-run
npm run dte:sii:dry-run:trace
```

- Revisar `/admin/facturacion`:
  - backend `supabase`
  - `globalStatus` sigue `LAB / PENDIENTE / NO PRODUCTIVO`
  - no aparecen XML completos
  - no aparecen tokens completos ni `tokenFingerprint` en API admin
  - no aparecen private paths completos
- No conectar agenda/pagos.
- No ejecutar submit real al SII.
- No marcar documentos como aceptados salvo respuesta real SII en certification controlada.

## D. Rollback

- Volver inmediatamente a:

```bash
DTE_PERSISTENCE_BACKEND=memory
```

- No borrar tablas de inmediato.
- Revisar logs de API, Supabase y trazas DTE.
- Corregir SQL/RLS en repo.
- Reaplicar solo en LAB/certification tras nuevo backup.
- Si ya existen datos de certification, exportar documentos/auditoria antes de cualquier limpieza manual.

## Criterio Para Avanzar

Solo avanzar si:

- RLS queda validada entre tenants reales de prueba.
- `requireTenantAdmin` usa `tenant_members` o `platform_admins` cuando existan.
- Fallback legacy `host + tenant_id + slug` se entiende como compatibilidad admin actual, no como modelo final production.
- Service role inserta desde backend controlado.
- No hay paths privados ni tokens completos en responses.
- `DTE_SUPABASE_PERSISTENCE_NOT_READY` desaparece solo despues de migracion aplicada.
- Readiness sigue mostrando **LAB / PENDIENTE / NO PRODUCTIVO**.

## No Hacer En Este Bloque

- No aplicar migracion en production.
- No activar emision legal.
- No activar agenda/pagos.
- No guardar private keys, CAF XML completo, certificados completos ni tokens completos.
- No simular `track_id` real.
- No decir que facturacion esta lista para produccion legal.
