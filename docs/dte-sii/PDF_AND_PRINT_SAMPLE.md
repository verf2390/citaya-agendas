# PDF tributario y muestra impresa

Estado: LAB / PENDIENTE / NO PRODUCTIVO.

Citaya ya tiene una base de muestra impresa/PDF en `lib/dte/pdf/` y acciones visibles en `/admin/facturacion`.

## Implementado

- HTML imprimible con emisor, receptor, tipo DTE, folio, fecha, detalle, neto, IVA, total, estado y ambiente.
- PDF de muestra con `jsPDF`.
- Advertencia visible si el ambiente no es `PRODUCTION`.
- Espacio reservado para timbre electronico/PDF417.
- Botones admin: `Ver muestra` y `Generar PDF de prueba`.

## Pendiente para SII real

- TED real con `FRMT`.
- PDF417 real generado desde TED.
- XML firmado y validado contra XSD oficial.
- Estado aceptado o evidencia de certificacion SII.
- Almacenamiento seguro por tenant/documento.
- Control de acceso para admin/cliente.

## Uso en certificacion

La muestra se usara como base visual para revisar datos y layout. No debe presentarse como documento tributario productivo hasta completar firma, CAF/TED, envio SII y aceptacion del flujo correspondiente.

## Entrega al cliente en produccion

Cuando el tenant este habilitado:

- Generar PDF desde `tax_documents` aceptado o estado permitido por el flujo SII.
- Guardar `pdf_path` asociado a tenant/documento.
- Enviar por email solo al cliente correcto.
- Mostrar en admin, agenda, pagos y ficha cliente con filtros por `tenant_id`.

