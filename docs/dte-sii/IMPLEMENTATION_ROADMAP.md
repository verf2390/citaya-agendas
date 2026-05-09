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

## Fase 2 — XML compatible SII

Objetivo: reemplazar el XML dummy por XML compatible con especificaciones SII para los tipos iniciales.

Alcance:

- Boleta afecta tipo 39.
- Boleta exenta tipo 41.
- Factura afecta tipo 33.
- Factura exenta tipo 34.
- Nota de crédito tipo 61.
- Nota de débito tipo 56.
- Carátula, encabezado, emisor, receptor, totales y detalle.
- Validación contra schemas oficiales en ambiente de certificación.
- Manejo de errores de validación XML.

## Fase 3 — Firma real

Objetivo: firmar XML con certificado del tenant/contribuyente.

Alcance:

- Carga segura de certificado por tenant.
- Password por variable segura o secret manager.
- Canonicalización XML requerida.
- Firma del DTE y del envío cuando corresponda.
- Pruebas con certificados de certificación.
- Auditoría de acceso a secretos.

Controles mínimos:

- No exponer certificados al frontend.
- No loggear certificados, passwords ni XML firmado completo.
- Cifrado por tenant.
- Separación estricta entre certificación y producción.

## Fase 4 — CAF/folios

Objetivo: consumir folios autorizados por tenant de forma controlada.

Alcance:

- Cargar CAF por tenant de forma segura.
- Parsear rango autorizado y tipo DTE.
- Reservar folio antes de emitir.
- Marcar folio como usado solo si corresponde.
- Manejar reintentos, errores y folios agotados.
- Evitar doble consumo de folio con transacciones/idempotencia.

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
