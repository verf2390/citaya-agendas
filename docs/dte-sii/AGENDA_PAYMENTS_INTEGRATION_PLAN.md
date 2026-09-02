# Integracion DTE con agenda y pagos

Estado: plan Fase 10 / PENDIENTE.

No conectar emision real a pagos/reservas hasta completar Fases 5-9 y pruebas de certificacion.

## Flujo objetivo

Reserva creada
-> pago aprobado o reserva marcada como pagada
-> Citaya crea `tax_documents` en `draft`
-> asocia tenant, appointment, payment y customer
-> genera XML
-> reserva folio CAF
-> genera TED
-> firma XML
-> envia al SII
-> guarda `track_id`, folio, XML, PDF y estado
-> muestra documento en admin/facturacion, agenda y ficha cliente
-> envia comprobante al cliente.

## Endpoints involucrados

- `app/api/payments/create`.
- `app/api/payments/create-preference`.
- `app/api/webhooks/mercadopago`.
- `app/api/webhooks/khipu`.
- `app/api/payments/webpay/return`.
- `app/api/admin/appointments/mark-paid`.
- Futuros endpoints DTE internos para crear/generar/enviar/consultar documento.

## Estados

- `draft`.
- `pending_signature`.
- `signed`.
- `pending_send`.
- `sent_to_sii`.
- `accepted`.
- `rejected`.
- `error`.
- `cancelled`.

## Estrategia anti doble emision

- Constraint unico por `tenant_id`, `document_type`, `folio`.
- Idempotency key por `tenant_id + payment_id` o `tenant_id + appointment_id`.
- Reserva de folio transaccional.
- Job retry con estado explicito y lock.
- No marcar folio usado si falla antes de firma/envio segun regla final.
- Si SII rechaza, no reemitir automaticamente sin decision operativa.

## Pago falla o queda pendiente

- No crear DTE real si pago falla.
- Mantener `draft` o no crear documento si el pago esta pendiente.
- Si un webhook llega duplicado, usar idempotencia por pago.
- Si pago cambia a reversado, definir nota de credito/anulacion antes de automatizar.

## Rechazo SII

- Guardar rechazo normalizado.
- Mostrar estado en facturacion, agenda, pagos y cliente.
- Permitir reintento manual solo si no consume folio de forma incorrecta.
- Escalar a soporte cuando el rechazo sea por certificado, CAF, schema o autorizacion.

## Superficies UI

- Facturacion: listado tributario, filtros por estado, detalle XML/PDF/track_id.
- Agenda: badge de documento en la reserva.
- Pagos: documento asociado y estado SII.
- Customers: historial tributario del cliente.

