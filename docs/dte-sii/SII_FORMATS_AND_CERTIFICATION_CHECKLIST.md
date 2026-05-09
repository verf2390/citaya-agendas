# SII Formats and Certification Checklist — Citaya DTE

## Regla de oro

Todo XML, firma, CAF, folio, envío o PDF que no valide contra XSD oficial o ambiente de certificación SII debe quedar marcado como `LAB` / `PENDIENTE`, nunca como producción.

Citaya debe emitir a nombre de cada tenant autorizado. No debe emitir todos los documentos con el RUT de Citaya.

## Schemas XML oficiales

Descargar, versionar referencia técnica y validar contra:

- `EnvioDTE_v10.xsd`
- `DTE_v10.xsd`
- `SiiTypes_v10.xsd`
- `xmldsignature_v10.xsd`

## Estructuras XML a alinear

- `EnvioDTE`
- `SetDTE`
- `Caratula`
- `DTE`
- `Documento`
- `Encabezado`
- `IdDoc`
- `Emisor`
- `Receptor`
- `Totales`
- `Detalle`
- `TED` / Timbre Electrónico cuando corresponda
- `Signature`

## Elementos críticos DTE

- `TipoDTE`
- `Folio`
- `FchEmis`
- `RUTEmisor`
- `RznSoc`
- `GiroEmis`
- `DirOrigen`
- `CmnaOrigen`
- `CiudadOrigen`
- `RUTRecep`
- `RznSocRecep`
- `GiroRecep` cuando aplique
- `DirRecep` cuando aplique
- `CmnaRecep` cuando aplique
- `MntNeto`
- `IVA`
- `MntTotal`
- `NroLinDet`
- `NmbItem`
- `QtyItem`
- `PrcItem`
- `MontoItem`

## Firma XML

- Definir si se firma `Documento`, `DTE`, envío o más de un nodo según especificación aplicable.
- Implementar canonicalización compatible.
- Calcular digest del nodo correcto.
- Aplicar signature method requerido.
- Incluir `KeyInfo` cuando corresponda.
- Validar contra `xmldsignature_v10.xsd`.
- Validar XML firmado contra `DTE_v10.xsd` y `EnvioDTE_v10.xsd`.

## CAF y folios

- CAF por tenant/contribuyente.
- Rango desde/hasta.
- Tipo documento.
- Folio no reutilizable.
- Control transaccional de reserva y consumo.
- TED/timbre electrónico.
- Vigencia/estado de folios si aplica.
- Auditoría por tenant, tipo DTE, folio, documento, usuario/servicio y ambiente.

## Certificación sistema propio/de mercado

Proceso SII a considerar:

1. Postulación como sistema propio/de mercado.
2. Ambiente de certificación.
3. Set de pruebas asignado por SII.
4. Set de simulación.
5. Set de intercambio de información.
6. Envío de muestras de impresión.
7. Declaración de cumplimiento de requisitos.
8. Registro como emisor electrónico.

## Pendientes antes de SII real

- Descargar XSD oficiales.
- Crear validador XSD local o script documentado.
- Validar XML contra XSD.
- Implementar firma real.
- Implementar TED con CAF real.
- Implementar envío a ambiente certificación.
- Consultar estado de envío.
- Consultar estado DTE.
- Generar PDF/muestra impresa.
- Manejar rechazos SII.
- Auditar todo el flujo multi-tenant.
- Separar certificación y producción por tenant.
- Probar concurrencia de folios y evitar doble emisión.
