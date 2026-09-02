# Citaya DTE — Flujo MiPyme Asistido

## Objetivo

Mantener una versión de facturación asistida usando el Sistema de Facturación Gratuito del SII / MiPyme, sin emitir DTE directamente desde Citaya.

Este flujo queda como fallback manual temporal mientras el camino principal avanza por `citaya_own_dte`. Permite que Citaya ordene pagos, reservas y documentos tributarios pendientes, pero la emisión real del documento se realiza manualmente desde el portal del SII.

## Alcance fase 1

Citaya debe:

- Registrar datos tributarios del negocio.
- Registrar datos tributarios del cliente cuando solicite factura.
- Asociar pagos o reservas con estado tributario.
- Mostrar documentos pendientes de emisión.
- Permitir marcar manualmente un documento como emitido.
- Guardar folio, tipo de documento, fecha de emisión y comprobante/PDF si aplica.

Citaya NO debe todavía:

- Firmar XML.
- Solicitar CAF.
- Consumir folios.
- Enviar DTE al SII.
- Consultar estado automático del DTE.
- Guardar certificados digitales reales.
- Emitir boletas o facturas reales desde la app.

## Flujo operativo

1. Cliente reserva o paga.
2. Citaya registra la reserva/pago.
3. Si corresponde documento tributario, Citaya crea un registro interno en estado `pending_manual_issue`.
4. El administrador entra a `/admin/facturacion` o `/admin/pagos`.
5. El administrador ve documentos pendientes.
6. El administrador emite manualmente el documento en SII MiPyme.
7. El administrador vuelve a Citaya y registra:
   - tipo de documento
   - folio
   - fecha de emisión
   - monto
   - estado `issued_manual`
   - PDF/comprobante opcional

## Estados sugeridos

- `pending_manual_issue`
- `issued_manual`
- `cancelled_manual`
- `error`
- `future_auto_issue`

## Tipos de documento iniciales

- `boleta`
- `factura_afecta`
- `factura_exenta`
- `nota_credito`

## Campos futuros

- `sii_track_id`
- `xml_url`
- `pdf_url`
- `caf_id`
- `signed_at`
- `sent_at`
- `accepted_at`
- `rejected_reason`

## Decisión técnica

El camino principal actual es `citaya_own_dte`. MiPyme asistido se mantiene como fallback operativo para tenants que aún no estén certificados o habilitados en el motor propio.

Motivo:

- Reduce riesgo técnico.
- No requiere certificación inmediata con SII.
- No requiere manejar certificados digitales reales desde Citaya.
- Permite continuidad operativa si el motor DTE propio aún no está listo para un tenant.

## Futuro DTE automático

Para emitir DTE real desde Citaya más adelante se debe investigar e implementar:

- Certificado digital por contribuyente.
- Firma XML.
- CAF y folios autorizados.
- XML DTE según schemas del SII.
- Envío al SII.
- Consulta de estado.
- Almacenamiento seguro de XML/PDF.
- Auditoría por tenant.
- Manejo de errores y rechazos.
