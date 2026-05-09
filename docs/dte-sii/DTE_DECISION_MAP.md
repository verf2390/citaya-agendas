# DTE/SII Decision Map — Citaya

## Objetivo

Definir la decisión actual para avanzar con documentos tributarios electrónicos en Citaya sin prometer emisión automática SII antes de tener certificación, seguridad y pruebas controladas.

Citaya NO emite DTE real todavía. El camino principal ahora es `citaya_own_dte`, pero la primera implementación es un laboratorio aislado que no firma XML real, no usa CAF real, no consume folios reales, no envía documentos al SII y no administra certificados reales.

## Decisión actual

Camino principal: `citaya_own_dte`.

Citaya debe actuar como software/orquestador DTE para cada tenant:

- Generar XML DTE.
- Firmar XML con certificado del contribuyente/tenant.
- Usar CAF y folios del tenant.
- Enviar al SII.
- Consultar estado.
- Guardar folio, XML, PDF, track id y estado.
- Asociar documento a tenant, reserva, pago y cliente.
- Mantener separación estricta multi-tenant.

Alternativas secundarias:

- `manual_mipyme`: fallback manual temporal para tenants que aún no estén habilitados en DTE propio.
- `external_provider`: alternativa temporal/plan B si el costo técnico o tributario de DTE propio bloquea producción.

## Alternativas

### 1. MiPyme asistido SII

Modo interno sugerido: `manual_mipyme`

Citaya registra el documento tributario interno y guía al administrador para emitir manualmente desde el Sistema de Facturación Gratuito del SII / MiPyme.

Ventajas:

- Menor riesgo técnico y legal en la primera etapa.
- No requiere certificados digitales dentro de Citaya.
- No requiere firma XML, CAF ni envío automático al SII.
- Permite ordenar pagos, reservas, folios y comprobantes desde el panel.
- Entrega valor comercial rápido para clientes que necesitan trazabilidad tributaria.

Desventajas:

- No hay emisión automática real desde Citaya.
- El administrador debe entrar al portal del SII y emitir manualmente.
- El folio, PDF y fecha de emisión se registran manualmente.
- Puede requerir capacitación operativa para cada negocio.

Uso recomendado:

- Fallback temporal para tenants que necesiten orden tributario sin automatización mientras se certifica `citaya_own_dte`.
- Estado inicial del documento: `pending_manual_issue`.

### 2. Proveedor DTE externo

Modo futuro sugerido: `external_provider`

Citaya se integra con una API de un proveedor DTE autorizado o de mercado para emitir boletas, facturas y otros documentos.

Ventajas:

- Reduce complejidad de certificación, firma XML, CAF y comunicación SII.
- Acelera la llegada a emisión automática real.
- Permite delegar cambios normativos y manejo de errores tributarios al proveedor.
- Facilita soporte para PDF, XML, folios y estados.

Desventajas:

- Costo por documento, mensualidad o setup.
- Dependencia comercial y técnica de un tercero.
- Riesgo de lock-in si Citaya se acopla a un proveedor específico.
- Requiere revisar SLA, seguridad, soporte multi-tenant y exportación de datos.

Uso recomendado:

- Plan B temporal si certificación, firma real, CAF/folios o soporte operativo bloquean `citaya_own_dte`.
- Implementar con adapter genérico para no acoplar Citaya a un solo proveedor.

### 3. DTE propio Citaya

Modo principal sugerido: `citaya_own_dte`

Citaya implementa el flujo completo de emisión DTE: certificado digital, firma XML, CAF/folios, XML DTE, envío SII, consulta de estado, PDF tributario y auditoría.

Ventajas:

- Control total del flujo tributario.
- Menor dependencia de proveedores externos a largo plazo.
- Posibilidad de optimizar costos unitarios si el volumen justifica la inversión.
- Flexibilidad para UX, auditoría y automatizaciones propias.

Desventajas:

- Mayor riesgo técnico, legal y operativo.
- Requiere dominio profundo de schemas DTE, firma XML, CAF, folios y APIs SII.
- Requiere manejo seguro de certificados y claves privadas por tenant.
- Requiere certificación/pruebas, monitoreo, soporte y actualizaciones normativas.
- Alto costo de mantenimiento.

Uso recomendado:

- Camino principal desde el laboratorio técnico.
- Mantener aislado hasta completar XML real, firma, CAF/folios, certificación SII y auditoría multi-tenant.

## Decisión recomendada por fases

1. `citaya_own_dte`
   - Crear laboratorio aislado.
   - Validar RUT.
   - Generar XML dummy no productivo.
   - Simular firma, envío y estado SII.
   - Avanzar hacia XML real y certificación.

2. `external_provider`
   - Mantener como alternativa temporal o plan B.
   - Implementar con adapter genérico para no acoplar Citaya a un solo proveedor.
   - Usar solo si certificación, firma real, CAF/folios o soporte operativo bloquean `citaya_own_dte`.

3. `manual_mipyme`
   - Mantener como fallback manual temporal.
   - Registrar documentos internos.
   - Asociarlos a pagos, reservas y clientes.
   - Usar estado inicial `pending_manual_issue`.
   - No emitir DTE real desde Citaya.

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

- `draft`: borrador técnico.
- `pending_signature`: XML generado y pendiente de firma.
- `signed`: XML firmado.
- `pending_send`: firmado y pendiente de envío.
- `sent_to_sii`: enviado al SII.
- `accepted`: aceptado.
- `rejected`: rechazado.
- `cancelled`: cancelado.
- `error`: error técnico u operativo.

## Regla comercial

Citaya no debe prometer emisión automática SII hasta tener:

- Un flujo DTE propio validado con certificado, CAF, firma XML, envío SII, consulta de estado, auditoría y seguridad multi-tenant, o
- Un proveedor DTE/API conectado, probado y habilitado para el tenant como plan B.

Mientras el modo sea `manual_mipyme`, la comunicación comercial debe decir "facturación asistida" o "registro y seguimiento tributario", no "emisión automática".
