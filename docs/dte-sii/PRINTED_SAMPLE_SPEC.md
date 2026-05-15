# Printed Sample Spec

Estado: **LAB / NO PRODUCTIVO / MUESTRA PRE-CERTIFICACION**.

La muestra impresa ayuda a revisar layout y datos, pero no es documento tributario valido.

## Campos minimos

- Nombre emisor.
- RUT emisor.
- Giro.
- Direccion, comuna y ciudad.
- Tipo DTE.
- Folio.
- Fecha.
- Receptor y RUT receptor.
- Detalle con cantidad, precio y monto.
- Neto, exento, IVA y total.
- Estado TED: placeholder o TED real cuando exista.
- Marca visible: `LAB / NO PRODUCTIVO / MUESTRA PRE-CERTIFICACION`.

## Implementacion actual

- `lib/dte/pdf/build-dte-print-view.ts` genera HTML imprimible.
- `lib/dte/pdf/build-dte-pdf.ts` genera PDF LAB con marca de no validez.
- `/admin/facturacion` permite ver muestra y generar PDF de prueba.

## Pendiente real

- PDF417/TED real.
- Reglas visuales finales SII para cada tipo DTE.
- Firma, folio y track real antes de quitar marcas LAB.
