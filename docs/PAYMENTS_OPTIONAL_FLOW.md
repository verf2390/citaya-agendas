# PAYMENTS OPTIONAL FLOW

## 1. Cómo funciona el flujo

### Implementación actual en Citaya
- La reserva pública usa el modo de pago global del tenant desde `tenant_payment_settings.payment_mode`.
- Valores soportados:
  - `none`: sin pago online
  - `optional`: el cliente elige `Pagar ahora` o `Pagar después`
  - `required`: solo permite `Pagar ahora`
- La cita guarda:
  - `appointments.payment_required`
  - `appointments.payment_status`
- Estados usados:
  - `not_required`
  - `pending`
  - `paid`
  - `failed`
  - `cancelled`

### Reglas implementadas
- `none`:
  - no se muestran opciones de pago
  - la cita se crea con `payment_required = false`
  - la cita se crea con `payment_status = not_required`
- `optional` + `Pagar después`:
  - no redirige a Mercado Pago
  - la cita se crea con `payment_required = false`
  - la cita se crea con `payment_status = not_required`
- `optional` + `Pagar ahora`:
  - la cita se crea
  - la cita queda con `payment_required = true`
  - la cita queda con `payment_status = pending`
  - luego se crea preferencia Mercado Pago y se redirige a `init_point`
- `required`:
  - solo deja `Pagar ahora`
  - la cita se crea con `payment_required = true`
  - la cita se crea con `payment_status = pending`
  - luego se crea preferencia y se redirige a Mercado Pago

## 2. Campos requeridos

### Confirmados en DB
- `appointments.payment_required`: existe
- `appointments.payment_status`: existe
- `appointments.service_id`: existe
- `appointments.service_name`: existe
- `appointments.tenant_id`: existe
- `services.price`: existe
- `services.currency`: existe
- `payments.appointment_id`: existe
- `payments.mp_preference_id`: existe

### Confirmados como no existentes
- `payments.preference_id`: no existe
- `services.payment_mode`: no existe
- `services.payment_required`: no existe

## 3. SQL necesario si falta algo

### Para la implementación actual
- No fue necesario agregar columnas nuevas.

### SQL opcional futuro para override por servicio
- Hoy el modo es global por tenant. Si luego quieres configurar `Sin pago / Opcional / Obligatorio` por servicio, el cambio recomendado sería:

```sql
alter table public.services
  add column if not exists payment_mode text
  check (payment_mode in ('none', 'optional', 'required'));
```

- Opcionalmente, para que los servicios hereden del tenant cuando el campo sea `null`, no hace falta más schema; la app puede resolver:
  - `service.payment_mode ?? tenant_payment_settings.payment_mode`

## 4. Cómo probar “pagar después”

1. En admin agenda, dejar `Cobros online = Pago opcional`.
2. Ir a `/reservar`.
3. Elegir servicio, profesional, horario y datos.
4. En “Pago de la reserva”, elegir `Pagar después`.
5. Confirmar reserva.
6. Verificar:
   - no hay redirección a Mercado Pago
   - la cita se crea
   - `appointments.payment_required = false`
   - `appointments.payment_status = 'not_required'`

## 5. Cómo probar “pagar ahora”

1. En admin agenda, dejar `Cobros online = Pago opcional` o `Pago obligatorio`.
2. Ir a `/reservar`.
3. Elegir servicio, horario y datos.
4. Elegir `Pagar ahora`.
5. Confirmar reserva.
6. Verificar:
   - se crea la cita
   - `appointments.payment_required = true`
   - `appointments.payment_status = 'pending'`
   - se crea/actualiza registro en `payments`
   - se redirige a `init_point`

## 6. Cómo probar webhook manual

```bash
curl -X POST "http://localhost:3000/api/webhooks/mercadopago?tenantId=UUID_TENANT&appointmentId=UUID_CITA" \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","data":{"id":"MP_PAYMENT_ID"}}'
```

Verificar:
- `payments.status` cambia a `paid`, `failed`, `pending` o `cancelled`
- `appointments.payment_status` cambia al mismo estado

## 7. Cómo probar Mercado Pago con test users y tarjetas oficiales

### Cuentas de prueba
- Mercado Pago recomienda usar al menos dos cuentas:
  - `Seller`
  - `Buyer`
- No debes usar la misma cuenta para ambos roles.
- La cuenta buyer y seller deben ser del mismo país.
- Fuente oficial:
  - https://www.mercadopago.cl/developers/en/docs/your-integrations/test/accounts

### Checkout Pro test purchase
- Para Checkout Pro, Mercado Pago indica hacer la compra en una ventana incógnita.
- Fuente oficial:
  - https://www.mercadopago.cl/developers/en/docs/checkout-pro/integration-test/test-purchases

### Tarjetas de prueba oficiales
- Fuente oficial:
  - https://www.mercadopago.cl/developers/en/docs/checkout-bricks/integration-test/test-cards
  - La misma tabla de tarjetas también aparece en docs de Checkout Pro test purchases.

Tarjetas visibles en la documentación oficial:
- Mastercard crédito: `5416 7526 0258 2580`
- Visa crédito: `4168 8188 4444 7115`
- American Express crédito: `3757 781744 61804`
- Mastercard débito: `5241 0198 2664 6950`
- Visa débito: `4023 6535 2391 4373`
- Vencimiento mostrado por Mercado Pago: `11/30`
- CVV:
  - `123` para Visa/Mastercard
  - `1234` para American Express

### Para obtener APRO
- Mercado Pago documenta que el resultado puede simularse combinando la tarjeta de prueba con los datos del titular.
- Usa exactamente los test users y tarjetas de la documentación oficial.
- En Checkout Pro, usa email distinto del de tu cuenta principal de Mercado Pago cuando el flujo lo pida.
- Haz la prueba en incógnito para evitar conflictos de sesión.
- Si Mercado Pago pide código de verificación del test user, el código se obtiene en `Your integrations > Your application > Test accounts`.

### Cómo evitar rechazo por seguridad
- No reutilizar sesión real y sesión de buyer en la misma ventana.
- No usar seller y buyer con la misma cuenta.
- No mezclar países entre buyer y seller.
- No usar tarjetas reales.
- Repetir la prueba en incógnito y con buyer de prueba limpio si el checkout queda “contaminado” por sesión previa.

## 8. Qué revisar en Supabase

- `appointments`
  - `payment_required`
  - `payment_status`
  - `service_id`
  - `tenant_id`
- `payments`
  - `appointment_id`
  - `tenant_id`
  - `mp_preference_id`
  - `status`
  - `amount`
- `tenant_payment_settings`
  - `payment_mode`
  - `active`
  - tokens MP del tenant

## 9. Riesgos pendientes antes de producción

- El modo de pago hoy es global por tenant, no por servicio.
- Si falla la creación de preferencia después de crear la cita, la cita ya quedó creada. No se hace rollback automático.
- En `required`, la cita sigue confirmándose antes de pago para no romper el flujo actual. Si negocio necesita “reserva pendiente hasta pago”, eso requiere una decisión de producto y revisar todos los estados aguas abajo.
- Falta una UX para reintentar pago desde confirmación/gestión sin recrear cita.

## Checklist

- Reserva sin pago
- Reserva con pagar después
- Reserva con pagar ahora
- Pago rechazado
- Pago aprobado
- Webhook actualiza appointment
- Admin configura servicio con pago opcional
- Admin configura servicio con pago obligatorio

Nota:
- Hoy el admin configura el modo global del tenant.
- La parte “servicio con pago opcional/obligatorio” queda cubierta por el modo global mientras no exista `services.payment_mode`.
