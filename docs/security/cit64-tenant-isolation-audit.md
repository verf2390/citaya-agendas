# CIT-64 — Aislamiento multi-tenant: evidencia estructural y PostgreSQL local

Fecha de corte: 2026-09-08

Branch auditada: `feat/cit-64-tenant-isolation-audit`

## Resultado

La exploración estática de `app/api/**/route.ts` encontró **66 rutas** con referencias directas a `supabaseAdmin`, `supabaseServer`, `SUPABASE_SERVICE_ROLE_KEY` o `service_role`.

| Estado | Rutas |
|---|---:|
| OK | 66 |
| REVIEW_REQUIRED | 0 |
| FINDING | 0 |

El inventario ejecutable y la justificación individual por ruta están en `tests/security/fixtures/cit64-tenant-boundaries.mjs`. La prueba compara ese allow-list con el descubrimiento real: una ruta privilegiada nueva o eliminada sin actualizar el inventario hace fallar el test. Estar en el inventario no equivale a estar declarada segura: `FINDING` y `REVIEW_REQUIRED` son valores válidos y se informan como diagnóstico.

El conteo anterior clasifica el código de las 66 rutas, no certifica permisos de una base desplegada. El P2 transversal de privacidad pública de tenant tiene corrección local preparada (grants + API + páginas), pero su cierre operativo queda pendiente de aplicar la nueva migration y desplegar/verificar el código; no se ejecutó ninguno de esos pasos. Ver la sección de privacidad pública al final.

La evidencia estructural y los tests de rutas con dependencias simuladas se complementan ahora con **31/31 tests PostgreSQL locales, sobre 25 proyecciones mínimas de tablas**, descritos en la sección «Evidencia PostgreSQL A/B real». No es un clon del schema completo ni una certificación del estado desplegado. No se conectó a Supabase remoto, no se contactó al SII y no se usaron secretos, certificados, CAF, folios ni DTE reales.

## Boundaries reconocidos

| Clase | Condición mínima |
|---|---|
| `tenant_admin` | Invoca `requireTenantAdmin`; el tenant solicitado se cruza con `tenant_members(tenant_id,user_id)` o con un `super_admin` activo. |
| `host_tenant_admin` | Invoca `requireHostTenantAdmin`; el tenant se obtiene del hostname y luego pasa por `requireTenantAdmin`. |
| `platform_admin` | Invoca `requirePlatformAdmin`; exige `platform_admins.role = super_admin` activo. |
| `production_admin` | Invoca `requireProductionAdmin`; `lib/dte/production/api.ts` ignora hints del cliente y termina en `requireHostTenantAdmin(req)`. |
| `public_manage_token` | Autoriza el recurso exacto con `authorizeAppointmentActor`, hash+pepper, expiración/revocación, o admin del tenant del recurso. |
| `public_tenant_lookup` | Flujo público de booking; debe resolver tenant/slug explícitamente y acotar recursos hijos a ese tenant. |
| `provider_callback` | El identificador del proveedor resuelve un intent; credenciales del tenant y verificación del proveedor preceden la transición. |
| `public_verification` | Flujo expresamente público con atributos verificadores/rate limit y tenant derivado o cruzado. |
| `public_media` | Archivo creado por el servidor para distribución pública; path y tipo se restringen explícitamente. |

## Inventario de rutas privilegiadas

### Administración de tenant, servicios, profesionales y disponibilidad

| Superficie | Ruta/helper | Boundary | Tenant binding | Estado | Severidad | Evidencia |
|---|---|---|---|---|---|---|
| tenant config | `app/api/admin/tenant/route.ts` | `host_tenant_admin` | Config pública y update exclusivamente por id=`access.tenantId`. | OK | none | GET autentica antes de lectura; PATCH antes de JSON; hints slug ignorados y errores internos genéricos. Evidencia: `tests/security/cit64-admin-tenant-auth-order.test.mjs`. |
| tenants | `app/api/admin/platform/tenants/route.ts` | `platform_admin` | Acceso global deliberado, limitado a super admin. | OK | none | `requirePlatformAdmin` antes de listar/provisionar/archivar/cambiar modo. |
| tenants | `app/api/tenants/by-slug/route.ts` | `public_tenant_lookup` | Slug activo; queries dependientes por `data.id`; contacto público condicionado por flags home. | OK | none | Teléfono/dirección solo si flag home === true; address_display usa datos públicos. Test: `cit64-public-tenant-privacy.test.mjs`. Grants anon verificados en PostgreSQL efímero por CIT-64 A/B; aplicación a base desplegada pendiente. |
| services | `app/api/admin/services/list/route.ts` | `tenant_admin` | `tenant_id` autenticado. | OK | none | `requireTenantAdmin` y `.eq("tenant_id", tenantId)`. |
| services | `app/api/admin/services/route.ts` | `host_tenant_admin` | Lista/insert por `access.tenantId`; fetch/update/desactivación por id+tenant. | OK | none | GET/POST/PATCH/DELETE autentican antes de JSON/queries; errores 500 genéricos. Evidencia: `tests/security/cit64-admin-services-auth-order.test.mjs`. |
| services | `app/api/services/by-tenant/route.ts` | `public_tenant_lookup` | Slug activo -> `t.id`; solo servicios activos del tenant. | OK | none | `.eq("tenant_id", t.id).eq("is_active", true)`. |
| services | `app/api/services/by-tenant/by-id/route.ts` | `public_tenant_lookup` | Slug activo y operacional; service id+tenant+activo, con payment readiness fuera de demo. | OK | none | Corregido: `.eq("id", id).eq("tenant_id", tenant.id).eq("is_active", true)`; test conductual CIT-64. |
| professionals | `app/api/admin/professionals/list/route.ts` | `tenant_admin` | Slug -> tenant autorizado -> professionals por tenant. | OK | none | `requireTenantAdmin` y `.eq("tenant_id", tenantId)`. |
| professionals | `app/api/professionals/by-tenant/route.ts` | `public_tenant_lookup` | Slug/cookie demo resuelve tenant activo; professionals por tenant y activos. | OK | none | `.eq("tenant_id", tenantId).eq("active", true)`. |
| availability | `app/api/admin/availability/list/route.ts` | `tenant_admin` | Professional y availability deben pertenecer al tenant autorizado. | OK | none | Professional `.eq("id", professionalId).eq("tenant_id", tenantId)`. |
| availability | `app/api/admin/availability/upsert/route.ts` | `host_tenant_admin` | Professional y availability vinculados a `access.tenantId`; IDs incoming verificados dentro del profesional/tenant. | OK | none | Auth antes de JSON/validación; errores DB genéricos. Evidencia: `tests/security/cit64-availability-auth-order.test.mjs`. |
| availability | `app/api/admin/service-rules/list/route.ts` | `tenant_admin` | Tenant, professional y service en el filtro. | OK | none | `requireTenantAdmin` y triple binding. |
| availability | `app/api/admin/service-rules/upsert/route.ts` | `host_tenant_admin` | Profesional/servicio validados por id+tenant antes de REPLACE; filas y DELETE por tenant+professional+service. | OK | none | Auth antes de JSON, hints ignorados, foreign/inexistente comparten 400 y errores DB genéricos. Evidencia: `tests/security/cit64-service-rules-isolation.test.mjs`. Atomicidad pendiente como consistencia separada. |
| availability | `app/api/appointments/availability/route.ts` | `public_tenant_lookup` | Availability, reglas y citas se consultan con `effectiveTenantId`. | OK | none | Tenant activo; tres queries con `.eq("tenant_id", effectiveTenantId)`. |

### Customers, appointments y waitlist

| Superficie | Ruta/helper | Boundary | Tenant binding | Estado | Severidad | Evidencia |
|---|---|---|---|---|---|---|
| customers | `app/api/customers/list/route.ts` | `tenant_admin` | Customer/appointment por tenant autorizado. | OK | none | `requireTenantAdmin`; ambas queries usan `tenant_id`. |
| customers | `app/api/customers/search/route.ts` | `tenant_admin` | Search por tenant autorizado. | OK | none | `.eq("tenant_id", tenantId)` posterior al boundary. |
| customers | `app/api/customers/create/route.ts` | `tenant_admin` | Customers y validación de professional por `access.tenantId`; professional validado antes de writes. | OK | none | Auth-order fue falso positivo: Bearer precede JSON. P2 real de asignación de profesional ajeno corregido; foreign/inexistente comparten 400. Evidencia: `tests/security/cit64-customer-professional-isolation.test.mjs`. |
| customers | `app/api/customers/[id]/history/route.ts` | `tenant_admin` | Customer, citas, services y professionals por tenant. | OK | none | Customer id+tenant y relaciones con `tenant_id`. |
| customer tax profile | `app/api/admin/customers/[id]/tax-profile/route.ts` | `host_tenant_admin` | `authorize()` demuestra customer dentro del hostname tenant antes de leer/escribir. | OK | none | Customer y profile filtran `auth.tenantId`. |
| customer tax profile | `app/api/customers/tax-profile/lookup/route.ts` | `public_verification` | Tenant+RUT+email deben coincidir; profile vuelve a filtrar tenant+customer. | OK | none | Rate limit y respuestas opacas 404. |
| appointments | `app/api/admin/appointments/range/route.ts` | `tenant_admin` | Citas e intents usan `access.tenantId`. | OK | none | `.eq("tenant_id", access.tenantId)`. |
| appointments | `app/api/admin/appointments/mark-paid/route.ts` | `host_tenant_admin` | RPC por `access.tenantId`; lectura final por id + tenant. | OK | none | Auth precede JSON y validación de appointmentId; pago/DTE/capabilities/notificación sin cambios. Evidencia: `tests/security/cit64-mark-paid-auth-order.test.mjs`. |
| appointments | `app/api/appointments/create/route.ts` | `public_tenant_lookup` + admin condicional | Público cruza `tenantId` con host/slug; admin pasa por membership; child ids están tenant-scoped. | OK | none | `resolveTenantForPublicRequest`, `requireTenantAdmin`, service/professional id+tenant. |
| appointments | `app/api/appointments/by-id/route.ts` | `public_manage_token` | El read inicial por id no responde hasta autorizar el tenant del recurso o su manage token. | OK | none | `authorizeAppointmentActor({ appointment: data })`; PII reducida para no-admin. |
| appointments | `app/api/appointments/by-token/route.ts` | `public_manage_token` | Hash/legacy token resuelve la cita y vuelve a validarse. | OK | none | Hash con pepper, expiración/revocación y `authorizeAppointmentActor`. |
| appointments | `app/api/appointments/cancel/route.ts` | `public_manage_token` | Update por id sobre la cita exacta autorizada por token. | OK | none | Actor autorizado antes del update; token queda revocado. |
| appointments | `app/api/appointments/reschedule/route.ts` | `public_manage_token` | Service/availability usan tenant del recurso autorizado; update es sobre esa cita. | OK | none | `authorizeAppointmentActor` antes de queries/mutación. |
| appointments cancel | `app/api/appointments/cancel-by-id/route.ts` | `host_tenant_admin` | Read/update por id+`access.tenantId`; capabilities y efectos usan el mismo tenant. | OK | none | Auth antes de JSON; cita ajena/inexistente devuelven idéntico 404. Evidencia: `tests/security/cit64-cancel-by-id-isolation.test.mjs`. |
| appointments reschedule | `app/api/appointments/reschedule-by-id/route.ts` | `host_tenant_admin` | Read/update id+tenant; overlap, admin_email y efectos usan `access.tenantId`. | OK | none | Auth antes de JSON; cita ajena/inexistente con idéntico 404; errores genéricos. Evidencia: `tests/security/cit64-reschedule-by-id-isolation.test.mjs`. |
| appointment helper | `lib/api/appointmentAccess.ts#authorizeAppointmentActor` | recurso/admin | Tenant tomado de la cita, no del cliente; token con hash/pepper y estado usable. | OK | none | `requireTenantAdmin({ tenantId: appointment.tenant_id })`; token expirado/revocado falla. |
| appointment helper | `lib/api/appointmentAccess.ts#rotateAppointmentManageToken` | caller pendiente | Update por `appointmentId` sin `tenant_id`; no se encontraron invocaciones runtime. | FINDING | P2 | Líneas ~79–98; deuda preventiva sin caller actual. |
| appointment helper | `lib/api/appointmentAccess.ts#revokeAppointmentManageToken` | caller pendiente | Update por `appointmentId` sin `tenant_id`; no se encontraron invocaciones runtime. | FINDING | P2 | Líneas ~103–112; deuda preventiva sin caller actual. |
| waitlist | `app/api/admin/waitlist/route.ts` | `tenant_admin` | Waitlist y services usan tenant autorizado. | OK | none | `requireTenantAdmin` y filtros `tenant_id`. |
| waitlist | `app/api/admin/waitlist/[id]/route.ts` | `tenant_admin` | PATCH/DELETE combinan id con tenant autorizado. | OK | none | Context compartido + `.eq("id", resolved.id).eq("tenant_id", resolved.tenantId)`. |
| waitlist | `app/api/waitlist/create/route.ts` | `public_tenant_lookup` | Host/slug resuelve tenant; service/professional se validan en él. | OK | none | Rate limit; child ids con `tenant_id`; insert fija ese tenant. |

### Pagos, campañas, legal y media

| Superficie | Ruta/helper | Boundary | Tenant binding | Estado | Severidad | Evidencia |
|---|---|---|---|---|---|---|
| billing settings | `app/api/admin/billing-settings/route.ts` | `host_tenant_admin` | Lectura/upsert/respuesta exclusivamente por `access.tenantId`. | OK | none | GET autentica antes de DB; PUT antes de JSON/Zod. Hints query/body ignorados, errores 500 genéricos y schemaHint eliminado. Evidencia: `tests/security/cit64-billing-settings-isolation.test.mjs`. |
| payment settings | `app/api/admin/payment-settings/route.ts` | `host_tenant_admin` | Config/select/update/insert/respuestas por `access.tenantId`. | OK | none | Auth precede configuración/DB y POST body/credenciales/banco; hints ignorados, masking intacto, errores genéricos sin schemaHint. Evidencia: `tests/security/cit64-payment-settings-isolation.test.mjs`. |
| payment intent | `app/api/payments/create/route.ts` | `public_manage_token` | Cita por id -> actor del recurso -> todas las queries derivan `appointment.tenant_id`. | OK | none | Actor antes de crear intent; service/customer/sale con tenant. |
| payment intent | `app/api/appointments/payment-instructions/route.ts` | `public_manage_token` | Intent usa tenant+appointment de la cita autorizada. | OK | none | `authorizeAppointmentActor` antes de leer payment intents. |
| payment admin | `app/api/admin/payments/resend/route.ts` | `tenant_admin` | Slug resuelve tenant, membership y appointment id+tenant. | OK | none | `.eq("id", appointmentId).eq("tenant_id", tenant.id)`. |
| payment admin | `app/api/admin/payments/mercadopago/confirm/route.ts` | `host_tenant_admin` | Intent id+tenant+provider; verificación provider antes del RPC tenant-scoped. | OK | none | `verifyMercadoPagoPayment`; RPC con `p_tenant_id`. |
| Webpay return | `app/api/payments/webpay/return/route.ts` | `provider_callback` | Token de Webpay resuelve intent; commit con credencial del tenant se verifica. | OK | none | `getTenantWebpayCredentials` y `verifyWebpayCommit`. |
| Khipu webhook | `app/api/webhooks/khipu/route.ts` | `provider_callback` | Payment id resuelve intent; firma y consulta API usan secreto del tenant. | OK | none | `verifyKhipuSignature` y `verifyKhipuPayment`. |
| Mercado Pago webhook | `app/api/webhooks/mercadopago/route.ts` | `provider_callback` | Intent deriva tenant; payment remoto se obtiene con su access token y se cruza. | OK | none | `getTenantPaymentConfig(intent.tenant_id)` y `verifyMercadoPagoPayment`. |
| campaign | `app/api/admin/campaigns/send/route.ts` | `tenant_admin` | Tenant por slug autorizado; customers/consents/appointments tenant-scoped. | OK | none | `requireTenantAdmin`; queries con `tenant_id`. |
| campaign | `app/api/admin/messages/send/route.ts` | `tenant_admin` | `tenant_id`+`tenant_slug` cruzados antes del dispatch. | OK | none | `requireTenantAdmin` antes de webhook externo. |
| campaign logs | `app/api/admin/logs/messages/route.ts` | `tenant_admin` | Slug -> tenant autorizado -> log con ese `tenant_id`. | OK | none | Membership antes del insert. |
| marketing | `app/api/public/marketing/revoke/route.ts` | `public_verification` | Tenant activo por host/slug; RPC recibe su id y destino solicitado. | OK | none | `resolveTenantForPublicRequest`, rate limit, `p_tenant_id: tenant.id`. |
| media/storage | `app/api/admin/campaigns/upload-media/route.ts` | `host_tenant_admin` | Storage path y media URL usan exclusivamente `access.tenantId`; filename UUID del servidor. | OK | none | Boundary autenticado antes de `formData()`, tamaño, bytes y validación; evidencia: `tests/security/cit64-campaign-upload-auth-order.test.mjs`. |
| media/storage | `app/api/media/campaigns/[...path]/route.ts` | `public_media` | Distribución pública deliberada por tenant UUID + server UUID; no es un boundary de confidencialidad. | OK | none | Upload produce esta URL; route limita path/extensión/tipo y responde `Cache-Control: public`. |
| legal | `app/api/admin/legal/route.ts` | `host_tenant_admin` | Profile/document/RPC usan hostname tenant. | OK | none | Filtros `tenant_id`, owner tenant y auditoría de lectura restringida. |
| legal público | `lib/legal/server.ts` | `public_tenant_lookup` | Tenant activo y documentos/perfil/settings por ese tenant. | OK | none | `resolveTenantForPublicRequest`; queries con `tenant_id`. |

### DTE, artifacts, CAF y folios

| Superficie | Ruta/helper | Boundary | Tenant binding | Estado | Severidad | Evidencia |
|---|---|---|---|---|---|---|
| DTE settings | `app/api/admin/dte-settings/route.ts` | `host_tenant_admin` | Settings, policy y gates usan `auth.tenantId`. | OK | none | Auth antes de PATCH; reads/writes/RPC tenant-scoped. |
| DTE activation | `app/api/admin/dte-activation/route.ts` | `host_tenant_admin` + platform mutation | Reads por hostname tenant; activar/pausar exige `authMode=platform_admin`. | OK | none | RPCs reciben `auth.tenantId`. |
| DTE authorization | `app/api/admin/dte-authorization/route.ts` | `host_tenant_admin` + platform mutation | Evidencia por hostname tenant; mutaciones solo platform admin. | OK | none | `auth.authMode !== "platform_admin"` fail-closed; RPCs con tenant autenticado. |
| DTE intents | `app/api/admin/dte-intents/reference-data/route.ts` | `host_tenant_admin` | Customers/citas/payments/profiles/settings/services por hostname tenant. | OK | none | Cada query usa `auth.tenantId`. |
| DTE intents | `app/api/admin/dte-intents/manual/route.ts` | `host_tenant_admin` | Customer/cita/payment/service/DTE original por hostname tenant. | OK | none | Resource ids siempre combinados con `auth.tenantId`. |
| DTE intents | `app/api/admin/dte-intents/[id]/route.ts` | `host_tenant_admin` | Intent/outbox/events por tenant+intent. | OK | none | Tres queries con `auth.tenantId`. |
| DTE intents | `app/api/admin/dte-intents/[id]/note/route.ts` | `host_tenant_admin` | Original, gates y nuevo intent usan hostname tenant. | OK | none | Original id+tenant; inserted `tenant_id=auth.tenantId`. |
| DTE intents | `app/api/admin/dte-intents/[id]/process-manual/route.ts` | `host_tenant_admin` | Intent/outbox y mutación por tenant. | OK | none | id/intent id acompañados por `auth.tenantId`. |
| DTE intents | `app/api/admin/dte-intents/[id]/process-automatic/route.ts` | `host_tenant_admin` | Intent/outbox/snapshot por tenant. | OK | none | Queries usan `auth.tenantId`. |
| DTE intents | `app/api/admin/dte-intents/[id]/retry-billing-coverage/route.ts` | `host_tenant_admin` | RPC recibe tenant del hostname. | OK | none | `p_tenant_id: auth.tenantId`. |
| DTE delivery | `app/api/admin/dte-intents/[id]/email/route.ts` | `host_tenant_admin` | Intent/artifacts/outbox/event por hostname tenant. | OK | none | Resource ids acompañados de `auth.tenantId`. |
| invoice drafts | `app/api/admin/invoice-drafts/route.ts` | `host_tenant_admin` | Listing/create/customer/service/payment por hostname tenant. | OK | none | Todas las relaciones incluyen `auth.tenantId`. |
| invoice drafts | `app/api/admin/invoice-drafts/[id]/route.ts` | `host_tenant_admin` | Draft/lines/customer/services/update/delete por tenant+id. | OK | none | Doble filtro en mutaciones. |
| invoice drafts | `app/api/admin/invoice-drafts/[id]/issue-preview/route.ts` | `host_tenant_admin` | Draft/customer/CAF/folio por tenant. | OK | none | CAF y ledger incluyen tenant+dte type; draft id+tenant. |
| invoice drafts | `app/api/admin/invoice-drafts/[id]/issue/route.ts` | `host_tenant_admin` | Draft y issuance RPCs reciben tenant autenticado. | OK | none | Draft id+tenant; outbox mutation tenant-scoped. |
| DTE production artifact | `app/api/admin/dte-production/[id]/artifacts/[kind]/route.ts` | `production_admin` | Hints del cliente ignorados; service `download(tenant,id,kind)`. | OK | none | `requireProductionAdmin` -> `requireHostTenantAdmin`; audit usa tenant autenticado. |
| DTE production status | `app/api/admin/dte-production/[id]/status/route.ts` | `production_admin` | Status query, intent lookup y RPC usan `auth.tenantId`. | OK | none | `requireProductionAdmin(req)` sin parsing ni hints del body; lógica DTE/SII intacta. Evidencia: `tests/security/cit64-dte-status-auth-order.test.mjs`. |
| production repository | `lib/dte/production/supabase-repository.ts` | tenant-required repository | Documento y artifacts por tenant+id. | OK | none | `getDocument(tenantId,id)` y operaciones relacionadas filtran `tenant_id`. |
| production preflight | `lib/dte/production/server.ts` | production service | Relación por document id se reconcilia con tenant/type/document/operation; CAF y folio disponible son tenant-scoped. | OK | none | `resolvePreparationFolioPreflight` rechaza relación de otro tenant. |
| DTE admin rows | `lib/dte/admin-document-rows.ts` | authenticated tenant argument | Intents/drafts/production/artifacts por tenant; customer ids derivan de drafts ya tenant-scoped. | OK | none | Batch customer read no acepta ids del request; ids vienen de `rawDrafts`. |
| DTE appointment context | `lib/dte/admin-appointment-document-context.ts` | authenticated tenant argument | Appointments/sales/payments/drafts/intents/production por tenant. | OK | none | Todas las queries privilegiadas incluyen `tenant_id`. |
| DTE legacy persistence | `lib/dte/persistence/supabase-dte-repository.ts` | tenant-required repository | Rechaza tenant vacío; reads/updates id-based incluyen tenant. | OK | none | `updateDocument`, submission y status usan `tenant_id`. |
| CAF/folios gate | `lib/dte/boleta39-manual-gate.ts` | authenticated tenant argument | Settings/CAF/ledger/outbox por tenant. | OK | none | Todas las queries usan `input.tenantId`. |
| DTE worker | `lib/dte/automation/worker.ts` | internal worker secret | Claim global deliberado; la fila claimada aporta `tenant_id`; mutaciones posteriores usan id+tenant. | OK | none | `app/api/internal/dte-worker/route.ts` autentica secreto antes del body; worker conserva `item.tenant_id`. |
| boleta pública | `app/api/public/boleta-verification/route.ts` | `public_verification` | Issuer RUT deriva tenant; documento y artifact usan ese tenant y tuple completo. | OK | none | Rate limit, `matchesPublicBoletaVerification`, document/artifact tenant-scoped. |

## Inventario de infraestructura/helper restante

| Superficie | Ruta/helper | Boundary | Tenant binding | Estado | Severidad | Evidencia |
|---|---|---|---|---|---|---|
| auth | `lib/api/requireTenantAdmin.ts` | authentication | Membership por tenant+user; super admin separado. | OK | none | Revisión manual previa: bearer, tenant real, roles activos y hostname delegation. |
| rate limiting | `lib/security/request.ts` | rate-limit RPC | No accede a recursos de negocio; key opaca. | OK | none | Único uso privilegiado: `consume_api_rate_limit`. |
| operational mode | `lib/tenant/operational-server.ts` | tenant capability | Lookups por tenant; intent/payment checks combinan tenant+id. | OK | none | `loadTenantOperationalContext(tenantId)` y filtros tenant-scoped. |
| client factory | `lib/supabaseAdmin.ts` | server-only factory | Sin operación de recurso. | OK | none | Cliente lazy con service-role; es la capacidad a controlar. |
| client alias | `lib/supabaseServer.ts` | alias | Sin operación de recurso. | OK | none | Reexport explícito de `supabaseAdmin`. |
| tests | `lib/dte/__tests__/dte-persistence.test.ts` | test only | Fixtures/assertions. | OK | none | Manipula env local y prueba aislamiento; no runtime. |
| tests | `lib/dte/__tests__/dte-production.test.ts` | test only | Aserción negativa textual. | OK | none | `SUPABASE_SERVICE_ROLE_KEY` aparece en `doesNotMatch`. |
| tests | `lib/dte/__tests__/dte-sii-certification-client.test.ts` | test only | Secretos sintéticos para redaction tests. | OK | none | No crea cliente runtime. |

## Hallazgos

### P0

Ninguno demostrado.

### P1

Ninguno demostrado.

### P2

No quedan findings abiertos de rutas en el inventario CIT-64. El último, service-rules/upsert, se corrigió tanto en auth-order como en validación de pertenencia de profesional/servicio; ver evidencia al final. La clasificación OK corresponde al aislamiento revisado y no implica ausencia de toda deuda de consistencia.

1. **Helpers preventivos de manage token actualizan solo por id** — `lib/api/appointmentAccess.ts`, líneas aproximadas 79–112. `rotateAppointmentManageToken()` y `revokeAppointmentManageToken()` no reciben ni filtran `tenant_id`. No existen callers runtime al corte; por eso no hay flujo explotable actual. Si en el futuro una ruta pasa un id controlado sin autorizar el recurso exacto, service-role permitiría mutar una cita de otro tenant. La prueba mantiene esta deuda visible.

## Finding corregido en esta fase

**Lectura pública de service sin tenant binding** — `app/api/services/by-tenant/by-id/route.ts`.

El endpoint ahora requiere `id` UUID y `tenant` slug válido, resuelve únicamente un tenant con `lifecycle_status=active`, aplica `resolveTenantOperationalCapabilities` y responde 404 si no permite `createAppointment` ni `demoSimulation`. El service se consulta con id+tenant+activo; fuera de demo también exige `payment_configuration_complete=true`. La respuesta ya no incluye `tenant_id`, los errores de Supabase/Postgres se sustituyen por `Error interno` y todas las respuestas conservan `Cache-Control: no-store`.

`tests/security/cit64-service-by-id-isolation.test.mjs` ejecuta el handler con un cliente Supabase simulado y demuestra: validación 400, tenant inexistente/inactivo/no operacional 404, acceso propio 200, UUID foreign 404, service inactivo 404, payment incompleto live 404, excepción demo controlada y ausencia de filtración de `message/details/hint`.

## REVIEW_REQUIRED y revisión manual

No quedaron rutas privilegiadas en `REVIEW_REQUIRED` después de seguir los boundaries y los tenant bindings en el código local. Las superficies que exigieron revisión manual específica fueron:

- callbacks Webpay/Khipu/Mercado Pago: intent derivado del identificador del proveedor, credencial del tenant y verificación del pago antes de finalizar;
- media pública de campañas: se confirmó como URL pública deliberada generada por el upload autenticado, con nombre UUID generado por servidor y tipos limitados;
- reads iniciales por appointment id/token: se confirmó `authorizeAppointmentActor` antes de responder o mutar;
- DTE production status/artifacts: se confirmó que `requireProductionAdmin` descarta tenant hints y delega en hostname;
- queries id-only en helpers: los customer ids de `admin-document-rows` derivan de drafts tenant-scoped; el preflight de folios reconcilia tenant/type/document/operation; rotate/revoke quedan como finding preventivo.

`UNKNOWN` tampoco quedó presente. La ausencia de `REVIEW_REQUIRED` describe el alcance estático revisado; no sustituye pruebas de integración con dos tenants ni una auditoría completa del SQL/RLS de toda la base.

## Regresión automatizada

Ejecutar:

```bash
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
```

La prueba:

1. descubre recursivamente toda `app/api/**/route.ts` que contenga una capacidad privilegiada;
2. compara el conjunto exacto con las 66 entradas del inventario;
3. exige markers mínimos por boundary y markers específicos para rutas públicas/callbacks;
4. inventaría también las 16 coincidencias bajo `lib/**`, incluidas referencias test-only;
5. reporta por diagnóstico `REVIEW_REQUIRED` y `FINDING` sin tratarlas como seguras;
6. verifica la terminación `requireProductionAdmin -> requireHostTenantAdmin` y conserva visible la deuda id-only de los helpers de manage token.

La corrección del service por id agrega además:

```bash
node --test tests/security/cit64-service-by-id-isolation.test.mjs
```

## Corrección acotada: campaign upload (2026-09-08)

`app/api/admin/campaigns/upload-media/route.ts` pasa de FINDING P2 a OK: espera `requireHostTenantAdmin(req)` y rechaza errores con el status del helper y mensaje público genérico antes de materializar multipart. Solo después obtiene el File, valida el límite absoluto de 25 MB, lee bytes, ejecuta `validateCampaignMedia()` y sube al bucket existente. Storage y media URL usan exclusivamente `access.tenantId`; se conservan UUID, respuesta exitosa y logging limitado. Se elimina el lookup manual y toda dependencia de `tenantSlug` del formulario; el frontend deja de enviar ese campo.

Evidencia: `tests/security/cit64-campaign-upload-auth-order.test.mjs` ejecuta el handler y validador reales con boundary y Storage simulados. Cubre rechazo sin parsing/lookup manual/Storage, espera del boundary, tenant A con slug B inyectado, archivo ausente/vacío/grande/inválido y error genérico de Storage con logging limitado.

Alcance: autenticación completada antes de multipart y eliminación del lookup manual del endpoint. El helper existente `requireHostTenantAdmin` resuelve internamente el tenant antes de validar el bearer; no se modifica aquí ni se afirma que esta prueba elimine ese lookup interno pre-auth. Los demás findings permanecen pendientes.

```bash
node --test tests/security/cit64-campaign-upload-auth-order.test.mjs
```

## Corrección acotada: availability upsert (2026-09-08)

`app/api/admin/availability/upsert/route.ts` pasa de FINDING P2 a OK. Espera `requireHostTenantAdmin(req)` antes de `req.json()` y cualquier validación del payload; rechazos conservan `access.status` con mensaje público seguro y headers no-store. Se eliminan resolución local del hostname y lookup manual de tenants. Todas las queries y filas de mutación usan exclusivamente `access.tenantId`; `body.tenantId` sigue ignorado sin cambiar callers.

Se conservan pertenencia del profesional, lectura de existentes por tenant+profesional, comprobación de IDs incoming antes de mutaciones, delete por IDs+tenant+profesional, upsert/insert con tenant y lectura final scoped. Normalización, cruces, borrados explícitos/por ausencia y respuesta exitosa mantienen su lógica. Los cinco errores DB 500 y el catch devuelven `Error interno`; el error de profesional conserva su 403 genérico.

`tests/security/cit64-availability-auth-order.test.mjs` ejecuta el handler real con boundary y DB simulados: 17 casos verifican auth antes de JSON sin lookup manual ni acceso a tablas tras rechazo, operaciones propias, rechazo de profesional/bloque ajeno (update y delete), tenant B inyectado sin efecto, validación post-auth y errores en cada etapa DB/excepción sin message/details/hint. Como en upload, el lookup interno previo al bearer del helper existente permanece fuera de esta corrección y no se declara eliminado.

Validación local: test específico 17/17; inventario 5/5; `git diff --check` sin errores. No se ejecutó la suite general porque incluye Docker/migrations; no se modificó infraestructura.

```bash
node --test tests/security/cit64-availability-auth-order.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

## Corrección acotada: admin services (2026-09-08)

`app/api/admin/services/route.ts` pasa de FINDING P2 a OK. GET espera `requireHostTenantAdmin(req)` antes de consultar services; POST/PATCH/DELETE esperan el mismo boundary antes de JSON y validación. Se eliminan `TenantResolution`, `resolveTenantId()`, `getHostnameFromReq()` y el import de slug: no queda lookup manual de tenants en la ruta. Los hints tenant/tenantId del query/body no influyen en autorización; list, insert, fetch, update y desactivación usan exclusivamente `access.tenantId`.

Se conservan `fetchServiceById(id, tenantId)` y `selectChangedService()` con binding id+tenant, incluido el fallback sin created_at. No cambia la lógica de payment policy, tax treatment/description, activation, sensitive-information ni normalización. Todos los errores internos 500 devuelven `Error interno`; el logging server-side se conserva. DELETE mantiene la desactivación lógica y también cambia de boundary porque dependía del resolver eliminado.

Evidencia: `tests/security/cit64-admin-services-auth-order.test.mjs` ejecuta los cuatro handlers y el validador UUID reales con boundary/DB simulados. Sus 35 casos cubren rechazos antes de parsing/DB, hints B con tenant autenticado A, lista exclusiva de A, insert en A, PATCH/DELETE de servicio B rechazados sin mutación, fallback tenant-scoped y errores DB/excepciones sin message/details/hint. El lookup interno del helper previo al bearer permanece sin cambios y fuera del alcance de estos tests de ruta.

```bash
node --test tests/security/cit64-admin-services-auth-order.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

No se ejecuta la suite completa porque incluye Docker/migrations; no se cambia infraestructura.

## Corrección acotada: admin tenant (2026-09-08)

`app/api/admin/tenant/route.ts` pasa de FINDING P2 a OK. GET espera `requireHostTenantAdmin(req)` y luego lee `TENANT_PUBLIC_CONFIG_SELECT` por id=`access.tenantId`. PATCH espera el mismo boundary antes del JSON/validaciones y actualiza únicamente ese id. Se eliminan `getTenantSlug()`, el import de hostname slug y el lookup manual por slug; query/body tenantSlug se ignoran sin modificar callers.

Se mantienen name obligatorio, WhatsApp de al menos ocho dígitos, validación de email, optionalText y los mismos campos editables. Config inexistente devuelve 404 genérico; errores DB de lectura/update y excepciones devuelven 500 `Error interno`, sin message/details/hint públicos. Se conserva logging existente.

Evidencia: `tests/security/cit64-admin-tenant-auth-order.test.mjs` ejecuta handlers reales con boundary y DB simulados. Sus 18 casos cubren rechazos antes de JSON/queries, slug B inyectado con auth A, select público y update por id A, B intacto, config inexistente, errores/excepciones y validaciones preservadas. El lookup interno previo al bearer del helper permanece sin cambios y fuera del alcance del test de ruta.

```bash
node --test tests/security/cit64-admin-tenant-auth-order.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

No se ejecuta la suite completa porque incluye Docker/migrations; no se modifica infraestructura.

## Corrección acotada: cancel by id (2026-09-08)

`app/api/appointments/cancel-by-id/route.ts` pasa de FINDING P2 a OK. `requireHostTenantAdmin(req)` precede JSON; solo appointment_id se requiere/valida y body.tenant_id se ignora. Lookup inicial y UPDATE combinan id+`access.tenantId`; desaparece el guard posterior 403 y el oracle cita ajena (403) vs inexistente (404): ambas devuelven exactamente `404 {ok:false,error:"Appointment not found"}`.

Capabilities, aviso de lista de espera y payload n8n usan `access.tenantId`. Se conservan idempotencia, status=canceled, booking_status=cancelled, timestamp, aviso para booking confirmado y timeout n8n de 5000 ms. Errores DB mantienen mensaje genérico; catch final devuelve `Error interno`. Fallos HTTP o de transporte n8n devuelven `notification_failed`, sin cuerpo interno del proveedor ni mensaje de excepción, conservando cancelación exitosa.

Evidencia: `tests/security/cit64-cancel-by-id-isolation.test.mjs`, 17 casos con handler real y boundary/DB/efectos simulados: auth antes de JSON, tenant A con hint B/ausente/inválido, doble filtro, cita ajena e inexistente con respuesta idéntica sin mutación, idempotencia, errores DB/n8n y gates operacionales. No se realizan llamadas externas. El lookup interno del helper previo al bearer sigue sin cambios y fuera del alcance del test de ruta.

```bash
node --test tests/security/cit64-cancel-by-id-isolation.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

No se ejecuta la suite completa porque incluye Docker/migrations; no se modifica infraestructura ni reschedule-by-id.

## Corrección acotada: reschedule by id (2026-09-08)

`app/api/appointments/reschedule-by-id/route.ts` pasa de FINDING P2 a OK. Espera `requireHostTenantAdmin(req)` antes de JSON; body.tenant_id se ignora. Lookup inicial y UPDATE usan id+`access.tenantId`; se elimina el guard posterior 403 y cita ajena/inexistente devuelven idéntico `404 {ok:false,error:"Appointment not found"}`. Overlap, capabilities, waitlist, admin_email y payload n8n usan exclusivamente el tenant autenticado.

Se conservan validación de rango, bloqueo de cita cancelada, filtros finales de overlap, rescheduled_at, waitlist y timeout de 5000 ms. Se eliminan details de errores DB/catch; catch devuelve `Error interno`. n8n no expone cuerpos crudos: éxito devuelve `{ok:true}` y fallo HTTP/transporte `notification_failed` sin romper el reagendado.

Evidencia: `tests/security/cit64-reschedule-by-id-isolation.test.mjs`, 28 casos con handler real y boundary/DB/efectos simulados: auth antes de JSON, hint B/ausente/inválido sin efecto, filtros tenant-scoped completos, 404 indistinguible sin mutación, cancelada/overlap 409, rango 400 y errores DB/catch/n8n sin datos internos. También verifica bloqueo por capability, condiciones para omitir waitlist y aborto efectivo con limpieza del timer a los 5000 ms simulados. Fechas no parseables conservan el rechazo 500 existente, ahora genérico y sin mutación. Se preserva el lookup interno del helper previo al bearer, fuera del alcance del test de ruta. No se realizan llamadas externas.

```bash
node --test tests/security/cit64-reschedule-by-id-isolation.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

No se ejecuta la suite completa porque incluye Docker/migrations; no se modifica infraestructura.


## Corrección acotada: customer professional isolation (2026-09-08)

`app/api/customers/create/route.ts` pasa de FINDING a OK. El finding original de auth-order era un falso positivo: la ruta ya validaba Bearer con `supabaseServer.auth.getUser` antes de `req.json()`, y luego comprobaba membership con `requireTenantAdmin({ req, tenantId })`. Ese flujo permanece intacto.

Durante la revisión se descubrió el P2 real: `professionalId` del body se validaba solo como UUID y podía asignarse a customers sin comprobar su tenant; no existe una FK/constraint visible en las migrations del repositorio que garantice esa relación entre tenants. Ahora, cuando se informa, la ruta consulta professionals por id + `access.tenantId` antes de cualquier escritura en customers. Profesional ajeno e inexistente reciben idéntico `400 {ok:false,error:"professionalId inválido"}`. Solo un profesional validado se asigna en update directo, update por deduplicación e insert (que antes omitía professional_id).

Todas las operaciones posteriores en customers usan `access.tenantId`: consultas de deduplicación, updates por id + tenant e insert. Se mantienen normalización de RUT/email/teléfono, deduplicación por RUT/teléfono/email, conflicto de RUT, edición sin professionalId y errores internos genéricos `Error inesperado`. No cambia el contrato del frontend ni se requiere migration.

Evidencia local: `tests/security/cit64-customer-professional-isolation.test.mjs`, 25/25 casos con handler y validadores reales, autenticación y DB simuladas. Cubre las tres vías de escritura con profesional propio y sin profesional, rechazo indistinguible de ajeno/inexistente antes de writes, aislamiento de customers, tenant canónico del boundary, deduplicación, orden de autenticación y errores DB/excepciones sin detalles internos. No valida la implementación interna del helper ni constraints en una base real.

Validación: test específico 25/25; inventario 5/5; `git diff --check` sin errores. Inventario de rutas: 61 OK, 5 FINDING P2, 0 REVIEW_REQUIRED (66 total). Los otros findings no se modifican.

```bash
node --test tests/security/cit64-customer-professional-isolation.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Sin cambios de branch, commit, push, producción, Supabase remoto ni migrations.


## Corrección acotada: mark-paid auth-order (2026-09-08)

`app/api/admin/appointments/mark-paid/route.ts` pasa de FINDING P2 a OK. El único cambio de runtime mueve `requireHostTenantAdmin(req)` y su rechazo antes de `req.json()` y de la validación de appointmentId. El RPC conserva `p_tenant_id: access.tenantId` y `p_actor_id: access.userId`; la lectura final conserva id + `access.tenantId`. El body no selecciona tenant. Pago, DTE, capabilities, `notifyPaymentConfirmed`, respuestas y errores genéricos permanecen iguales.

Según la auditoría confirmada aportada para esta corrección, la versión de `billing_record_manual_verified_payment` en `migrations/202608220001_prevent_automatic_payment_manual_draft.sql` ya limita sale/appointment por tenant + appointment, schedules/payment_intents/payments/evidencia por tenant, pasa p_tenant_id a DTE y permite ejecución solo a service_role. No hay escritura cross-tenant demostrada. Esta corrección no modifica ni ejecuta el RPC o migrations.

Evidencia: `tests/security/cit64-mark-paid-auth-order.test.mjs`, 19/19 casos con handler y validador UUID reales; auth, capabilities, RPC, DB y notificación simulados. Verifica auth esperada antes de body, ausencia de RPC sin auth, tenant/actor del access en RPC, lectura final por id + tenant, hints del body sin efecto, validación post-auth, errores internos sin filtraciones, gate 409 y notificación condicionada. Conserva también el fallback existente cuando la lectura final devuelve error. El test no valida internals del helper ni ejecuta SQL.

Validación local: test específico 19/19; inventario 5/5; `git diff --check` limpio. Inventario actual: 62 OK, 4 FINDING P2, 0 REVIEW_REQUIRED (66 rutas). Otros findings intactos.

```bash
node --test tests/security/cit64-mark-paid-auth-order.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Sin cambio de branch, commit/push, producción, Supabase remoto ni migrations.


## Corrección acotada: DTE production status auth-order (2026-09-08)

`app/api/admin/dte-production/[id]/status/route.ts` pasa de FINDING P2 a OK. Se eliminan por completo `req.json()`, el tipo del body y los argumentos legacy tenantId/tenantSlug. La ruta llama directamente `requireProductionAdmin(req)`. El helper ya ignoraba esos hints y deriva el tenant mediante `requireHostTenantAdmin(req)`; no se había demostrado cross-tenant. El riesgo corregido era auth-order y parámetros muertos.

Todo el código posterior permanece intacto: resolución de context.params, queryStatusManually con tenant/actor autenticados, lookup de intent por tenant + document id, planSiiStatusReconciliation, dte_reconcile_intent_status con auth.tenantId y safeProductionApiError. El body deja de consumirse: ausente, malformado o con hints no altera el flujo autorizado. No cambia la lógica DTE/SII ni ningún helper.

Evidencia: `tests/security/cit64-dte-status-auth-order.test.mjs`, 18/18 casos con ruta, adaptador requireProductionAdmin, planificador y safeProductionApiError reales. Host auth, servicio de producción y DB simulados. Verifica ausencia de parsing y argumentos legacy, rechazo auth sin resolver params ni efectos, tenant/actor en queryStatusManually, lookup por tenant + document id, RPC con tenant autenticado, reconciliación y omisión por el planificador, y errores por safeProductionApiError. No ejecuta SII, SQL ni la implementación interna del boundary hostname.

Validación local: test específico 18/18; inventario 5/5; `git diff --check` limpio. Inventario actual: 63 OK, 3 FINDING P2, 0 REVIEW_REQUIRED (66 rutas). Otros findings intactos.

```bash
node --test tests/security/cit64-dte-status-auth-order.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Sin cambio de branch, commit/push, producción, Supabase remoto ni migrations.


## Corrección acotada: billing settings isolation (2026-09-08)

`app/api/admin/billing-settings/route.ts` pasa de FINDING P2 a OK y usa `requireHostTenantAdmin(req)` en GET y PUT. No había cross-tenant demostrado: el boundary anterior comprobaba membership antes de DB. La corrección endurece el tenant del host, mueve auth antes de JSON/Zod en PUT y elimina la exposición de errores internos.

GET ignora por completo tenantId/tenantSlug del query y lee tenant_billing_settings por `access.tenantId`. PUT elimina esos campos del esquema; Zod los descarta como claves desconocidas por compatibilidad, incluso si están ausentes o tienen tipos inválidos. El payload contiene `tenant_id: access.tenantId` y el upsert mantiene onConflict=tenant_id. Ambos handlers responden con `rowToSettings(data, access.tenantId)`.

Se elimina schemaHint y toda exposición de mensajes de DB, tablas, columnas o migrations. Todos los errores 500 (incluidos fallos del boundary) devuelven `Error cargando facturación` en GET o `Error guardando facturación` en PUT. El logging server-side permanece. Campos tributarios, email, billingEnabled/taxId, defaults, provider/providerStatus, autoIssueOnPaid y allowInvoiceRequest conservan su lógica y validación.

Según el contexto confirmado del caller, `AdvancedBillingTechnicalPanel.tsx` ya resuelve tenant/slug desde el hostname y tolera schemaHint ausente. No se modifica el frontend, ninguna otra ruta ni helpers.

Evidencia: `tests/security/cit64-billing-settings-isolation.test.mjs`, 33/33 casos con GET/PUT y esquema Zod reales; boundary hostname y DB simulados. Cubre auth antes de DB/body, hints B/ausentes/inválidos, reads/upserts/respuestas en A con B intacto, creación/defaults sin fila previa, normalización de campos tributarios, gates de activación, email/enums/booleanos, JSON inválido y errores internos sin message/schemaHint/details/hint. El lookup interno del helper hostname sigue sin cambios y fuera del alcance del test de ruta; no se declara eliminado.

Validación local: test específico 33/33; inventario 5/5; `git diff --check` limpio. Inventario actual: 64 OK, 2 FINDING P2, 0 REVIEW_REQUIRED (66 rutas). Los findings restantes no se modifican.

```bash
node --test tests/security/cit64-billing-settings-isolation.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Sin cambio de branch, commit/push, producción, Supabase remoto ni migrations.


## Corrección acotada: payment settings isolation (2026-09-08)

`app/api/admin/payment-settings/route.ts` pasa de FINDING P2 a OK y reemplaza requireTenantAdmin por `requireHostTenantAdmin(req)` en GET/POST. No había cross-tenant demostrado: membership ya precedía DB/write. La corrección endurece el tenant del host, mueve auth antes de body y elimina pistas públicas de esquema/migrations.

GET elimina lectura/validación del query tenantId, llama `getTenantPaymentConfig(access.tenantId)` y responde con ese tenant. POST ignora completamente body.tenantId; select de settings existentes, update, tenant_id del insert y respuesta usan exclusivamente `access.tenantId`. tenantCredentialUpdates y tenantManualBankUpdates se mantienen después de auth y parsing. Se eliminan SupabaseErrorLike, schemaHintForPaymentSettings y schemaHint de las respuestas; los errores 500 siguen siendo genéricos, incluidos los fallos internos del boundary. Se conserva logPaymentSettingsError server-side.

La lógica de paymentMode, depósito fijo/porcentual, métodos habilitados, collectionMode, Mercado Pago/Webpay/Khipu, banco manual, placeholders demo, readiness, masking y validaciones permanece intacta. Según el contexto confirmado del caller, `app/admin/pagos/page.tsx` deriva tenant del hostname; ese frontend no se modifica.

Evidencia local: `tests/security/cit64-payment-settings-isolation.test.mjs`, 43/43 casos con handlers, Zod, helpers de credenciales/banco y readiness reales. Host boundary, config loader y DB simulados. Cubre auth esperada antes de configuración/DB/body/credenciales/banco, hints query/body B/ausentes/inválidos sin efecto, select/update/insert en A y B intacto, respuesta en A, masking de secretos cortos/largos, modos demo, validaciones, preservación de credenciales vacías/omitidas, depósito fijo/porcentual y limpieza explícita, además de errores internos sin schemaHint/details/hint ni instrucciones de migrations. El lookup interno del helper hostname permanece sin cambios y fuera del alcance del test de ruta.

Validación: test específico 43/43; inventario 5/5; `git diff --check` limpio. Inventario actual de rutas: 65 OK, 1 FINDING P2, 0 REVIEW_REQUIRED (66 total). El finding de service-rules/upsert y la deuda preventiva de helpers siguen intactos.

```bash
node --test tests/security/cit64-payment-settings-isolation.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Sin cambio de branch, commit/push, producción, Supabase remoto ni migrations.


## Corrección acotada: service rules isolation (2026-09-08)

`app/api/admin/service-rules/upsert/route.ts` pasa de FINDING P2 a OK. `requireHostTenantAdmin(req)` se espera antes de JSON; body.tenantId deja de participar en autorización/persistencia. ProfessionalId y serviceId deben ser strings UUID válidos y se consultan respectivamente en professionals/services por id + `access.tenantId` antes de cualquier DELETE/INSERT. Para cada entidad, foreign e inexistente comparten idéntico 400 (`professionalId inválido` / `serviceId inválido`) sin revelar pertenencia a otro tenant.

La revisión confirmó que no hay una FK/constraint visible en migrations/docs del repo que garantice la relación de tenant para esas referencias. La corrección añade esa comprobación explícita en la ruta: las filas fuerzan tenant_id=`access.tenantId`, professional_id y service_id validados, ignorando IDs homónimos dentro de items; DELETE mantiene los tres filtros. Normalización de day_of_week, start_time/end_time, is_active, eliminación de id, REPLACE e items=[] siguen funcionando. Errores DB y excepciones devuelven 500 genérico `Error inesperado`; el logging server-side permanece.

**Deuda de consistencia separada:** REPLACE sigue ejecutando DELETE e INSERT sin transacción. Si el INSERT falla después de un DELETE exitoso, las reglas anteriores ya se eliminaron; solicitudes concurrentes también pueden interferir. Esto requiere una solución de atomicidad futura y no se clasifica como aislamiento tenant. No se añade migration/RPC ni se modifica esta semántica en CIT-64.

Evidencia local: `tests/security/cit64-service-rules-isolation.test.mjs`, 30/30 casos con handler/validador UUID reales, boundary y DB simulados. Cubre auth antes de JSON, hints B/ausentes/inválidos sin efecto, entidades propias permitidas, foreign/inexistentes indistinguibles sin writes incluso con items=[], IDs forzados pese a inyección en items, triple filtro DELETE, reglas de otros pares/tenants intactas, normalización, vacío válido y errores DB/excepciones sin message/details/hint. El lookup interno del helper hostname permanece fuera del alcance del test de ruta.

Validación: test específico 30/30; inventario 5/5; `git diff --check` limpio. Inventario de rutas: 66 OK, 0 FINDING, 0 REVIEW_REQUIRED. La deuda preventiva de helpers de manage token sigue intacta y visible; no se modifican otros findings.

```bash
node --test tests/security/cit64-service-rules-isolation.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Sin cambio de branch, commit/push, producción, Supabase remoto ni migrations.


## P2 transversal: privacidad pública de tenant (2026-09-08)

**Estado: corrección preparada en el repositorio y verificada en PostgreSQL efímero local; cierre operativo pendiente.** `migrations/202609080001_cit64_public_tenant_privacy_hardening.sql` se aplicó únicamente dentro del nuevo test A/B local, incluida su repetición para verificar idempotencia. No se consultó Supabase remoto ni se desplegó código. No se afirma que los permisos efectivos de una base desplegada hayan cambiado. El inventario sigue teniendo exactamente 66 rutas: esta superficie transversal de grants, API y páginas no añade entradas artificiales.

Hallazgo confirmado: `202607230001_security_hardening.sql` concede a anon SELECT por columna sobre address y phone_display, y public_tenant_read permite filas con USING(true). Eso expone los datos directamente aunque la UI los oculte. Además, by-slug leía con service-role y devolvía siempre ambos campos y una dirección derivada, incluso con show_address_home/show_phone_home apagados. La migration histórica queda intacta.

La nueva migration elimina temp_allow_select_for_subdomain si existe, revoca SELECT de tabla de anon y revoca SELECT por cada columna actual mediante pg_attribute. Este segundo paso es necesario: revocar el permiso de tabla no elimina los grants por columna históricos. Después concede exclusivamente id, slug, name, logo_url, city, description, show_address y show_phone. No modifica grants ni policies de authenticated/service_role. Conserva public_tenant_read USING(true): sus filas siguen siendo enumerables, pero anon solo puede seleccionar esos metadatos deliberadamente públicos. Address y phone_display quedan fuera del allow-list, sin depender de flags de presentación.

En `/api/tenants/by-slug`, phone_display y address son null salvo que su respectivo flag home sea exactamente true (false/null/ausente no autorizan). address_display se construye con la dirección ya filtrada y city, que permanece como metadata pública; con dirección oculta puede quedar solo la ciudad. Se conservan slug, lifecycle activo, capacidades operacionales, modo demo, pagos y readiness/capabilities DTE.

**Separación pre-reserva / post-reserva:** by-slug entrega configuración y metadata pública. La confirmación usa el tenant anidado de la respuesta autorizada de `/api/appointments/by-id?id=...` para teléfono, dirección/ciudad y show_phone_after_booking/show_address_after_booking. Conserva el token de sessionStorage enviado por x-manage-token y el chequeo de éxito antes de asignar appointment. Sin tenant protegido no usa contacto de by-slug como fallback. Las banderas post-booking conservan su comportamiento anterior (false oculta; null/ausente mantiene el default), ahora procedentes de la cita autorizada. Dirección visible, Google Calendar, ICS/location y WhatsApp derivan de estos valores; WhatsApp conserva el gate de capabilities/demo.

El slug del tenant autorizado tiene prioridad para resolver metadata/capabilities públicas y profesionales. Se elimina el fallback a `/api/tenants/by-id`, que no existe, sin crear ese endpoint. Al cambiar el id de cita se deja de usar inmediatamente el contacto de la cita anterior. El endpoint protegido by-id y su authorizeAppointmentActor no se modifican.

**Cambio mínimo adicional necesario en la página server:** al revisar `app/tenants/[slug]/page.tsx` se encontró que renderizaba contacto con show_address/show_phone legacy, independientemente de los flags home. Esto habría conservado una vía pública de fuga cuando home=false y legacy=true. Se añaden solo ambos flags home al select y se exige home===true junto con legacy!==false al renderizar. Continúa usando supabaseServer (alias de supabaseAdmin), por lo que no depende de grants anon; se preservan también los ocultamientos legacy. Este cambio usa la excepción de necesidad explícitamente autorizada para esa página.

**Residual separado:** la enumerabilidad de id/slug/nombre/logo/ciudad/descripción/flags es discoverability y privacidad de metadata deliberadamente pública, no acceso a los dos campos privados. Los ACL efectivos de una base desplegada, incluidos posibles permisos heredados ajenos al estado versionado, no se verificaron. La comprobación real de ACL locales se describe abajo. El bloque debug histórico de `app/home-client.tsx` conserva sus consultas select('*') a tenants/appointments; se documenta sin corregir y no debe motivar ampliar grants para hacerlo funcionar. No se modifica ese archivo.

Pruebas locales dirigidas:

- `cit64-public-tenant-privacy.test.mjs`: 15 casos, incluyendo 2 controles estructurales SQL (sin ejecutar la migration), allow-list/revocación de permisos por columna/policy temporal, API real con DB simulada, flags estrictos, dirección derivada sin datos ocultos y regresiones de slug/live/demo/unclassified/pagos/DTE.
- `cit64-confirmation-tenant-privacy.test.mjs`: 12 casos ejecutando el TSX real en un harness de hooks/browser/fetch simulados; origen protegido de contacto, headers de manage token, flags, WhatsApp, ICS/location, rechazo/sin token, ausencia de fallback privado público, resolución por slug autorizado y demo.
- `cit64-tenant-home-privacy.test.mjs`: 5 casos ejecutando la página server real con DB/headers/componentes de presentación simulados; flags home false/null/ausentes bloquean exposición aunque los flags legacy sean true; se conservan contacto público explícito y ocultamiento legacy.
- Regresiones relevantes existentes: tenant-loading (10), demo-appointment-persistence (8), database-hardening (5), inventario CIT-64 (5).

Resultado: **60/60**, incluidos **32 casos nuevos**; inventario **5/5** (66 OK, 0 FINDING, 0 REVIEW_REQUIRED en rutas); `git diff --check` limpio. Los tests SQL son estructurales y las páginas se prueban con harness, no con navegador/base reales. No se ejecutó la suite completa.

```bash
node --test tests/security/cit64-public-tenant-privacy.test.mjs tests/security/cit64-confirmation-tenant-privacy.test.mjs tests/security/cit64-tenant-home-privacy.test.mjs tests/tenant-loading.test.mjs tests/security/demo-appointment-persistence.test.mjs tests/security/database-hardening.test.mjs tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

En esa validación previa no se cambió branch ni se hicieron commit/push, producción, Supabase remoto o aplicación de migrations. La ampliación PostgreSQL local posterior se describe a continuación. Cambios preexistentes preservados.

## Evidencia PostgreSQL A/B real (2026-09-08)

### Separación de evidencias

- **Estructural:** el inventario mantiene 66 rutas OK, 0 FINDING y 0 REVIEW_REQUIRED. `cit64-tenant-boundary-inventory.test.mjs` comprueba descubrimiento, clasificación y markers; no ejecuta RLS. Los tests conductuales de rutas/páginas descritos anteriormente ejecutan su código con DB y otros límites simulados.
- **PostgreSQL real:** `tests/security/cit64-tenant-ab-postgres.test.mjs` ejecuta SQL con `psql` dentro de `citaya-dte-sqltest`. Comprueba permisos, visibilidad de filas y mutaciones reales contra las policies/grants del repositorio. También ejecuta `tests/security/rls_matrix.sql` sobre los fixtures creados.
- **Límite:** el schema es una proyección mínima explícita por tabla, no la cadena completa de migrations. Se incluyen claves, columnas usadas por RLS/grants públicos y un campo real modificable por tabla. Se omiten constraints de negocio, relaciones a recursos hijos, triggers y RPC. Los resultados positivos de escritura certifican autorización RLS/ACL sobre esa proyección, no que el payload satisfaga el schema completo de la aplicación.

### Construcción local y procedencia del SQL

Se reutiliza el patrón CIT-67: base nueva `citaya_cit64_<UUID>` desde `template0`, `docker exec -i`, `psql -X -v ON_ERROR_STOP=1` y `DROP DATABASE ... WITH (FORCE)` en `finally`. El nombre del contenedor es fijo y el test no acepta URL, credenciales ni conexión remota desde variables de entorno. No carga módulos de aplicación, SDK Supabase ni clientes de proveedores. Solo crea roles si faltan; no cambia atributos de roles preexistentes.

Cada una de las 25 tablas tiene una fila sintética A y otra B. Las filas usan campos como `notes`, `full_name`, `subject`, `safe_blocking_reason` u `observation`, sin credenciales ni material tributario real. Las tablas de eventos proyectan IDs bigint; las configuraciones singleton se identifican por tenant. Las memberships son activas, role=`admin`:

| Identidad | UUID |
|---|---|
| Tenant A | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` |
| Tenant B | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` |
| Admin A | `11111111-1111-4111-8111-111111111111` |
| Admin B | `22222222-2222-4222-8222-222222222222` |
| Sin membership | `33333333-3333-4333-8333-333333333333` |
| Platform super_admin activo, sin membership A/B | `44444444-4444-4444-8444-444444444444` |

El bootstrap reproduce `auth.uid()` leyendo `request.jwt.claim.sub`. Las operaciones usan `SET LOCAL ROLE authenticated/anon`, con comprobación de `current_user`, `row_security=on`, roles sin `SUPERUSER/BYPASSRLS` y tablas cuyo owner no es ninguno de esos roles. `postgres` se usa para preparar fixtures y observar el estado tras las operaciones, no como actor bajo prueba.

Los bloques SQL se extraen por delimitadores explícitos, sin reescribir las policies. Un delimitador ausente falla el test:

| Migration | Parte realmente ejecutada |
|---|---|
| `202607230001_security_hardening.sql` | Helpers `is_tenant_member` / `is_platform_admin`, bloque canónico RLS, memberships/platform policies y grants públicos. |
| `202607240002_dte_automatic_issuance.sql` | RLS, policies de lectura y ACL de settings/intents/outbox/events. |
| `202607270001_dte_legal_activation.sql` | RLS, policies y ACL de tax profiles, autorización y activación/eventos. |
| `202608020001_tenant_legal_privacy_gate.sql` | Bloque RLS/ACL legal, con profiles/documents de lectura por tenant. |
| `202609010002_cit59_provider_dte_commercial_readiness.sql` | Bloque completo de ACL/RLS de payment settings, incluida revocación por columna y policy exclusiva de service_role. |
| `202609080001_cit64_public_tenant_privacy_hardening.sql` | **Migration completa**, aplicada dos veces solo en la base efímera. |

Antes del hardening, el harness concede SELECT/INSERT/UPDATE/DELETE a anon/authenticated para modelar una base Data API con permisos amplios. Después aplica las revocaciones originales, sin volver a conceder permisos para hacer pasar casos. Esta condición inicial está explícita: los resultados no prueban grants heredados ni policies adicionales de una instalación real. Por ejemplo, DELETE propio sobre customer_tax_profiles depende del grant inicial conservado; su migration concede explícitamente SELECT/INSERT/UPDATE y no revoca ese DELETE anterior.

### Matriz runtime y resultados

En todas las filas siguientes se comprueban A→B y B→A, usuario sin membership, super_admin y anon. Cada tabla ejecuta 12 comprobaciones SELECT y 32 intentos de mutación: **300 comprobaciones SELECT y 800 intentos de mutación** en la matriz principal, además de privacidad, fixtures, matriz SQL histórica y controles negativos.

| Superficies (25 tablas) | Admin A/B sobre su tenant | Admin sobre tenant ajeno / sin membership | Super_admin sin membership | Anon |
|---|---|---|---|---|
| `tenants` | Lee; UPDATE/DELETE autorizados. INSERT probado reponiendo fixture propio dentro de rollback, sin simular provisioning. | Sin lectura privada ni escrituras. | Lee ambos; writes permitidos por policy. | Solo metadata pública; sin writes ni address/phone_display. |
| `tenant_members` | Lee su propia membership; sin writes. No se afirma acceso a todas las memberships del tenant. | Sin lectura ni writes. | Lee ambas; sin writes por policy SELECT-only. | Sin acceso. |
| `services`, `professionals` | Lee e INSERT/UPDATE/DELETE propios. | Sin lectura ni writes bajo authenticated. | Lee ambos; writes permitidos. | Solo catálogo activo y columnas concedidas, sin writes. |
| `service_availability_rules`, `availability`, `customers`, `appointments` | Lee e INSERT/UPDATE/DELETE propios. | Sin lectura ni writes. | Lee ambos; writes permitidos. | Sin acceso privado ni writes. |
| `tenant_payment_settings` | Sin lectura ni writes directos. | Sin lectura ni writes. | **Sin lectura ni writes directos**, igual que cualquier authenticated. | Sin acceso. CIT-59 reserva la tabla a service_role. |
| `payments`, `payment_intents`, `waitlist_requests`, `tenant_billing_settings`, `message_logs` | Lee e INSERT/UPDATE/DELETE propios. | Sin lectura ni writes. | Lee ambos; writes permitidos. | Sin acceso privado ni writes. |
| `tenant_reviews` | Lee e INSERT/UPDATE/DELETE propios. | Sin lectura ni writes bajo authenticated. | Lee ambos; writes permitidos. | Solo reseñas visibles y columnas concedidas, sin writes. |
| `customer_tax_profiles` | Lee e INSERT/UPDATE/DELETE propios bajo el baseline de ACL descrito. | Sin lectura ni writes. | Lee ambos; writes permitidos bajo ese baseline. | Sin acceso. |
| `dte_tenant_issuance_settings`, `dte_payment_document_intents`, `dte_issuance_outbox`, `dte_document_events` | Solo lectura propia; todas las escrituras rechazadas. | Sin lectura ni writes. | Lee ambos; **sin writes**. | Sin acceso. |
| `dte_sii_authorization_evidence`, `dte_legal_activation`, `dte_legal_activation_events` | Solo lectura propia; todas las escrituras rechazadas. | Sin lectura ni writes. | Lee ambos; **sin writes**. | Sin acceso. |
| `tenant_legal_profiles`, `legal_documents` | Solo lectura propia; todas las escrituras rechazadas. | Sin lectura ni writes. | Lee ambos; **sin writes**. | Sin acceso. |

Los SELECT negativos exigen cero filas o `insufficient_privilege` (42501). Los positivos exigen exactamente una fila del tenant esperado; los reads sin filtro de los admins exigen exactamente su fila. La prueba comprueba fixtures existentes y RLS habilitada, evitando declarar aislamiento sobre tablas vacías.

INSERT/UPDATE/DELETE negativos exigen cero filas afectadas o 42501 y, tras `RESET ROLE`, igualdad exacta del snapshot JSONB de la tabla con el estado anterior. Los positivos exigen una fila afectada, cambio observable de la tabla e igualdad de todas las filas fuera del tenant objetivo. Se verifica **antes** del rollback: que el rollback deshaga una fuga no puede hacer pasar el test. Errores de unicidad, FK, CHECK o sintaxis no cuentan como denegación de acceso.

Para INSERT de claves singleton se elimina previamente solo el fixture objetivo como postgres dentro de la misma transacción, conservando la membership, y se fotografía ese estado. Así se prueba una inserción válida sin aceptar un conflicto de PK como aislamiento. El rollback restaura el fixture original. También se intenta cambiar el `tenant_id`/`id` de una fila propia hacia el tenant ajeno, para comprobar `WITH CHECK`; se evita del mismo modo una colisión de PK en singleton.

Los controles negativos introducen temporalmente una policy SELECT permisiva, una policy de escritura permisiva, un `WITH CHECK(true)` indebido y un grant anon sobre address. El control de cambio de tenant también abre SELECT deliberadamente, porque UPDATE comprueba la visibilidad de la fila resultante: conservar esa segunda barrera podría ocultar el defecto introducido en WITH CHECK. Las mismas assertions deben fallar con su mensaje de fuga; errores SQL incidentales no satisfacen esos controles. La conexión cerrada al fallar revierte cada transacción de control.

### Privacidad pública antes/después

Antes de CIT-64, anon puede ejecutar SELECT de address/phone_display de A y B aunque los flags legacy sean false: se reproduce el P2 existente. El test añade además un grant de tabla y la policy temporal histórica para comprobar su eliminación. Después de ejecutar la migration completa dos veces, SELECT de address, phone_display y `*` falla con 42501, incluso activando ambos flags legacy dentro de la transacción. SELECT de `id, slug, name, logo_url, city, description, show_address, show_phone` continúa devolviendo las dos filas.

Se comprueba además que al desactivar el catálogo B u ocultar su reseña, anon deja de verla y admin B conserva lectura. La enumerabilidad de metadata pública continúa siendo deliberada; no se interpreta como fuga cross-tenant privada.

### Superficies aún no cubiertas runtime por este test

| Superficie | Evidencia restante / motivo de exclusión |
|---|---|
| `campaigns` | No se encontró DDL/policy canónica de esta tabla en migrations/docs. El placeholder CIT-67 solo tiene tenant_id. No se inventa una policy ni un PASS: las rutas de campañas conservan evidencia estructural/conductual simulada; `message_logs` sí tiene cobertura SQL A/B. |
| `legal_acceptances`, `tenant_dte_mandates`, `marketing_consent_events`, `marketing_suppressions` | Stubs necesarios para ejecutar el bloque ACL legal; no tienen fixtures ni assertions A/B y **no se cuentan** entre las 25 tablas. Las rutas/helpers conservan la evidencia estructural previa. |
| `billing_sales`, `billing_sale_items`, `billing_sale_appointments`, `billing_payment_schedule`, `billing_sale_payments`, `billing_sale_item_document_coverage`, `billing_payment_schedule_allocations`, `billing_payment_schedule_events`, `dte_invoice_drafts`, `dte_invoice_draft_lines`, `tenant_payment_method_tax_policies` | No incorporadas al harness A/B de CIT-64; permanecen los análisis de rutas/helpers y las pruebas existentes, sin atribuirles ejecución runtime en esta validación. |
| `data_retention_policies`, `dte_retention_controls`, `restricted_data_access_audit`, `tenant_exceptional_access_audit` | Sin fixtures/assertions en este test. No se ejecutó CIT-67 ni otras matrices para extender esta afirmación. |
| Tablas `dte_production_*`, `dte_certification_*`, capacidades/readiness, snapshots comerciales, autoridad de autoemisor, certificados y `tenant_provisioning_requests` | No incorporadas. Las rutas/RPC/grants conservan evidencia estructural o tests previos; no se usaron archivos, certificados, CAF, folios ni documentos reales. |
| `storage.objects`, media/artefactos y filesystem | Fuera del PostgreSQL mínimo. El análisis de rutas y permisos versionados no certifica objetos ni permisos desplegados. |
| `platform_admins` como recurso, documentos legales globales con tenant_id NULL, memberships adicionales/inactivas/staff/support | `platform_admins` solo es fixture del helper; se prueba super_admin activo sin membership y dos admins activos. No se extrapola una matriz CRUD de esa tabla ni cobertura de esos actores/casos. |
| Relaciones hijo→tenant, triggers, RPC, boundaries HTTP/hostname/manage-token y operaciones con service_role | No se prueban en este harness RLS. En particular, un tenant_id propio acompañado de customer_id/professional_id/service_id ajeno requiere sus tests de ruta y/o integridad relacional; no queda demostrado por este resultado. Service_role puede eludir RLS y exige autorización en el servidor. |

No se confirma ningún P0/P1/P2 nuevo. El P2 público ya documentado queda reproducido y corregido en PostgreSQL local; su cierre operativo sigue pendiente. La ausencia de schema/policies de campaigns en el repositorio es una limitación de evidencia, no una vulnerabilidad desplegada demostrada. La deuda preventiva de helpers de manage token y la deuda de atomicidad REPLACE siguen intactas.

### Validación de esta ampliación

```bash
node --test tests/security/cit64-tenant-ab-postgres.test.mjs
node --test tests/security/cit64-tenant-boundary-inventory.test.mjs
git diff --check
```

Resultado: **31/31 tests PostgreSQL** (30 subtests + contenedor de tests), **5/5 de inventario**, **36/36 total**, sin skips; `git diff --check` limpio. No se ejecutó la suite completa. El archivo `rls_matrix.sql` permanece intacto y se ejecuta desde el nuevo test.

Archivos de esta ampliación: nuevo `tests/security/cit64-tenant-ab-postgres.test.mjs` y actualización de este documento. Branch preservada, sin commit, push, producción ni Supabase remoto. Las únicas migrations ejecutadas se limitaron a la base efímera local, eliminada al finalizar. Los cambios preexistentes se preservaron.

## Onboarding reproducible y ausencia de herencia entre tenants

### Provisioning genérico CIT-67

Fuente: [202609060001_cit67_atomic_tenant_provisioning.sql](../../migrations/202609060001_cit67_atomic_tenant_provisioning.sql), función `public.provision_tenant(uuid,uuid,uuid,text,text,text,text,text,text,text)`.

La función es `SECURITY DEFINER`, pertenece a `postgres` y fija `search_path = ''`. Revoca EXECUTE de `public`, `anon` y `authenticated`; el único grant EXECUTE para roles de aplicación es a `service_role`. Exige `p_request_id`, `p_actor_user_id` y `p_owner_user_id` no nulos, y comprueba que el actor esté en `platform_admins` con `role = 'super_admin'` e `is_active = true`. También valida slug, nombre y existencia/email del owner. El preflight de la migration verifica schema, columnas, unicidad requerida y disponibilidad de `extensions.digest` antes de crear el contrato.

El POST de [app/api/admin/platform/tenants/route.ts](../../app/api/admin/platform/tenants/route.ts) espera `requirePlatformAdmin(req)` antes de leer JSON. Hace una única llamada a `provision_tenant` con `p_actor_user_id: auth.userId`; el body no puede seleccionar el actor. El owner solicitado es un parámetro distinto y no concede autoridad al solicitante. Este enlace entre identidad autenticada y actor del RPC es necesario porque la función recibe el actor como argumento y se ejecuta con privilegios del servidor.

### Defaults fail-closed del tenant nuevo

Los siguientes valores se escriben explícitamente en CIT-67; no se toman de una fila de otro tenant:

| Tabla / campos | Estado inicial |
|---|---|
| `tenants.lifecycle_status` | `active` |
| `tenants.operational_mode` | `unclassified` |
| `tenants.show_address`, `show_phone` | Ambos `false` |
| `tenants.show_address_home`, `show_phone_home` | Ambos `false` |
| `tenants.show_address_after_booking`, `show_phone_after_booking` | Ambos `false` |
| `tenant_payment_settings.payment_mode` | `none` |
| `tenant_payment_settings.active` | `false` |
| `tenant_payment_settings.payment_methods_enabled` | `[]` |
| `tenant_payment_settings.payment_collection_mode` | `none` |

El provider inicial es `mercadopago`, pero el pago está desactivado y no tiene métodos habilitados ni credenciales provisionadas. El modo `unclassified` conserva bloqueadas las capacidades operativas de reservas, pagos, campañas y emisión DTE según [lib/tenant/operational-mode.mjs](../../lib/tenant/operational-mode.mjs); `active` por sí solo no habilita esas operaciones. Los datos de contacto opcionales proceden de la solicitud autorizada y `admin_email` del usuario owner, sin fallback a otro tenant.

[202609010002_cit59_provider_dte_commercial_readiness.sql](../../migrations/202609010002_cit59_provider_dte_commercial_readiness.sql) define, al añadirlas, las siguientes columnas como `text` nullable y sin default de credenciales o datos bancarios:

- `mercadopago_public_key`, `mercadopago_access_token`;
- `webpay_commerce_code`, `webpay_api_key`;
- `khipu_receiver_id`, `khipu_secret`;
- `bank_name`, `bank_account_type`, `bank_account_number`, `bank_account_holder`, `bank_rut`, `bank_email`.

CIT-67 omite esos campos en el INSERT y no lee credenciales/banco de ningún tenant para completarlos. Bajo ese schema nacen NULL, como comprueban las assertions CIT-67. CIT-59 también reserva el acceso directo a la tabla al servidor. **Límite:** `ADD COLUMN IF NOT EXISTS` no sustituye defaults o constraints de columnas preexistentes; esto describe el contrato versionado y el harness, no certifica ausencia de drift en una base desplegada.

### Legal

`tenant_legal_profiles` nace con `tenant_is_service_provider = false`, `administrative_review_status = 'draft'`, `sensitive_data_review_status = 'pending'`, `handles_sensitive_data = NULL` y `sensitive_data_purpose = NULL`. `created_by` y `updated_by` registran al actor autorizado.

Esta fila es un perfil pendiente de configuración, no una autoridad legal ni una aceptación contractual. El provisioning no crea/copía documentos legales, mandatos, aceptaciones ni eventos de self-issuer authority de otro tenant; tampoco los deriva de R&G. La comprobación de ausencia de INSERT/copia de documentos y mandatos es estructural: esas tablas no forman parte de las assertions runtime del harness CIT-67.

### DTE

El INSERT de `dte_tenant_issuance_settings` fija estos valores:

| Campos | Estado inicial |
|---|---|
| `issuance_mode` | `manual` |
| `consumer_document_type` | `unsupported` |
| `production_enabled` | `false` |
| `sii_authorization_status` | `not_configured` |
| `certificate_ready`, `caf_ready`, `folio_ready` | Todos `false` |
| `endpoints_ready`, `storage_ready`, `worker_ready`, `readiness_tests_green` | Todos `false` |
| `safe_blocking_reason` | `TENANT_NOT_CONFIGURED` |
| `tax_treatment`, `deposit_tax_document_policy_status`, `boleta_payment_document_model` | Todos `unconfigured` |
| `invoice_on_request`, `auto_email_delivery` | Ambos `false` |
| `certificate_valid_to`, `last_readiness_check`, `boleta_model_verified_at`, `boleta_model_verified_by`, `boleta_model_evidence_reference` | Todos NULL |

`provision_tenant` **no inserta ni copia** issuer RUT/razón social tributaria, certificados, CAF, folios, self-issuer authority, payment credentials, datos bancarios ajenos ni autoridad/documentos legales de otro tenant. Tampoco crea services, professionals, availability, customers, appointments, campaigns o message logs. El `name` solicitado para el tenant no provisiona una razón social tributaria en `dte_production_tenant_settings`.

La función solo inserta tenant, owner membership, configuración de pagos desactivada, perfil legal pendiente, settings DTE bloqueados, cinco políticas de retención con automatización desactivada y ledger de provisioning. No ejecuta `INSERT ... SELECT` desde recursos de otro tenant ni invoca el provisioning histórico de R&G. Como comprobación adicional de lectura sin fallback tributario, `getTenantSettings` de [lib/dte/production/supabase-repository.ts](../../lib/dte/production/supabase-repository.ts) consulta por `tenant_id` y devuelve NULL si no existe configuración del tenant solicitado.

### Atomicidad e idempotencia

`tenant_provisioning_requests` es el ledger de provisioning: `request_id` es clave primaria, `tenant_id` es único y `request_fingerprint` contiene SHA-256 del payload normalizado, incluido actor y owner. La función toma locks transaccionales por request y slug antes de comprobar el ledger y crear filas.

Repetir el mismo requestId con el mismo fingerprint devuelve el tenant original y `created = false`, sin duplicarlo. Reutilizarlo con otro payload produce `PROVISIONING_REQUEST_PAYLOAD_MISMATCH`; un slug ya ocupado también se rechaza. El ledger se escribe **al final**, después de todos los componentes del tenant. Un fallo intermedio revierte la llamada y no deja un tenant parcial ni un registro de completion. No hay efectos externos dentro del RPC.

La evidencia reproducible existente está en:

| Fuente | Qué sustenta y límite |
|---|---|
| [cit67-atomic-tenant-provisioning-postgres.test.mjs](../../tests/security/cit67-atomic-tenant-provisioning-postgres.test.mjs) | Ejecuta la migration CIT-67 y sus assertions sobre PostgreSQL efímero; también prueba rechazo del preflight por columna/unicidad faltantes. Su bootstrap es mínimo, no una reconstrucción de todas las migrations. |
| [cit67-atomic-tenant-provisioning-assertions.sql](../../tests/sql/cit67-atomic-tenant-provisioning-assertions.sql) | Comprueba defaults fail-closed, credenciales/banco NULL, replay idéntico, payload inconsistente, slug en conflicto, actor inválido, separación de owners/contacto A/B, ausencia de filas tributarias/operativas prohibidas y rollback tras fallo forzado del esqueleto. Incluye ausencia de self-issuer authority. No prueba concurrencia con sesiones paralelas ni todos los recursos omitidos del schema. |
| [cit67-platform-tenant-post.test.mjs](../../tests/security/cit67-platform-tenant-post.test.mjs) | Ejecuta el handler con auth/RPC simulados: auth antes de JSON, actor ligado a `auth.userId`, una sola llamada RPC, replay HTTP 200 y errores seguros. No representa una prueba HTTP + PostgreSQL de extremo a extremo. |

Esta ampliación documental revisa esas fuentes; **no vuelve a ejecutar CIT-67 ni atribuye sus casos al conteo de CIT-64 A/B**.

### Independencia respecto de R&G

La búsqueda de referencias a R&G encontró principalmente migrations históricas específicas, fixtures/tests/certificación/runbooks DTE y templates legales de Citaya:

| Referencia concreta | Alcance |
|---|---|
| [202607240003_rg_issuer_provisioning.sql](../../migrations/202607240003_rg_issuer_provisioning.sql) | Provisioning histórico explícito de `rg-spa`, con su identidad y configuración específicas. No es el contrato genérico CIT-67. |
| [202607290003_rg_issuer_activity_code.sql](../../migrations/202607290003_rg_issuer_activity_code.sql) | Ajuste histórico que resuelve `rg-spa` y recursos concretos de ese tenant. No configura tenants nuevos. |
| [lib/dte/certification/boleta-electronica-set.ts](../../lib/dte/certification/boleta-electronica-set.ts), [lib/dte/__tests__/dte-production.test.ts](../../lib/dte/__tests__/dte-production.test.ts), [REAL_DTE_FILES_RUNBOOK.md](../dte-sii/REAL_DTE_FILES_RUNBOOK.md), [SII_CERTIFICATION_RUNBOOK.md](../dte-sii/SII_CERTIFICATION_RUNBOOK.md) | Casos, fixtures y procedimientos específicos de certificación/DTE de R&G. No son fuentes de datos para `provision_tenant`. |
| [lib/legal/templates.ts](../../lib/legal/templates.ts) | Identifica a R&G Soluciones Integrales SpA como operador/proveedor tecnológico de Citaya; mantiene pendiente la identidad propia del tenant. No asigna por ello issuer RUT, certificado, CAF, folios ni autoridad legal al tenant nuevo. |

Estas referencias **no forman parte del provisioning genérico CIT-67 ni se copian a nuevos tenants por ese contrato**. Los templates legales pueden servir al flujo legal posterior, pero CIT-67 no los publica ni acepta automáticamente. La independencia aquí significa ausencia de herencia de identidad, recursos o autoridad de R&G en el onboarding genérico; no significa ausencia del nombre R&G en todo el repositorio. Las referencias históricas se conservan sin eliminarlas ni reinterpretarlas. Tampoco se afirma que la cadena histórica completa pueda aplicarse desde cero sin sus prerrequisitos específicos.

### Evidencia A/B y limitaciones del cierre documental

[cit64-tenant-ab-postgres.test.mjs](../../tests/security/cit64-tenant-ab-postgres.test.mjs) aporta la evidencia PostgreSQL previamente ejecutada: **31/31 tests**, fixtures A/B sintéticos y **25 tablas**. Prueba A→B y B→A simétricos, usuario sin membership, platform super_admin y anon, verificando lecturas, filas afectadas y snapshots tras intentos de mutación, antes del rollback. La migration de privacidad CIT-64 se validó completa y repetida **solo en la base efímera local**. Esta matriz prueba aislamiento RLS/ACL; el contrato de creación se sustenta separadamente en CIT-67.

Se mantienen las limitaciones de la matriz runtime anterior:

- Los harness PostgreSQL no reproducen toda la cadena histórica de migrations ni posibles defaults, policies o triggers adicionales de una instalación.
- No todas las superficies tienen runtime A/B; las exclusiones detalladas arriba siguen vigentes.
- HTTP, uso de service_role, integridad entre recursos hijos, triggers y RPC completos no están todos cubiertos por el harness; las pruebas de rutas con dependencias simuladas no equivalen a integración completa.
- El P2 público está corregido en implementación local, pero su cierre operativo requiere **migration + deploy + verificación posterior**. Esos pasos no se ejecutan ni se requieren para cerrar este pendiente documental.

Estas limitaciones no representan una herencia R&G ni un bypass demostrado. No se amplía la afirmación de cobertura por haber documentado las fuentes.

### Checklist final del criterio 8

| Criterio de aceptación | Estado | Evidencia |
|---|---|---|
| 8. Documentación final: matriz, evidencia estructural/runtime, limitaciones, onboarding fail-closed y ausencia de dependencia R&G en el provisioning genérico | **SATISFECHO CON LIMITACIÓN DOCUMENTADA (B)** | Matrices anteriores y esta sección, con referencias a contrato, endpoint, defaults, pruebas CIT-67, runtime CIT-64 y alcance histórico de R&G. |

El bloqueador documental identificado en la revisión final queda resuelto. No quedan bloqueadores documentales identificados; las deudas no bloqueantes y limitaciones previas permanecen. Recomendación: **READY_FOR_FINAL_VALIDATION**. Este estado prepara la validación final; **no declara CIT-64 Done** ni el cierre operativo del P2 público.

Esta intervención modifica únicamente este documento. No modifica código, tests ni migrations y no ejecuta tests, migrations, deploy, producción o Supabase remoto; tampoco realiza commit ni push.
