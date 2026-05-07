# Investigación DTE/SII — Citaya

## Objetivo

Investigar y construir la base para que Citaya pueda manejar documentos tributarios electrónicos en Chile de forma segura, por etapas y sin emitir documentos reales antes de tiempo.

La fase inicial recomendada es `manual_mipyme`: Citaya registra y ordena documentos internos, pero la emisión real se realiza manualmente en SII MiPyme.

## Alcance inicial

Esta rama NO debe emitir documentos reales todavía.

Citaya NO conecta automáticamente con SII todavía, NO firma XML, NO usa CAF, NO consume folios y NO administra certificados reales.

Primero se investigará y documentará:

- Flujo MiPyme asistido
- Proveedor DTE externo
- DTE propio Citaya
- Certificado digital
- Firma electrónica XML
- CAF / folios
- Estructura XML DTE
- Boleta electrónica
- Factura afecta
- Factura exenta
- Nota de crédito
- Envío al SII
- Consulta de estado
- PDF / representación impresa
- Almacenamiento seguro
- Flujo multi-tenant

## Índice

- [MIPYME_ASSISTED_FLOW.md](./MIPYME_ASSISTED_FLOW.md): flujo inicial asistido usando SII MiPyme, con modo `manual_mipyme` y estado `pending_manual_issue`.
- [TAX_DOCUMENTS_SCHEMA.sql](./TAX_DOCUMENTS_SCHEMA.sql): esquema futuro para registrar documentos tributarios internos.
- [DTE_DECISION_MAP.md](./DTE_DECISION_MAP.md): comparacion entre MiPyme asistido, proveedor DTE externo y DTE propio Citaya.
- [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md): fases de implementacion recomendadas.
- [SECURITY_NOTES.md](./SECURITY_NOTES.md): advertencias y reglas de seguridad para certificados, claves, tenant isolation y auditoria.

## Documentos objetivo

- Boleta electrónica: tipo 39
- Factura electrónica afecta: tipo 33
- Factura electrónica exenta: tipo 34
- Nota de crédito electrónica: tipo 61

## Preguntas técnicas pendientes

1. Qué flujo exacto exige SII para emitir DTE con sistema propio.
2. Qué diferencia hay entre Portal MiPyme, facturador propio y facturador de mercado.
3. Si se puede automatizar el sistema gratuito del SII legal y técnicamente.
4. Qué certificados necesita cada cliente.
5. Cómo se obtienen y administran folios CAF.
6. Cómo se firma correctamente el XML.
7. Cómo se envía el sobre DTE al SII.
8. Cómo se consulta el estado de aceptación/rechazo.
9. Qué se debe guardar por documento.
10. Qué parte debe vivir en Citaya y qué parte debe quedar aislada por seguridad.

## Regla de seguridad

No guardar certificados reales, claves privadas ni claves SII en texto plano.

No subir certificados, CAF productivos ni passwords al repositorio.

## Modos internos sugeridos

- `manual_mipyme`: modo inicial, manual/asistido. No emite DTE real desde Citaya.
- `external_provider`: modo futuro mediante proveedor DTE/API.
- `citaya_own_dte`: modo futuro si Citaya implementa emision DTE propia.

## Estado inicial sugerido

- `pending_manual_issue`: documento interno creado y pendiente de emision manual en SII MiPyme.

## Fases

### Fase 0
Documentación e investigación.

### Fase 1
MiPyme asistido: registrar documentos internos, asociarlos a pagos/reservas y permitir marcarlos manualmente como emitidos.

### Fase 2
Proveedor DTE externo: investigar proveedores, APIs, costos y construir adapter generico.

### Fase 3
DTE propio: investigar certificado digital, firma XML, CAF, envio SII, consulta de estado, PDF tributario y seguridad.

### Fase 4
Pruebas aisladas solo si se decide avanzar con proveedor o DTE propio.

### Fase 5
Integración controlada en Citaya.

## Regla comercial

No prometer emision automatica SII hasta contar con proveedor DTE/API conectado y probado, o con un flujo DTE propio validado tecnica, tributaria y operacionalmente.
