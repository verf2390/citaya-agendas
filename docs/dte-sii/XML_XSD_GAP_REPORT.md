# XML vs XSD oficial SII - reporte de brechas

Estado: LAB / PENDIENTE / NO PRODUCTIVO.

Este reporte compara el XML generado hoy por `lib/dte/xml/build-dte-envelope.ts` contra la estructura esperada por los schemas oficiales SII (`EnvioDTE_v10.xsd`, `DTE_v10.xsd`, `SiiTypes_v10.xsd`, `xmldsignature_v10.xsd`). La comparacion sigue marcada como LAB hasta ejecutar una validacion XSD completa en un entorno con validador instalado.

## Ejecucion real 2026-05-13

XML generado:

```text
docs/dte-sii/samples/lab-envio-dte.xml
```

Script usado:

```bash
node scripts/dte/generate-lab-xml.mjs
```

Resultado de generacion:

```text
/home/verf/apps/citaya-agendas/docs/dte-sii/samples/lab-envio-dte.xml
warnings=3
- XML experimental no productivo.
- SII-like XML laboratory format, no validado contra XSD oficial.
- No incluye CAF real, TED final ni firma XML real.
```

Comando de validacion solicitado:

```bash
node scripts/dte/validate-xsd.mjs docs/dte-sii/samples/lab-envio-dte.xml docs/dte-sii/xsd/EnvioDTE_v10.xsd
```

Resultado real:

```text
xmllint is required for local XSD validation. Install libxml2 tools or use a CI image that includes xmllint.
```

Estado: la validacion XSD no se ejecuto porque el entorno no tiene `xmllint`. No se obtuvo todavia una lista de errores schema-level desde `EnvioDTE_v10.xsd`; por lo tanto Citaya no puede marcar este XML como validado SII.

Validadores locales revisados sin instalar dependencias:

- `xmllint`: no disponible.
- `xmlstarlet`: no disponible.
- Python `lxml`: no disponible (`ModuleNotFoundError: No module named 'lxml'`).
- `java`: no disponible.

Nodos presentes en la muestra generada:

- `EnvioDTE`.
- `SetDTE`.
- `Caratula`.
- `DTE`.
- `Documento`.
- `Encabezado`.
- `IdDoc`.
- `Emisor`.
- `Receptor`.
- `Totales`.
- `Detalle`.

Brechas observables desde el XML generado, previas a validacion XSD completa:

- `TmstFirmaEnv` contiene `LAB-NOT-SIGNED`, no un timestamp/firma de envio real.
- `Documento` no contiene `TED`.
- `Documento` no contiene `TmstFirma`.
- No hay `Signature` XMLDSig real.
- No hay CAF real ni `FRMT`.
- El XML es una boleta afecta tipo 39 LAB con datos ficticios, no una emision tributaria.

## Bloqueadores de validacion real hoy

- Los XSD oficiales ya estan presentes en `docs/dte-sii/xsd/`, pero la validacion local no pudo ejecutarse porque falta `xmllint`.
- `Signature` es mock y no contiene digest/firma criptografica real.
- No existe `TED` real dentro de `Documento`.
- No existe `TmstFirma` real del documento.
- No se firma `SetDTE`/envio segun flujo SII.
- No se pudo validar orden exacto de nodos contra XSD en este entorno.
- No se pudo validar cardinalidad completa por tipo DTE en este entorno.
- No se usa CAF real ni `FRMT` real.
- No hay cliente de certificacion que confirme aceptacion SII.

## EnvioDTE / SetDTE

Brechas detectadas:

- `EnvioDTE` usa namespace SII y `version="1.0"`, pero no se ha validado contra `EnvioDTE_v10.xsd`.
- `SetDTE ID` existe, pero su formato debe confirmarse contra reglas SII.
- Falta firma real del envio cuando corresponda.
- `TmstFirmaEnv` contiene `LAB-NOT-SIGNED`, valor invalido para XSD/operacion real.
- `RutEnvia` usa el RUT emisor de forma simplificada. En certificacion debe ser el RUT autorizado que firma/envia.

Prioridad: alta.

## Caratula

Brechas detectadas:

- `RutEmisor`, `RutEnvia`, `RutReceptor`, `FchResol`, `NroResol`, `TmstFirmaEnv` y `SubTotDTE` estan presentes en forma basica.
- `FchResol` y `NroResol` usan fallback LAB (`2006-01-01`, `0`) si el tenant no tiene datos reales.
- Falta validar el orden exacto de `SubTotDTE` y cardinalidad contra XSD.
- Falta validar `RutReceptor` segun ambiente y tipo de envio.

Prioridad: alta.

## DTE / Documento

Brechas detectadas:

- `DTE version="1.0"` y `Documento ID` existen.
- `Documento ID` es generado por Citaya LAB y debe confirmarse como referencia valida para XMLDSig.
- Falta `TED` real.
- Falta `TmstFirma`.
- Falta `Signature` real como hijo correcto del `Documento` o del nodo que exija SII segun caso.

Prioridad: critica.

## Encabezado / IdDoc

Brechas detectadas:

- `TipoDTE`, `Folio` y `FchEmis` existen.
- No se cubren campos condicionales por tipo DTE, por ejemplo formas de pago, fechas de vencimiento o indicadores requeridos segun documento.
- Falta matriz por tipo DTE: 33, 34, 39, 41, 56, 61.

Prioridad: alta.

## Emisor

Brechas detectadas:

- `RUTEmisor`, `RznSoc`, `GiroEmis`, `Acteco`, `DirOrigen`, `CmnaOrigen`, `CiudadOrigen` existen.
- `Acteco` puede emitirse vacio; esto puede fallar si XSD o reglas SII lo consideran obligatorio/condicional.
- Falta validar longitudes, caracteres y codificacion ISO-8859-1.
- Falta asegurar que datos correspondan al tenant autorizado y al CAF.

Prioridad: alta.

## Receptor

Brechas detectadas:

- `RUTRecep`, `RznSocRecep`, `GiroRecep`, `DirRecep`, `CmnaRecep`, `CiudadRecep`, `CorreoRecep` existen.
- Algunos campos opcionales se imprimen aunque vengan vacios/undefined. Conviene omitir condicionales cuando no apliquen.
- Falta manejo especial para boletas a consumidor final y facturas con receptor empresa.

Prioridad: media.

## Totales

Brechas detectadas:

- `MntNeto`, `MntExe`, `IVA`, `MntTotal` existen.
- Falta aplicar reglas por DTE exento/afecto para omitir o incluir nodos segun XSD y reglas de negocio.
- Falta validar redondeos, IVA y consistencia detalle-total.

Prioridad: alta.

## Detalle

Brechas detectadas:

- `NroLinDet`, `NmbItem`, `DscItem`, `QtyItem`, `PrcItem`, `MontoItem` existen.
- Falta validar limites de lineas y longitudes.
- Falta soporte de descuentos/recargos, codigos de item y exenciones por linea cuando apliquen.
- Falta confirmar orden exacto contra XSD.

Prioridad: media.

## TED / Timbre Electronico

Brechas detectadas:

- No existe `TED` en XML final.
- No existe `DD` con `RE`, `TD`, `F`, `FE`, `RR`, `RSR`, `MNT`, `IT1`, `CAF`, `TSTED`.
- No existe `FRMT` firmado con clave privada del CAF.
- No existe PDF417 real para muestra impresa.

Prioridad: critica.

## Signature

Brechas detectadas:

- Existe `Signature` mock solo para laboratorio.
- `DigestValue`, `SignatureValue` y `KeyInfo` son placeholders.
- No hay canonicalizacion real.
- No hay firma RSA sobre el nodo correcto.
- No se valida contra `xmldsignature_v10.xsd`.
- No se protege el acceso a certificado real desde secret manager o ruta local ignorada.

Prioridad: critica.

## Plan de correccion

1. Descargar XSD oficiales SII a `docs/dte-sii/xsd/` y ejecutar `xmllint`.
2. Ajustar orden/cardinalidad de `EnvioDTE`, `Caratula`, `DTE`, `Documento`, `Encabezado`, `Totales`, `Detalle`.
3. Implementar TED real con CAF controlado y `FRMT` real.
4. Implementar firma XMLDSig real sobre el nodo correcto.
5. Crear fixtures XML por tipo DTE y validar en CI.
6. Enviar XML firmado al ambiente de certificacion SII y guardar evidencia.
7. Solo despues cambiar estados desde LAB/PENDIENTE a certificacion aprobada.

## Dependencias evaluadas

No se instalo ninguna dependencia. Para validacion XSD portable en Node, se podria evaluar `libxmljs2` o una alternativa mantenida, pero requiere revisar compatibilidad con Next/CI. La alternativa sin dependencia es `xmllint` instalado en el entorno de desarrollo/CI.
