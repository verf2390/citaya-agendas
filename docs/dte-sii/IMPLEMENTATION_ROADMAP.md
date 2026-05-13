# DTE/SII Implementation Roadmap — Citaya

## Principios

- El camino principal es `citaya_own_dte`.
- Citaya no debe emitir documentos usando el RUT de Citaya para todos los tenants.
- Cada tenant debe emitir con su propio RUT, certificado digital, CAF/folios y habilitación tributaria.
- `manual_mipyme` queda como fallback manual temporal.
- `external_provider` queda como alternativa temporal/plan B.
- No se debe tocar el flujo de pagos, reservas o campañas para emitir DTE real hasta que exista una fase validada.
- No se deben usar certificados, claves privadas, CAF ni credenciales reales dentro del repositorio.

## Fase 1 — Laboratorio operativo DTE propio

Objetivo: crear una base técnica aislada para avanzar hacia DTE propio sin afectar producción.

Alcance:

- Validar y normalizar RUT chileno.
- Definir tipos DTE internos.
- Definir estados internos del documento tributario.
- Definir `TenantTaxProfile`, `TaxDocumentDraft` y resultados de generación.
- Generar XML DTE dummy/no productivo.
- Crear placeholders de firma XML.
- Crear cliente SII mock con semilla, token, envío y estado simulados.
- Documentar seguridad, riesgos y pasos hacia certificación.

Fuera de alcance:

- Firma real.
- Envío real al SII.
- CAF/folios reales.
- Certificados reales.
- PDF tributario válido.
- Emisión automática post pago.

## Fase 2 — XML DTE de laboratorio estilo SII

Objetivo: reemplazar el XML dummy por XML DTE de laboratorio más cercano al modelo SII para los tipos iniciales, sin afirmar compatibilidad final ni certificación.

Alcance:

- Boleta afecta tipo 39.
- Boleta exenta tipo 41.
- Factura afecta tipo 33.
- Factura exenta tipo 34.
- Nota de crédito tipo 61.
- Nota de débito tipo 56.
- Carátula, encabezado, emisor, receptor, totales y detalle.
- Escape seguro de valores XML.
- Validaciones mínimas de RUT, folio, fecha, totales y detalles.
- Builders separados para boleta, factura y sobre DTE.
- Tests básicos de estructura XML y escape de caracteres.

Fuera de alcance:

- Validación contra schemas oficiales.
- Firma XML real.
- CAF/folios reales.
- Envío al ambiente de certificación SII.
- Emisión desde flujos productivos de Citaya.

## Fase 3 — Firma XML real de laboratorio con certificado de prueba/controlado

Objetivo: firmar XML de laboratorio con un certificado de prueba/controlado del tenant/contribuyente, manteniendo el flujo fuera de producción.

Alcance:

- Firma MOCK segura para probar flujo visual y estados.
- Tipos `SigningCertificateInput`, `XmlSignatureOptions` y `SignedXmlResult`.
- Referencia explícita a `xmldsignature_v10.xsd`.
- Carga segura de certificado por tenant.
- Password por variable segura o secret manager.
- Canonicalización XML requerida.
- Digest y firma del nodo objetivo.
- Firma del DTE y del envío cuando corresponda.
- Pruebas con certificados de certificación.
- Auditoría de acceso a secretos.

Controles mínimos:

- No exponer certificados al frontend.
- No loggear certificados, passwords ni XML firmado completo.
- Cifrado por tenant.
- Separación estricta entre certificación y producción.

## Fase 4 — CAF/folios

Objetivo: preparar CAF/folios de laboratorio y el futuro control de consumo por tenant/tipo DTE sin usar CAF ni folios reales.

Alcance:

- Parser CAF dummy/lab con RUT emisor, tipo DTE, rango y fecha de autorización.
- Tipos `CafLabData`, `FolioReservation` y `FolioState`.
- Folio manager en memoria para reservar, marcar usado, liberar y consultar disponibilidad.
- Cargar CAF por tenant de forma segura.
- Parsear rango autorizado y tipo DTE.
- Reservar folio antes de emitir.
- Marcar folio como usado solo si corresponde.
- Manejar reintentos, errores y folios agotados.
- Evitar doble consumo de folio con transacciones/idempotencia.

Fuera de alcance:

- CAF real.
- Folios reales SII.
- Persistencia en base de datos.
- Concurrencia real multi-proceso.
- Emisión automática desde pagos/reservas.

## Fase 5 — Envío ambiente certificación SII

Objetivo: enviar DTE firmado al ambiente de certificación SII y consultar estado.

Alcance:

- Obtener semilla/token reales en certificación.
- Enviar sobre DTE.
- Guardar `track_id`.
- Consultar estado.
- Mapear respuestas SII a estados internos.
- Registrar respuesta resumida para auditoría.

## Fase 6 — PDF tributario

Objetivo: generar representación impresa desde DTE emitido.

Alcance:

- PDF desde XML/documento emitido.
- Datos del emisor, receptor, detalle, totales, folio y fecha.
- Timbre requerido cuando aplique.
- Almacenamiento por tenant.
- Acceso seguro desde admin/cliente según reglas.

## Fase 7 — Motor multi-tenant

Objetivo: conectar el motor DTE con datos reales de Citaya sin emisión automática masiva.

Alcance:

- `tenant_tax_profiles`.
- Certificados y CAF por tenant.
- `tax_documents` con tenant, reserva, pago y cliente.
- Auditoría por tenant.
- Feature flags por tenant y ambiente.
- Backoffice para soporte.
- Idempotencia por pago/reserva.

## Fase 8 — Emisión automática post pago

Objetivo: emitir DTE automáticamente después de pago aprobado solo para tenants habilitados.

Requisitos previos:

- Certificación SII completada.
- Tenant habilitado y probado.
- Certificado y CAF vigentes.
- Flujo de nota de crédito definido.
- Observabilidad y soporte.
- Feature flag de activación.

Regla:

No conectar Mercado Pago, Webpay, Khipu ni pagos productivos a emisión real hasta completar fases 1 a 7 y validar con pruebas manuales controladas.

## Rebase de fases criticas para junio

La numeracion historica anterior queda como contexto. El plan operativo actual para `citaya_own_dte` se organiza asi:

## Fase 5 critica — XSD oficial y brechas

Entregado:

- `docs/dte-sii/xsd/README.md`.
- `docs/dte-sii/XML_XSD_GAP_REPORT.md`.
- `scripts/dte/validate-xsd.mjs`.

Pendiente:

- Descargar XSD oficiales desde SII.
- Ejecutar validacion real con `EnvioDTE_v10.xsd`.
- Ajustar orden/cardinalidad de XML segun errores reales.

## Fase 6 critica — firma XML real controlada

Entregado:

- `lib/dte/signing/sign-xml.real.ts`.
- Variables previstas: `DTE_CERT_PATH`, `DTE_CERT_PASSWORD`, `DTE_SIGNING_MODE`.
- Tests de fallo seguro sin secretos.

Pendiente:

- Evaluar e instalar dependencia XMLDSig, probablemente `xml-crypto`, o implementar manualmente con `node:crypto`.
- Extraer clave privada desde certificado controlado.
- Canonicalizar, digerir y firmar nodo correcto.
- Validar contra `xmldsignature_v10.xsd`.

## Fase 7 critica — CAF/TED real

Entregado:

- `lib/dte/caf/parse-caf.real.ts`.
- `lib/dte/caf/folio-manager.ts`.
- `lib/dte/caf/ted-builder.ts`.
- Tipos CAF/TED.

Pendiente:

- Leer CAF desde storage seguro.
- Validar firma CAF.
- Firmar `FRMT` real.
- Persistir folios con transacciones e idempotencia.

## Fase 8 critica — cliente ambiente certificacion SII

Entregado:

- `lib/dte/sii/sii-client.certification.ts`.
- `docs/dte-sii/SII_CERTIFICATION_CLIENT.md`.
- UI admin con estados de certificacion y botones bloqueados.

Pendiente:

- Confirmar endpoints oficiales vigentes.
- Implementar getSeed/getToken/envio/estado reales.
- Guardar `track_id` y rechazos normalizados.

## Fase 9 critica — PDF tributario / muestra impresa

Entregado:

- `lib/dte/pdf/build-dte-print-view.ts`.
- `lib/dte/pdf/build-dte-pdf.ts`.
- `docs/dte-sii/PDF_AND_PRINT_SAMPLE.md`.
- UI admin con `Ver muestra` y `Generar PDF de prueba`.

Pendiente:

- PDF417 real desde TED.
- Guardar PDF por tenant/documento.
- Enviar al cliente solo cuando el documento este permitido por flujo SII.

## Fase 10 preparada — agenda y pagos

Entregado:

- `docs/dte-sii/AGENDA_PAYMENTS_INTEGRATION_PLAN.md`.

Pendiente:

- No conectar pagos productivos hasta completar certificacion.
- Crear idempotencia por pago/reserva.
- Integrar estados DTE en agenda, pagos y clientes.
