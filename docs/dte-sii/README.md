# DTE/SII — Citaya

## Objetivo

Construir la base para que Citaya pueda emitir documentos tributarios electrónicos en Chile de forma segura, multi-tenant y por etapas.

El camino principal desde esta rama es `citaya_own_dte`: Citaya actúa como software/orquestador DTE para cada tenant, sin emitir todos los documentos con el RUT de Citaya.

Cada tenant debe emitir a nombre de su propia empresa/persona autorizada, con su propio RUT, certificado digital, CAF/folios y habilitación tributaria.

## Alcance inicial

Esta rama crea un laboratorio técnico aislado. NO debe emitir documentos reales todavía.

Citaya NO conecta automáticamente con SII todavía, NO firma XML real, NO usa CAF real, NO consume folios reales y NO administra certificados reales.

El laboratorio empieza a implementar:

- Validación y normalización de RUT.
- Tipos y estados internos DTE.
- Draft tributario multi-tenant.
- Generación XML DTE de laboratorio estilo SII.
- Firma XML mock/lab segura.
- CAF/folios dummy/lab en memoria.
- Cliente SII mock/controlado.
- Base para CAF/folios y PDF tributario.

## Índice

- [MIPYME_ASSISTED_FLOW.md](./MIPYME_ASSISTED_FLOW.md): flujo inicial asistido usando SII MiPyme, con modo `manual_mipyme` y estado `pending_manual_issue`.
- [TAX_DOCUMENTS_SCHEMA.sql](./TAX_DOCUMENTS_SCHEMA.sql): esquema futuro para registrar documentos tributarios internos.
- [DTE_DECISION_MAP.md](./DTE_DECISION_MAP.md): decision actual: `citaya_own_dte` como camino principal; MiPyme/proveedor como alternativas.
- [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md): fases de implementacion recomendadas.
- [SECURITY_NOTES.md](./SECURITY_NOTES.md): advertencias y reglas de seguridad para certificados, claves, tenant isolation y auditoria.
- [LAB_DTE_OWN_ENGINE.md](./LAB_DTE_OWN_ENGINE.md): laboratorio operativo aislado para DTE propio Citaya.
- [SII_FORMATS_AND_CERTIFICATION_CHECKLIST.md](./SII_FORMATS_AND_CERTIFICATION_CHECKLIST.md): schemas, estructuras y proceso SII que deben validarse antes de producción.

## Documentos objetivo

- Boleta electrónica: tipo 39
- Boleta electrónica exenta: tipo 41
- Factura electrónica afecta: tipo 33
- Factura electrónica exenta: tipo 34
- Nota de crédito electrónica: tipo 61
- Nota de débito electrónica: tipo 56

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

- `citaya_own_dte`: camino principal. Citaya genera, firma, envía, consulta y registra DTE por tenant cuando el flujo esté certificado.
- `manual_mipyme`: fallback manual temporal. Citaya registra/ordena, pero la emisión ocurre en SII MiPyme.
- `external_provider`: alternativa temporal/plan B mediante proveedor DTE/API.

## Estado inicial sugerido

- `draft`: borrador técnico del flujo propio.
- `pending_signature`: XML generado y pendiente de firma.
- `pending_manual_issue`: fallback manual si el tenant opera por MiPyme.

## Fases

### Fase 0
Investigación y documentación inicial.

### Fase 1
Laboratorio operativo DTE propio: RUT, tipos, XML dummy, firma mock, cliente SII mock.

### Fase 2
XML DTE de laboratorio estilo SII: carátula, encabezado, detalle, escape XML y validaciones mínimas. Pendiente validar contra XSD oficiales.

### Fase 2.5
Vista admin del laboratorio DTE en `/admin/facturacion`, con generación visual de XML de prueba, firma mock, CAF/folios dummy y metadata simulada.

### Fase 3
Firma XML de laboratorio con mock seguro y preparación para certificado de prueba/controlado. Pendiente firma real con canonicalización y controles de secretos.

### Fase 4
CAF/folios de laboratorio por tenant/tipo DTE, con manager en memoria. Pendiente control transaccional real.

### Fase 5
Envío ambiente certificación SII y consulta de estado.

### Fase 6
PDF tributario y representación impresa.

### Fase 7
Motor multi-tenant seguro y auditoría.

### Fase 8
Emisión automática post pago, solo después de certificación y feature flag por tenant.

## Regla comercial

No prometer emisión automática SII hasta contar con un flujo `citaya_own_dte` validado técnica, tributaria y operacionalmente, o con un proveedor DTE/API conectado y probado como plan B.
