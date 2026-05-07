# DTE/SII Decision Map — Citaya

## Objetivo

Definir las alternativas para avanzar con documentos tributarios electronicos en Citaya sin prometer emision automatica SII antes de tener una integracion validada.

Citaya NO emite DTE real todavia. No firma XML, no usa CAF, no consume folios, no envia documentos al SII y no administra certificados reales.

## Alternativas

### 1. MiPyme asistido SII

Modo interno sugerido: `manual_mipyme`

Citaya registra el documento tributario interno y guia al administrador para emitir manualmente desde el Sistema de Facturacion Gratuito del SII / MiPyme.

Ventajas:

- Menor riesgo tecnico y legal en la primera etapa.
- No requiere certificados digitales dentro de Citaya.
- No requiere firma XML, CAF ni envio automatico al SII.
- Permite ordenar pagos, reservas, folios y comprobantes desde el panel.
- Entrega valor comercial rapido para clientes que necesitan trazabilidad tributaria.

Desventajas:

- No hay emision automatica real desde Citaya.
- El administrador debe entrar al portal del SII y emitir manualmente.
- El folio, PDF y fecha de emision se registran manualmente.
- Puede requerir capacitacion operativa para cada negocio.

Uso recomendado:

- Fase inicial para todos los tenants que necesiten orden tributario sin automatizacion.
- Estado inicial del documento: `pending_manual_issue`.

### 2. Proveedor DTE externo

Modo futuro sugerido: `external_provider`

Citaya se integra con una API de un proveedor DTE autorizado o de mercado para emitir boletas, facturas y otros documentos.

Ventajas:

- Reduce complejidad de certificacion, firma XML, CAF y comunicacion SII.
- Acelera la llegada a emision automatica real.
- Permite delegar cambios normativos y manejo de errores tributarios al proveedor.
- Facilita soporte para PDF, XML, folios y estados.

Desventajas:

- Costo por documento, mensualidad o setup.
- Dependencia comercial y tecnica de un tercero.
- Riesgo de lock-in si Citaya se acopla a un proveedor especifico.
- Requiere revisar SLA, seguridad, soporte multi-tenant y exportacion de datos.

Uso recomendado:

- Segunda fase, despues de validar demanda real.
- Implementar con adapter generico para no acoplar Citaya a un solo proveedor.

### 3. DTE propio Citaya

Modo futuro sugerido: `citaya_own_dte`

Citaya implementa el flujo completo de emision DTE: certificado digital, firma XML, CAF/folios, XML DTE, envio SII, consulta de estado, PDF tributario y auditoria.

Ventajas:

- Control total del flujo tributario.
- Menor dependencia de proveedores externos a largo plazo.
- Posibilidad de optimizar costos unitarios si el volumen justifica la inversion.
- Flexibilidad para UX, auditoria y automatizaciones propias.

Desventajas:

- Mayor riesgo tecnico, legal y operativo.
- Requiere dominio profundo de schemas DTE, firma XML, CAF, folios y APIs SII.
- Requiere manejo seguro de certificados y claves privadas por tenant.
- Requiere certificacion/pruebas, monitoreo, soporte y actualizaciones normativas.
- Alto costo de mantenimiento.

Uso recomendado:

- Solo como fase avanzada, cuando exista volumen, equipo tecnico y controles de seguridad suficientes.

## Decision recomendada por fases

1. `manual_mipyme`
   - Registrar documentos internos.
   - Asociarlos a pagos, reservas y clientes.
   - Usar estado inicial `pending_manual_issue`.
   - Permitir registrar folio, fecha, monto, tipo de documento y PDF opcional.
   - No emitir DTE real.

2. `external_provider`
   - Investigar proveedores DTE.
   - Comparar costos, soporte, API y seguridad.
   - Construir adapter generico.
   - Emitir automaticamente solo despues de pruebas controladas.

3. `citaya_own_dte`
   - Investigar e implementar firma XML, CAF, folios, envio SII y auditoria.
   - Avanzar solo con ambiente de prueba y controles estrictos.

## Estados internos sugeridos

Estados para fase asistida:

- `pending_manual_issue`: documento creado internamente, falta emitir en SII MiPyme.
- `issued_manual`: documento emitido manualmente y registrado en Citaya.
- `cancelled_manual`: documento anulado o descartado manualmente.
- `error`: error operativo o inconsistencia.

Estados futuros para proveedor/API:

- `pending_provider_issue`: listo para enviar a proveedor.
- `provider_processing`: proveedor procesando.
- `issued`: emitido correctamente.
- `rejected`: rechazado por proveedor o SII.
- `cancelled`: anulado.

Estados futuros para DTE propio:

- `draft`: borrador tecnico.
- `signed`: XML firmado.
- `sent_to_sii`: enviado al SII.
- `accepted`: aceptado.
- `rejected`: rechazado.

## Regla comercial

Citaya no debe prometer emision automatica SII hasta tener:

- Un proveedor DTE/API conectado, probado y habilitado para el tenant, o
- Un flujo DTE propio validado con certificado, CAF, firma XML, envio SII, consulta de estado, auditoria y seguridad multi-tenant.

Mientras el modo sea `manual_mipyme`, la comunicacion comercial debe decir "facturacion asistida" o "registro y seguimiento tributario", no "emision automatica".
