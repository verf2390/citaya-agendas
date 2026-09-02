# Esquemas oficiales para Boleta Electrónica

Descarga verificada el 2026-07-29 desde recursos públicos del Servicio de
Impuestos Internos. Estos archivos son únicamente para validación local; su
descarga no utilizó autenticación, seed, token, CAF ni servicios tributarios.

## Boleta Electrónica

- Página oficial: `https://www.sii.cl/servicios_online/3532-formato_xml-3811.html`
- Archivo oficial: `https://www.sii.cl/factura_electronica/factura_mercado/schema_envio_bol.zip`
- SHA-256 del ZIP: `8ae0bda6fc86a7656f4b5a18e6e5664ae463422c9786d9e6893c57efa150ac8e`
- Esquema: `boleta-v11/EnvioBOLETA_v11.xsd`
- SHA-256: `e0fbbaf70b0ac8ea2c0ac2310edac41bdd3773cef20fccf6d97e5b92ebeedaa9`
- Firma XML: `boleta-v11/xmldsignature_v10.xsd`
- SHA-256: `427e3225cd379ae92bae464b892dbf964665af92d453ac61774cffab38b95edb`
- Formato funcional: Boleta Electrónica versión 4.2, 2025-09-08.

El esquema de boleta es independiente de `EnvioDTE_v10.xsd`, utilizado por
Factura Electrónica. No se debe validar ni enviar un `EnvioBOLETA` usando el
esquema o endpoint de factura.

## Resumen de Ventas Diarias

- Archivo oficial:
  `https://www.sii.cl/factura_electronica/factura_mercado/ConsumoFolio_v10.xsd`
- Esquema: `rvd-v10/ConsumoFolio_v10.xsd`
- SHA-256: `ab56a92683a32f8621203b5416ebd0787bb50935bd34e3eef98c54ba25387cfc`
- Formato funcional: Resumen de Ventas Diarias versión 2.0, 2020-08-03.
- Dependencia `SiiTypes_v10.xsd`:
  `ce9a84bde70aa9d0f9269d99acd3b0ea81d868022517ac31064b6cdfa0c45bdf`
- Dependencia `xmldsignature_v10.xsd`:
  `427e3225cd379ae92bae464b892dbf964665af92d453ac61774cffab38b95edb`

Las dependencias del RVD se conservan en un directorio propio para impedir que
una actualización futura de factura o boleta cambie silenciosamente el
validador del resumen diario.
