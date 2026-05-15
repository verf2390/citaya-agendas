# Agenda/Pagos -> DTE Integration Plan

Estado: **plan futuro, no productivo**. No activar emision automatica hasta completar certificacion/aprobacion SII por tenant.

## Eventos candidatos

- Pago confirmado.
- Reserva confirmada.
- Pago manual marcado como pagado.
- Emision manual desde admin.
- Nota de credito futura si se cancela una reserva/pago ya emitido.

## Flujo seguro

1. `payment paid` o `appointment confirmed`.
2. Verificar tenant DTE enabled y ambiente permitido.
3. Verificar certificado, CAF vigente, folios disponibles y autorizacion SII del tenant.
4. Crear idempotency key por `tenant_id + payment_id/appointment_id + document_type`.
5. Reservar folio en transaccion.
6. Crear `tax_documents` en `draft`.
7. Generar XML y marcar `xml_generated`.
8. Firmar FRMT/XMLDSig y marcar `signed`.
9. Enviar a SII y guardar `track_id`.
10. Consultar estado SII.
11. Marcar `accepted`, `accepted_with_observations`, `rejected` o `failed`.
12. Generar PDF/muestra y asociar a appointment/payment/customer.

## Protecciones obligatorias

- Evitar doble emision con unique constraints por appointment/payment/reference.
- Reintentos idempotentes: si ya existe documento `submitted` o `accepted`, no emitir otro.
- Pagos fallidos no emiten.
- Reservas canceladas no emiten; si ya emitieron, evaluar nota de credito.
- Tenants no certificados quedan bloqueados.
- Folios agotados bloquean emision y notifican al admin.
- Rechazo SII queda auditado y no reutiliza folio firmado/enviado.
- Platform admin puede diagnosticar, pero no emitir cruzado sin trazabilidad.
