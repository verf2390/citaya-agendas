# TESTING CHECKLIST

## Preparación

- Tener `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` válidos en entorno local.
- Configurar `N8N_PAYMENT_CONFIRMED_WEBHOOK_URL` si se quiere probar el evento estándar de pago confirmado.
- Usar tenant y citas de prueba.
- No usar credenciales reales de cobro.

## Crear reserva

- Abrir `/reservar` o el subdominio del tenant.
- Seleccionar profesional, servicio y horario.
- Enviar formulario con nombre, teléfono y email válidos.
- Verificar que responde `ok: true` y que se crea `manage_token`.
- Verificar que aparece la cita en agenda admin.

## Confirmación de reserva

- Abrir `/reservar/confirmacion?id=...`.
- Revisar datos de servicio, profesional, tenant y contacto.
- Confirmar que el enlace privado de gestión funciona.

## Reagendar

- Abrir `/reservar/gestionar?token=...`.
- Elegir un horario nuevo disponible.
- Verificar que no permita rangos inválidos ni solapes.
- Verificar que el resultado muestre estado correcto.

## Cancelar

- Cancelar la cita desde link privado.
- Confirmar que la cita queda `canceled`.
- Reintentar cancelar y validar respuesta idempotente.

## Ver cliente en CRM

- Abrir `/admin/customers`.
- Confirmar alta automática del cliente al reservar.
- Verificar búsqueda por nombre y teléfono.
- Abrir detalle del cliente y revisar historial.

## Crear pago Mercado Pago

- Ejecutar:

```bash
curl -X POST http://localhost:3000/api/payments/create-preference \
  -H "Content-Type: application/json" \
  -d '{"appointmentId":"UUID_CITA","tenantId":"UUID_TENANT"}'
```

- Verificar que devuelve `preference_id` e `init_point`.
- Confirmar que `payments.status` queda en `pending`.

## Simular webhook

- Ejecutar:

```bash
curl -X POST "http://localhost:3000/api/webhooks/mercadopago?tenantId=UUID_TENANT&appointmentId=UUID_CITA" \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","data":{"id":"MP_PAYMENT_ID"}}'
```

- Verificar que no falle por tenant/cita.
- Confirmar actualización de `payments.status`.

## Revisar estado `paid`

- Probar un pago sandbox aprobado.
- Confirmar que el webhook deja el registro en `paid`.
- Confirmar que n8n recibe `source = "payment_confirmed"` si `N8N_PAYMENT_CONFIRMED_WEBHOOK_URL` está configurada.
- Reenviar el mismo webhook y confirmar que no reprocesa doble aprobación.

## Revisar multi-tenant

- Probar con al menos dos tenants de test.
- Confirmar que:
  - servicios y profesionales no se mezclan
  - customers listan por tenant
  - create-preference rechaza `tenantId` distinto al de la cita
  - webhook rechaza `tenantId`/`appointmentId` inconsistentes

## Revisar mobile básico

- Probar `/reservar`, `/reservar/gestionar`, `/admin/customers`.
- Confirmar:
  - no hay overflow severo
  - botones principales visibles
  - selector de horarios usable
  - formulario de reserva usable
