# DTE/SII Implementation Roadmap — Citaya

## Principios

- Citaya no emite DTE real todavia.
- El modo inicial es `manual_mipyme`.
- El estado inicial de un documento interno es `pending_manual_issue`.
- MiPyme asistido es una fase manual/asistida, no una integracion automatica.
- Proveedor externo y DTE propio son fases futuras.
- No se debe tocar el flujo de pagos, reservas o campanas para emitir DTE real hasta que exista una fase validada.

## Fase 1 — MiPyme asistido

Objetivo: dejar trazabilidad tributaria interna sin emitir DTE real desde Citaya.

Alcance:

- Registrar documentos tributarios internos.
- Asociar documentos a pagos y reservas.
- Asociar documentos a clientes cuando exista `customer_id`.
- Crear documentos con estado `pending_manual_issue`.
- Mostrar documentos pendientes en el admin.
- Agregar boton visual "Emitir en SII MiPyme".
- Agregar boton "Marcar como emitido".
- Guardar folio.
- Guardar fecha de emision.
- Guardar tipo de documento.
- Guardar monto.
- Guardar PDF o comprobante opcional.
- Registrar quien marco el documento como emitido y cuando.

Fuera de alcance:

- No emitir DTE real.
- No firmar XML.
- No solicitar ni consumir CAF.
- No enviar documentos al SII.
- No consultar estado automatico del SII.
- No guardar certificados digitales reales.

Estados principales:

- `pending_manual_issue`
- `issued_manual`
- `cancelled_manual`
- `error`

UX esperada:

- En `/admin/pagos`, mostrar si el pago tiene documento tributario asociado.
- En `/admin/facturacion`, listar documentos pendientes de emision manual.
- El boton "Emitir en SII MiPyme" puede abrir una guia o enlace operativo, pero no automatiza el portal del SII.
- El boton "Marcar como emitido" permite registrar folio, fecha y PDF opcional.

## Fase 2 — Proveedor DTE

Objetivo: preparar emision automatica real mediante una API externa sin acoplar Citaya a un solo proveedor.

Investigacion:

- Identificar proveedores DTE adecuados para SaaS multi-tenant.
- Comparar costos por documento, mensualidad, setup y soporte.
- Revisar limites de API, SLA, ambientes de prueba y documentacion.
- Revisar seguridad para credenciales por tenant.
- Revisar soporte para boleta, factura afecta, factura exenta y nota de credito.
- Revisar manejo de PDF, XML, folio, track id y estados.

Diseno tecnico:

- Definir campos requeridos por proveedor.
- Definir contrato interno de adapter generico.
- Crear interfaz de proveedor DTE sin nombres comerciales en el dominio central.
- Mapear estados del proveedor a estados internos de Citaya.
- Registrar request/response resumido para auditoria sin guardar secretos.
- Aislar credenciales por tenant.

Adapter generico sugerido:

- `createDocument`
- `getDocumentStatus`
- `cancelDocument` o `createCreditNote`
- `getPdfUrl`
- `getXmlUrl`

Regla:

- No acoplar Citaya a un solo proveedor.
- Toda integracion debe pasar por un adapter.

## Fase 3 — DTE propio

Objetivo: investigar si Citaya puede implementar emision DTE completa con sistema propio.

Investigacion requerida:

- Certificado digital por contribuyente.
- Password y administracion segura del certificado.
- Firma XML.
- CAF / folios autorizados.
- Estructura XML DTE.
- Sobre de envio SII.
- Envio SII.
- Consulta de estado.
- Respuesta de aceptacion/rechazo.
- PDF tributario / representacion impresa.
- Timbre PDF417 si aplica.
- Notas de credito.
- Seguridad multi-tenant.
- Auditoria de emision.

Riesgos:

- Manejo de claves privadas.
- Aislamiento por tenant.
- Cambios normativos.
- Rechazos SII.
- Certificacion y pruebas.
- Soporte operativo.

Controles minimos antes de implementar:

- Secret manager o cifrado fuerte por tenant.
- Separacion de password del certificado.
- Auditoria de quien emite, cuando y desde que tenant.
- Validacion estricta de RUT y datos tributarios.
- Ambientes separados para prueba y produccion.
- Revision legal/tributaria antes de activar emision real.

Resultado esperado:

- Documento tecnico de viabilidad.
- Prototipo aislado fuera del flujo productivo.
- Decision explicita entre seguir con proveedor DTE o invertir en DTE propio.
