# Cliente SII Certification

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

El cliente queda separado por responsabilidades:

- `lib/dte/sii/sii-auth.ts`: seed, firma de seed y token.
- `lib/dte/sii/sii-submit.ts`: envio de set `EnvioDTE`.
- `lib/dte/sii/sii-status.ts`: consulta y mapeo de estado.
- `lib/dte/sii/sii-types.ts`: contratos internos.
- `lib/dte/sii/sii-errors.ts`: errores controlados.
- `lib/dte/sii/sii-certification-client.ts`: fachada compatible.

No hay aprobacion SII, no hay emision legal y no hay produccion habilitada.

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

- `DTE_SII_ENV=certification`.
- `DTE_SII_SEED_URL`.
- `DTE_SII_TOKEN_URL`.
- `DTE_SII_SUBMIT_URL`.
- `DTE_SII_STATUS_URL`.
- `DTE_SII_ENABLE_SUBMIT=true` solo para submit real controlado en certification.
- `SII_RUT_EMPRESA`.
- `SII_RUT_USUARIO`.

No agregar valores reales al repositorio.

Si `DTE_SII_ENV=production`, el sistema bloquea con:

```text
DTE_PRODUCTION_DISABLED_UNTIL_SII_APPROVAL
```

## Errores controlados

- `SII_CERTIFICATION_ENDPOINT_MISSING`
- `SII_CERTIFICATE_MISSING`
- `SII_PRIVATE_KEY_MISSING`
- `SII_TOKEN_PENDING_REAL_CERTIFICATION`
- `SII_SUBMIT_PENDING_REAL_CERTIFICATION`
- `SII_STATUS_PENDING_REAL_CERTIFICATION`

## Smoke test

Dry-run por defecto, sin contacto SII ni `track_id` simulado:

```bash
node scripts/dte/sii-certification-smoke.mjs --dry-run
```

Submit real de certification, solo con secretos reales y flag:

```bash
node scripts/dte/sii-certification-smoke.mjs --submit
```

Consulta de estado:

```bash
node scripts/dte/sii-certification-smoke.mjs --status-only --track-id=123456
```

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
