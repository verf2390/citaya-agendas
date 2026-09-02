# DTE Schema Compatibility Audit

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Auditoria previa a aplicar `DTE_SUPABASE_MIGRATION.sql`. No se aplico migracion ni se activo `DTE_PERSISTENCE_BACKEND=supabase`.

## Alcance

Esta revision inspecciona solo evidencia disponible en el repo al 2026-05-20. No reemplaza inspeccion del schema live en Supabase LAB/certification antes de aplicar la migracion.

## Evidencia Confirmada Por Repo

| Area | Evidencia | Decision DTE |
| --- | --- | --- |
| `tenants` | Multiples rutas consultan `tenants.id` y `tenants.slug`; `docs/BILLING_SETTINGS_SCHEMA.sql`, `docs/WAITLIST_REQUESTS_SCHEMA.sql` y `docs/MESSAGE_LOGS_SCHEMA.sql` referencian `tenants(id)`. | `tenant_id uuid not null references public.tenants(id) on delete restrict` es la unica FK externa obligatoria en DTE. |
| columnas usadas de `tenants` | Codigo usa `id`, `slug`, `name`, `logo_url`, `phone_display`, `whatsapp`, `contact_email`, `admin_email`, datos publicos de direccion y flags de visibilidad. | DTE no depende de `admin_email`; solo valida `id + slug` en auth legacy. |
| `appointments` | `app/api/admin/appointments/range/route.ts` selecciona `id`, `tenant_id`, `customer_id`, `start_at`, `status`, `booking_status`, `payment_status`, `payment_provider`, montos y referencias de pago. `docs/FLEXIBLE_PAYMENTS_SCHEMA.sql` agrega campos de pago a `appointments`. | `appointment_id` queda nullable sin FK hasta inspeccionar DB live; agenda/pagos no se conectan todavia. |
| `payments` | Webhook Mercado Pago inserta en `payments` con `tenant_id`, `appointment_id`, `external_reference`, `amount`, `status`. No hay SQL canonico de `payments` en repo. | `payment_id` queda nullable sin FK; `payment_reference` queda texto nullable. |
| `customers` | `app/api/customers/list/route.ts` selecciona `id`, `tenant_id`, `full_name`, `phone`, `email`, `notes`, `created_at`. No hay SQL canonico de `customers` en repo. | `customer_id` queda nullable sin FK hasta inspeccionar DB live. |
| waitlist | `docs/WAITLIST_REQUESTS_SCHEMA.sql` confirma `waitlist_requests` con `tenant_id` y RLS enabled, pero no participa del flujo DTE. | No se agrega FK ni alerta DTE sobre waitlist. |
| RLS existente | `docs/WAITLIST_REQUESTS_SCHEMA.sql` habilita RLS, pero indica que clientes/admin deben pasar por APIs con service role. No hay patron RLS multi-tenant general confirmado para admin. | DTE RLS queda cerrada por defecto y solo abre SELECT si `tenant_members/platform_admins` live tienen columnas esperadas. |
| `tenant_members` | No existe schema SQL en repo; solo referencias documentales/TODO. | RLS y `requireTenantAdmin` lo usan solo si la tabla existe con `tenant_id`, `user_id`, `role`; `active` se respeta si existe. |
| `platform_admins` | No existe schema SQL en repo; solo referencias documentales/TODO. | RLS y `requireTenantAdmin` lo usan solo si la tabla existe con `user_id`; `active` se respeta si existe. |
| `admin_email` legacy | Existe en codigo como email/contacto de tenant/campanas/reschedule, no como tabla de permisos. | No se usa como autorizacion DTE amplia. |
| Supabase admin/service role | Rutas API usan `supabaseAdmin` para server-side queries tenant-scoped. | Inserts/updates DTE quedan para backend service role; cliente autenticado no escribe directo. |

## Supuestos De La Migracion DTE

- `public.tenants(id)` existe y es UUID.
- DTE usa `tenant_id` obligatorio en todas las tablas.
- `auth.uid()` esta disponible en Supabase RLS.
- Service role opera solo desde backend controlado.
- `tenant_members` y `platform_admins` pueden existir en Supabase real, pero no estan confirmadas por repo.

## Relaciones Seguras Ahora

- FK real: todas las tablas DTE referencian `public.tenants(id)` con `on delete restrict`.
- FK real entre tablas DTE: submissions/history/audit referencian documentos o submissions sin cascada destructiva.
- Referencias externas nullable: `appointment_id`, `payment_id`, `customer_id`, `payment_reference`.
- Unique fuerte: `tenant_id + environment + document_type + folio` para documentos y ledger.
- Produccion bloqueada: `check (environment <> 'production')` en documentos/submissions y `tenant_dte_settings` no puede tener `enabled=true` en production.

## RLS DTE Propuesta

- `tenant_members`: SELECT solo si existe tabla live con `tenant_id`, `user_id`, `role`; roles permitidos inicialmente: `owner`, `admin`. Si existe `active`, debe ser true.
- `platform_admins`: SELECT soporte solo si existe tabla live con `user_id`; si existe `active`, debe ser true.
- Si la tabla o columnas no existen, las funciones retornan `false`.
- No hay INSERT/UPDATE directo desde clientes autenticados para documentos tributarios.
- Service role bypasses RLS y debe quedar solo en APIs server-side auditadas.

## Riesgos Detectados

- El repo no trae schema real de `tenant_members`; no se puede garantizar RLS por rol hasta inspeccionar Supabase.
- El repo no trae schema real de `platform_admins`; soporte platform admin queda desactivado si la tabla no existe.
- Agregar FK a `appointments/payments/customers` sin revisar tipos exactos puede romper la migracion.
- El patron admin actual usa sesion + host/slug/tenant_id en varias pantallas; `requireTenantAdmin` mantiene fallback legacy solo si no existen tablas de permisos.
- `service role` bypasses RLS; debe quedar solo en API server.
- No debe haber `on delete cascade` en documentos tributarios.

## Ajustes Necesarios Antes De Aplicar

1. Confirmar en Supabase real:
   - `public.tenant_members` existe o no existe.
   - columnas: `tenant_id uuid`, `user_id uuid`, `role text`, opcional `active boolean`.
   - roles validos: `owner`, `admin`; decidir si `staff` tendra lectura DTE en una migracion posterior.
2. Confirmar `public.platform_admins(user_id uuid, active boolean opcional)` o ajustar funcion.
3. Confirmar tipos exactos de:
   - `appointments.id`, `appointments.tenant_id`
   - `payments.id`, `payments.tenant_id`
   - `customers.id`, `customers.tenant_id`
4. Ejecutar `DTE_SUPABASE_POST_MIGRATION_CHECKS.sql` despues de aplicar en LAB/certification.
5. Probar dos tenants LAB distintos antes de activar `DTE_PERSISTENCE_BACKEND=supabase`.

## Decision Actual

La migracion queda lista para revision manual en LAB/certification, con guards conservadores para RLS real. Si `tenant_members/platform_admins` no existen o no tienen las columnas esperadas, las policies no exponen datos al frontend: retornan `false` y solo service role backend puede operar.
