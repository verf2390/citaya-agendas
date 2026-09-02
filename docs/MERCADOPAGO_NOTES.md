# MERCADOPAGO NOTES

## 1. Estado actual de integración

- La integración está planteada por tenant usando `tenant_payment_settings`.
- El backend crea preferencias desde una cita existente.
- El estado de pago persistido visible en el repo está en la tabla `payments`.
- No hay evidencia en código de cobros reales activados desde este trabajo; no se tocaron keys reales ni `.env`.

## 2. Qué funciona

- Lectura de config por tenant en `services/payments/payment-config.ts`.
- Cálculo de abono o monto completo en `services/payments/payment-amount.ts`.
- Creación de preferencia MP en `services/payments/mercadopago.ts`.
- Persistencia base en tabla `payments`.
- Pantalla de resultado ahora soporta retorno de pago `success`, `failure`, `pending`.

## 3. Qué estaba incompleto

- Webhook de Mercado Pago no actualizaba nada.
- `notification_url` estaba hardcodeada al dominio demo.
- No se validaba `tenantId`.
- No se rechazaban citas canceladas o ya pagadas.
- No había barrera real contra reprocesamiento de webhook aprobado.

## 4. Qué cambios realicé

- `app/api/payments/create-preference/route.ts`
  - validación de `appointmentId` y `tenantId`
  - validación de existencia de cita
  - validación de `service_id` y servicio del tenant
  - validación de cita no cancelada
  - cálculo seguro de monto
  - bloqueo si ya existe pago `paid`
  - `notification_url` dinámica con `tenantId` y `appointmentId`
  - update/insert de `payments` con estado `pending`
- `services/payments/mercadopago.ts`
  - agregado helper para obtener un pago real desde SDK
  - agregado mapeo de estados MP a estado interno
- `app/api/webhooks/mercadopago/route.ts`
  - validación de tenant/cita
  - filtro de tópicos no soportados
  - fetch del pago real
  - validación de `external_reference`
  - mapeo a `pending | paid | failed | cancelled`
  - idempotencia básica para aprobaciones duplicadas
  - update/insert de `payments`

## 5. Cómo probar con curl o flujo local

### Crear preferencia

```bash
curl -X POST http://localhost:3000/api/payments/create-preference \
  -H "Content-Type: application/json" \
  -d '{
    "appointmentId": "UUID_DE_CITA",
    "tenantId": "UUID_DE_TENANT"
  }'
```

Respuesta esperada:

```json
{
  "ok": true,
  "init_point": "https://...",
  "preference_id": "....",
  "amount": 10000
}
```

### Simular webhook local

Usa el mismo `tenantId` y `appointmentId` que quedaron embebidos en la preferencia.

```bash
curl -X POST "http://localhost:3000/api/webhooks/mercadopago?tenantId=UUID_DE_TENANT&appointmentId=UUID_DE_CITA" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payment",
    "data": { "id": "MP_PAYMENT_ID" }
  }'
```

### Flujo manual sugerido

1. Crear cita en entorno local/test.
2. Crear preferencia.
3. Abrir `init_point` con credenciales sandbox.
4. Confirmar que `payments.status` queda `pending`.
5. Simular o recibir webhook.
6. Confirmar transición a `paid`, `failed` o `cancelled`.

## 6. Variables necesarias

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MERCADOPAGO_WEBHOOK_URL` opcional, si se quiere sobreescribir la URL generada
- Las credenciales Mercado Pago por tenant viven en la tabla `tenant_payment_settings`:
  - `mercadopago_public_key`
  - `mercadopago_access_token`

## 7. Riesgos pendientes

- No confirmé por esquema si existe columna dedicada para `mp_payment_id` o `status_detail`; no la forcé para no romper DB.
- La idempotencia actual está centrada en el estado final `paid`. Si luego se necesitan conciliaciones más finas, conviene guardar más metadata del pago.
- No hay actualización explícita del estado de pago dentro de `appointments`.
- Si Mercado Pago envía webhooks sin `tenantId`/`appointmentId` en la URL, este handler ahora los rechaza porque en este diseño multi-tenant son necesarios.

## 8. Próximos pasos antes de producción

1. Confirmar esquema real de tabla `payments`.
2. Agregar reconciliación de pagos pendientes.
3. Exponer lectura consolidada de pago por cita para admin/frontend.
4. Verificar sandbox end-to-end con cuentas de prueba.
5. Revisar firma/seguridad avanzada del webhook si la operación lo exige.
