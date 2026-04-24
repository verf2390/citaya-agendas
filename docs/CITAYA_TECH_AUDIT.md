# CITAYA TECH AUDIT

## 1. Mapa general del sistema

### Stack detectado
- Frontend y server: Next.js App Router.
- Base de datos y auth: Supabase.
- Pagos: Mercado Pago (`services/payments/*`).
- Automatizaciones: n8n vía webhooks salientes desde APIs de citas.
- Emails: no se encontró integración directa con Resend en este repo; hoy el envío parece delegado a n8n.

### Rutas principales en `app/`
- Públicas:
  - `app/page.tsx`
  - `app/reservar/page.tsx`
  - `app/reservar/confirmacion/page.tsx`
  - `app/reservar/gestionar/page.tsx`
  - `app/reservar/resultado/page.tsx`
- Tenant/subdominio:
  - `app/tenants/[slug]/page.tsx`
  - `app/tenants/[slug]/reservar/page.tsx`
  - `app/demo/[slug]/page.tsx`
  - `app/demo/[slug]/reservar/route.ts`
- Admin:
  - `app/admin/agenda/page.tsx`
  - `app/admin/customers/page.tsx`
  - `app/admin/customers/[id]/page.tsx`
- Auth:
  - `app/login/page.tsx`

### APIs importantes
- Reservas:
  - `app/api/appointments/create/route.ts`
  - `app/api/appointments/availability/route.ts`
  - `app/api/appointments/by-token/route.ts`
  - `app/api/appointments/by-id/route.ts`
  - `app/api/appointments/cancel/route.ts`
  - `app/api/appointments/reschedule/route.ts`
  - `app/api/appointments/cancel-by-id/route.ts`
  - `app/api/appointments/reschedule-by-id/route.ts`
- Customers / CRM:
  - `app/api/customers/create/route.ts`
  - `app/api/customers/list/route.ts`
  - `app/api/customers/search/route.ts`
  - `app/api/customers/[id]/history/route.ts`
- Tenants y catálogo:
  - `app/api/tenants/by-slug/route.ts`
  - `app/api/professionals/by-tenant/route.ts`
  - `app/api/services/by-tenant/route.ts`
- Pagos y webhooks:
  - `app/api/payments/create-preference/route.ts`
  - `app/api/webhooks/mercadopago/route.ts`
- Admin availability:
  - `app/api/admin/availability/*`
  - `app/api/admin/appointments/range/route.ts`

### Servicios en `services/`
- `services/payments/payment-config.ts`: lee configuración de pagos por tenant desde `tenant_payment_settings`.
- `services/payments/payment-amount.ts`: calcula abono o pago completo.
- `services/payments/mercadopago.ts`: crea preferencias y ahora también resuelve pagos/webhook.

### Archivos clave por dominio
- Reservas:
  - `app/reservar/page.tsx`
  - `app/api/appointments/create/route.ts`
  - `app/api/appointments/availability/route.ts`
  - `lib/lib/availability.ts`
- Multi-tenant:
  - `lib/tenant.ts`
  - `app/api/tenants/by-slug/route.ts`
  - `app/tenants/[slug]/*`
- CRM:
  - `app/admin/customers/*`
  - `app/api/customers/*`
- Pagos:
  - `app/api/payments/create-preference/route.ts`
  - `app/api/webhooks/mercadopago/route.ts`
  - `services/payments/*`
- Webhooks / n8n:
  - `app/api/appointments/create/route.ts`
  - `app/api/appointments/cancel/route.ts`
  - `app/api/appointments/cancel-by-id/route.ts`
  - `app/api/appointments/reschedule/route.ts`
  - `app/api/appointments/reschedule-by-id/route.ts`

## 2. Flujo de reserva actual

1. El usuario entra por `app/reservar/page.tsx` o por el tenant/subdominio.
2. El frontend resuelve tenant por slug/subdominio y obtiene servicios y profesionales.
3. Consulta disponibilidad vía `GET /api/appointments/availability`.
4. Envía la reserva vía `POST /api/appointments/create`.
5. El backend:
   - valida payload con `AppointmentCreateSchema`
   - resuelve tenant demo por cookie si aplica
   - resuelve o crea customer
   - copia snapshot de servicio
   - genera `manage_token`
   - inserta `appointments`
   - dispara webhook a n8n si está configurado
6. La confirmación se consulta luego con `by-id` y la gestión privada usa `by-token`.

## 3. Flujo de cliente/CRM actual

1. Admin resuelve tenant por subdominio en `app/admin/customers/page.tsx`.
2. Lista clientes vía `GET /api/customers/list` usando Bearer token de Supabase.
3. Alta/edición simple vía `POST /api/customers/create`.
4. Detalle de cliente en `app/admin/customers/[id]/page.tsx`.
5. Historial enriquecido vía `GET /api/customers/[id]/history`.
6. La UI ya prepara:
   - filtros rápidos
   - export CSV/PDF
   - payload de campaña masiva
7. El envío masivo todavía no está conectado; hoy `handlePrepareBulkMessage` solo hace `console.log`.

## 4. Flujo de pago actual

### Antes de esta revisión
- `create-preference` tomaba `appointmentId`, creaba preferencia y guardaba un `payments` en `pending`.
- El webhook de Mercado Pago solo registraba el body en consola.
- La `notification_url` estaba hardcodeada a `https://demo.citaya.online/api/webhooks/mercadopago`.

### Después de esta revisión
1. `POST /api/payments/create-preference`:
   - valida `appointmentId` y `tenantId`
   - valida que la cita exista y no esté cancelada
   - valida que `service_id` exista y pertenezca al tenant
   - calcula monto de forma segura desde config y precio del servicio
   - rechaza preferencias si ya existe un pago `paid`
   - crea una `notification_url` multi-tenant con `tenantId` y `appointmentId`
   - actualiza o inserta `payments` con `pending`
2. `POST /api/webhooks/mercadopago`:
   - valida `tenantId` y `appointmentId` desde querystring
   - ignora tópicos no soportados
   - obtiene el pago real desde SDK de Mercado Pago usando el token del tenant
   - valida `external_reference`
   - mapea estado MP a `pending | paid | failed | cancelled`
   - evita reprocesar aprobaciones duplicadas
   - actualiza o crea el registro en `payments`
3. `app/reservar/resultado/page.tsx` ahora entiende `status=success|failure|pending`.

## 5. Riesgos encontrados

### Altos
- El repo no muestra una actualización explícita de `appointments.payment_status`; el estado real hoy vive en `payments`. Si el frontend futuro depende de estado en `appointments`, faltará sincronización o vista consolidada.
- Hay varios usos de `supabaseAdmin` y `supabaseServer` con service role en rutas que dependen de validaciones manuales. Si se omiten guards, el impacto multi-tenant es alto.
- `cancel` y `cancel-by-id` mantienen fallback hardcodeado a `https://n8n.citaya.online/...`.

### Medios
- `lib/tenant.ts` y varias pantallas asumen `citaya.online` como root domain.
- Hay textos y branding hardcodeados con “Citaya” en layouts y pantallas demo/admin.
- No se detectó suite de tests automatizados.
- `app/admin/customers/[id]/page.tsx` borra customer directamente desde cliente; eso merece revisar reglas/RLS y efectos en historial.
- La búsqueda/listado de customers valida JWT, pero no verifica pertenencia del usuario al tenant más allá del token válido y el `tenantId` enviado.

### Bajos
- Hay duplicación de helpers de email/teléfono entre frontend y backend.
- Hay varios `console.*` de debug útiles hoy, pero falta una estrategia común de logs estructurados.

## 6. Mejoras recomendadas por prioridad

### P0
- Unificar fuente de verdad del estado de pago: tabla `payments` + lectura consolidada por cita.
- Agregar verificación fuerte usuario-tenant en APIs admin.
- Eliminar URLs hardcodeadas de n8n y dominio base hacia config central.

### P1
- Persistir metadatos de pago útiles para auditoría si la tabla ya soporta columnas: `mp_payment_id`, `status_detail`, payload resumido.
- Crear endpoint interno o job para reconciliar pagos pendientes.
- Consolidar validaciones reutilizables de UUID/email/fechas en más rutas.

### P2
- Añadir tests de integración mínimos para create/cancel/reschedule/payments.
- Preparar campañas reales desde CRM con cola/n8n en vez de `console.log`.
- Extraer branding hardcodeado a config por tenant o por entorno.

## 7. Archivos clave del proyecto

- Multi-tenant:
  - `lib/tenant.ts`
  - `app/api/tenants/by-slug/route.ts`
- Reserva pública:
  - `app/reservar/page.tsx`
  - `app/api/appointments/create/route.ts`
  - `app/api/appointments/availability/route.ts`
  - `app/api/appointments/by-token/route.ts`
- Gestión de cita:
  - `app/reservar/gestionar/page.tsx`
  - `app/api/appointments/cancel/route.ts`
  - `app/api/appointments/reschedule/route.ts`
- CRM/admin:
  - `app/admin/customers/page.tsx`
  - `app/admin/customers/[id]/page.tsx`
  - `app/api/customers/create/route.ts`
  - `app/api/customers/[id]/history/route.ts`
- Pagos:
  - `app/api/payments/create-preference/route.ts`
  - `app/api/webhooks/mercadopago/route.ts`
  - `services/payments/payment-config.ts`
  - `services/payments/payment-amount.ts`
  - `services/payments/mercadopago.ts`
