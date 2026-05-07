# Investigación DTE propio SII — Citaya

## Objetivo

Investigar y construir la base para que Citaya pueda emitir documentos tributarios electrónicos en Chile sin depender inicialmente de un proveedor DTE externo.

## Alcance inicial

Esta rama NO debe emitir documentos reales todavía.

Primero se investigará y documentará:

- Certificado digital
- Firma electrónica XML
- CAF / folios
- Estructura XML DTE
- Boleta electrónica
- Factura afecta
- Factura exenta
- Nota de crédito
- Envío al SII
- Consulta de estado
- PDF / representación impresa
- Almacenamiento seguro
- Flujo multi-tenant

## Documentos objetivo

- Boleta electrónica: tipo 39
- Factura electrónica afecta: tipo 33
- Factura electrónica exenta: tipo 34
- Nota de crédito electrónica: tipo 61

## Preguntas técnicas pendientes

1. Qué flujo exacto exige SII para emitir DTE con sistema propio.
2. Qué diferencia hay entre Portal MiPyme, facturador propio y facturador de mercado.
3. Si se puede automatizar el sistema gratuito del SII legal y técnicamente.
4. Qué certificados necesita cada cliente.
5. Cómo se obtienen y administran folios CAF.
6. Cómo se firma correctamente el XML.
7. Cómo se envía el sobre DTE al SII.
8. Cómo se consulta el estado de aceptación/rechazo.
9. Qué se debe guardar por documento.
10. Qué parte debe vivir en Citaya y qué parte debe quedar aislada por seguridad.

## Regla de seguridad

No guardar certificados reales, claves privadas ni claves SII en texto plano.

## Fases

### Fase 0
Documentación e investigación.

### Fase 1
Generar XML DTE de prueba local sin envío real.

### Fase 2
Firmar XML localmente con certificado de prueba.

### Fase 3
Preparar modelo de folios/CAF.

### Fase 4
Enviar a ambiente de certificación/pruebas si aplica.

### Fase 5
Integración controlada en Citaya.
