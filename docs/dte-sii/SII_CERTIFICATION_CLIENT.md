# Cliente SII certificacion

Estado: scaffold serio / PENDIENTE / NO PRODUCTIVO.

El modulo `lib/dte/sii/sii-client.certification.ts` define la ruta para operar contra ambiente de certificacion SII, pero bloquea envio real hasta que existan XML validado contra XSD, firma XML real y CAF/TED real. El setup local previo esta documentado en `docs/dte-sii/CERTIFICATION_ENV_SETUP.md`.

## Flujo esperado

1. Generar XML DTE con folio CAF del tenant.
2. Generar TED y `FRMT` real.
3. Firmar `Documento` y/o envio segun exigencia SII.
4. Validar localmente contra XSD oficiales.
5. Obtener semilla (`getSeed`) en ambiente certificacion.
6. Firmar semilla y obtener token (`getToken`).
7. Enviar sobre DTE firmado.
8. Recibir y guardar `track_id`.
9. Consultar estado por `track_id`.
10. Guardar evidencia, rechazos normalizados y estado interno.

## Variables previstas

- `SII_ENV=lab|certification|production`.
- `SII_CERTIFICATION_BASE_URL`.
- `SII_PRODUCTION_BASE_URL`.
- `SII_RUT_EMPRESA`.
- `SII_RUT_USUARIO`.

No agregar valores reales al repositorio.

## Pruebas seguras

- Usar solo `SII_ENV=certification` para pruebas SII.
- Mantener botones admin de envio deshabilitados hasta confirmar configuracion.
- No enviar XML desde `/admin/facturacion` sin confirmacion visual y modo certificacion explicito.
- Registrar rechazos normalizados sin guardar secretos en logs.

## Evidencia para aprobacion

Guardar por tenant/documento:

- XML generado y hash.
- XML firmado y hash.
- XSD usados y fecha de descarga.
- CAF hash y rango.
- Folio.
- `track_id`.
- Estado SII.
- Rechazos/observaciones.
- Fecha/hora y usuario/servicio.

## Pendiente oficial

- Completar XML local certification con CAF, FRMT y XMLDSig reales/controlados.
- Validar `tmp/dte-certification/certification-envio-dte.xml` contra XSD oficial.
- Confirmar endpoints vigentes y contratos request/response en documentacion SII.
- Confirmar certificados y flujo token para certificacion.
- Confirmar formatos exactos para upload DTE y consulta estado.
- Ejecutar pruebas reales en ambiente certificacion.
