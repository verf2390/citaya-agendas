# Citaya DTE PDF Lab

Pendiente para una fase posterior.

El PDF tributario debe generarse desde el DTE emitido, folio autorizado, datos del emisor/receptor, totales, estado y timbre requerido.

Reglas:

- No generar PDF tributario "válido" si el XML no fue firmado/enviado/aceptado según el flujo que corresponda.
- No mezclar datos entre tenants.
- Guardar referencias a PDF por `tenant_id` y documento tributario.
- Evitar exponer XML o PDF de un tenant a otro.

