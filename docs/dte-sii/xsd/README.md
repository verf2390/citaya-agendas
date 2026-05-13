# Schemas oficiales SII para DTE

Esta carpeta queda reservada para los XSD oficiales usados al validar XML DTE antes de enviar al ambiente de certificacion SII.

## Archivos minimos requeridos

- `EnvioDTE_v10.xsd`: sobre de envio DTE.
- `DTE_v10.xsd`: estructura del documento tributario.
- `SiiTypes_v10.xsd`: tipos comunes SII.
- `xmldsignature_v10.xsd`: firma XMLDSig usada por SII.

## Fuente oficial

Descargar siempre desde el sitio oficial del SII, seccion de Factura Electronica / Documentacion tecnica / Formatos XML y schemas. No copiar XSD desde blogs, gists ni repositorios terceros como fuente primaria.

Los XSD son publicos y pueden versionarse si se descargan intactos desde SII. Si SII publica una revision nueva, conservar el nombre original o documentar claramente la fecha de descarga y el cambio.

## Que no debe subirse

- Certificados `.p12`, `.pfx`, `.pem`, `.key`.
- Passwords, tokens, cookies, semillas/token SII.
- CAF reales de tenants.
- XML reales con datos tributarios sensibles.
- Respuestas SII completas si contienen datos privados del contribuyente.

## Validacion local

Sin dependencias Node nuevas, la opcion practica es usar `xmllint` si esta disponible en la maquina:

```bash
xmllint --noout --schema docs/dte-sii/xsd/EnvioDTE_v10.xsd path/al/envio.xml
```

Tambien se puede usar la utilidad segura de Citaya:

```bash
node scripts/dte/validate-xsd.mjs path/al/envio.xml docs/dte-sii/xsd/EnvioDTE_v10.xsd
```

Esa utilidad no implementa validacion XSD por si sola: invoca `xmllint` y falla explicitamente si no existe. Si se requiere validacion portable en CI, evaluar una dependencia dedicada antes de instalarla.

## Mantenimiento

- Registrar fecha de descarga y URL oficial en este README cuando se agreguen XSD reales.
- Validar que los imports/references entre XSD funcionen desde esta carpeta.
- No modificar manualmente los XSD oficiales salvo que se documente como parche local y quede fuera del camino de certificacion.
- Cada cambio en builders XML debe acompanarse de una prueba con `EnvioDTE_v10.xsd` y `xmldsignature_v10.xsd`.

## Estado actual

PENDIENTE: los XSD oficiales no estan versionados todavia. Todo XML generado por `lib/dte` sigue marcado como LAB / NO PRODUCTIVO hasta validar contra estos schemas y contra el ambiente de certificacion SII.
