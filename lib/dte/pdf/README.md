# Citaya DTE PDF / Print Lab

Este directorio contiene la base de muestra impresa/PDF para DTE Citaya.

El PDF tributario debe generarse desde el DTE emitido, folio autorizado, datos del emisor/receptor, totales, estado y timbre requerido.

## Estado actual

- `build-dte-print-view.ts` genera HTML imprimible profesional para LAB/CERTIFICATION.
- `build-dte-pdf.ts` genera PDF de muestra con `jsPDF`, dependencia ya presente en el proyecto.
- El bloque de timbre electronico/PDF417 queda visible como PENDIENTE.
- Ninguna salida se marca como valida para produccion.

Reglas:

- No generar PDF tributario "válido" si el XML no fue firmado/enviado/aceptado según el flujo que corresponda.
- No mezclar datos entre tenants.
- Guardar referencias a PDF por `tenant_id` y documento tributario.
- Evitar exponer XML o PDF de un tenant a otro.
- Insertar PDF417 real solo despues de TED/FRMT real y validacion SII.
