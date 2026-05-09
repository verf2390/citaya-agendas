# Laboratorio DTE propio Citaya

## Objetivo

Crear una base técnica aislada para avanzar hacia `citaya_own_dte` sin tocar reservas, pagos, campañas ni emisión real.

El laboratorio permite iterar sobre generación XML, firma, CAF/folios, envío SII y estados antes de conectar cualquier flujo productivo.

La fase actual avanza desde XML dummy hacia un `SII-like XML laboratory format`: una estructura de laboratorio más cercana al modelo DTE chileno, pero todavía no certificada ni validada como XML final ante SII.

## Qué permite hacer hoy

- Validar y normalizar RUT chileno.
- Definir tipos DTE iniciales:
  - `boleta_exenta`
  - `boleta_afecta`
  - `factura_exenta`
  - `factura_afecta`
  - `nota_credito`
  - `nota_debito`
- Definir estados internos:
  - `draft`
  - `pending_signature`
  - `signed`
  - `pending_send`
  - `sent_to_sii`
  - `accepted`
  - `rejected`
  - `cancelled`
  - `error`
  - `pending_manual_issue`
  - `issued_manual`
- Generar XML DTE de laboratorio estilo SII desde un `TaxDocumentDraft`.
- Armar `EnvioDTE`, `SetDTE`, `Caratula`, `DTE`, `Documento`, `Encabezado`, `IdDoc`, `Emisor`, `Receptor`, `Totales` y `Detalle`.
- Separar builders de laboratorio para boleta, factura y sobre DTE:
  - `buildBoletaXmlLab()`
  - `buildFacturaXmlLab()`
  - `buildDteEnvelopeXmlLab()`
- Escapar caracteres especiales XML en campos de texto.
- Validar RUT emisor, RUT receptor, tipo DTE, folio, fecha, totales y detalles antes de generar XML.
- Simular firma XML.
- Simular semilla, token, envío y consulta de estado SII.
- Parsear campos mínimos de CAF en modo laboratorio.

## Qué NO hace todavía

- No genera XML final válido ante SII.
- No ha sido comparado ni validado contra XSD oficial SII.
- No firma XML real.
- No usa certificados reales.
- No usa CAF reales.
- No consume folios reales.
- No envía documentos al SII.
- No genera PDF tributario válido.
- No se conecta a pagos, reservas ni campañas.
- No guarda documentos tributarios en base de datos.

## Código creado

- `lib/dte/types.ts`
- `lib/dte/dte-types.ts`
- `lib/dte/rut.ts`
- `lib/dte/xml/build-dte-envelope.ts`
- `lib/dte/xml/build-boleta.ts`
- `lib/dte/xml/build-factura.ts`
- `lib/dte/xml/escape-xml.ts`
- `lib/dte/xml/validate-dte-draft.ts`
- `lib/dte/caf/parse-caf.ts`
- `lib/dte/signing/sign-xml.placeholder.ts`
- `lib/dte/sii/sii-client.placeholder.ts`

## Cómo probarlo

El repo todavía no tiene test runner propio configurado. Se dejaron tests con `node:test` como base técnica:

- `lib/dte/__tests__/rut.test.ts`
- `lib/dte/__tests__/dte-xml.test.ts`

Validaciones sugeridas por ahora:

```bash
npx eslint lib/dte
npm run build
```

Si el runtime local soporta TypeScript directo con `node:test`, también se pueden ejecutar los tests de laboratorio con:

```bash
node --test lib/dte/__tests__/*.test.ts
```

Cuando se agregue un runner TypeScript, estos tests deben ejecutarse como parte de CI.

## Riesgos

- El XML actual es experimental, estilo SII, y no debe enviarse al SII.
- Falta comparar la estructura generada contra XSD oficial SII.
- El parser CAF es mínimo y no valida firma ni estructura completa.
- El cliente SII es mock y no representa errores reales.
- La firma es placeholder y no prueba canonicalización.
- No hay almacenamiento cifrado de certificados ni CAF.

## Checklist para pasar de mock a certificación

- Obtener documentación técnica SII actualizada para DTE propios.
- Descargar schemas oficiales y validar XML contra XSD.
- Implementar XML completo por tipo DTE.
- Implementar carga segura de certificado por tenant.
- Implementar firma XML real con canonicalización compatible.
- Implementar carga y validación de CAF por tenant.
- Implementar reserva transaccional de folios.
- Implementar semilla/token SII en ambiente certificación.
- Enviar DTE firmado a certificación.
- Guardar `track_id` y respuesta resumida.
- Consultar estado y mapear rechazos.
- Generar PDF tributario desde documento emitido.
- Agregar auditoría por tenant.
- Activar solo con feature flag por tenant.

## Regla de seguridad

No usar certificados, claves privadas, passwords, CAF reales ni credenciales SII en el repositorio.

Citaya debe orquestar DTE por tenant. El RUT, certificado, CAF, folios, XML, PDF, track id y estado pertenecen al tenant emisor, no a Citaya globalmente.
