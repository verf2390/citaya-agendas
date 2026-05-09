# DTE/SII Security Notes — Citaya

## Estado actual

Citaya está avanzando hacia `citaya_own_dte`, pero el código actual es un laboratorio aislado.

El laboratorio puede validar RUT, generar XML estilo SII, simular firma, simular CAF/folios y simular envío/estado SII. No implementa firma real DTE todavía y no debe conectarse a producción.

No se deben guardar certificados reales, claves privadas, CAF productivos ni credenciales SII en el repositorio o en texto plano. `manual_mipyme` queda como fallback manual temporal con documentos internos en estado `pending_manual_issue`.

## Reglas de secretos

- No guardar certificados reales en texto plano.
- No subir certificados al repositorio.
- No commitear claves privadas.
- No commitear passwords de certificados.
- No commitear CAF productivos.
- No subir `.p12`, `.pfx`, `.pem`, `.key` reales.
- No guardar credenciales SII en archivos locales versionados.
- No enviar certificados o claves privadas a n8n, logs, emails o herramientas de soporte.
- No usar correos, RUT, passwords o rutas de certificados hardcodeadas en código TypeScript productivo.

## Almacenamiento futuro de certificados

Si algun dia Citaya almacena certificados por tenant:

- Cifrar certificados por tenant.
- Separar el password del certificado.
- Usar variables seguras o secret manager.
- Referenciar secretos por `tenant_id` y nombre/version, nunca por valor plano.
- Rotar secretos cuando un usuario admin cambia o deja el negocio.
- Registrar version del secreto sin exponer el valor.
- Restringir lectura a servicios backend estrictamente necesarios.
- Evitar que el frontend reciba certificados, passwords o claves privadas.
- Separar ambiente certificación y producción para certificados, CAF y tokens.
- Auditar cada uso futuro de certificado por tenant, documento, ambiente, usuario/servicio y resultado.
- Redactar private keys, passwords y certificados antes de cualquier log o error.

## Multi-tenant

- Un tenant nunca debe ver documentos, certificados, folios, CAF ni datos tributarios de otro tenant.
- Toda consulta debe filtrar por `tenant_id`.
- Toda accion de emision debe validar tenant antes de ejecutarse.
- Los logs deben incluir `tenant_id` pero no secretos.
- Los IDs externos de proveedor deben estar asociados a tenant y documento.
- `tenant_members` no debe mezclarse con credenciales tributarias.
- `platform_admins` puede operar soporte, pero toda lectura/uso de secretos DTE debe auditarse.

## Auditoria

Toda emision o marca manual debe registrar:

- Quien emitio o marco como emitido.
- Tenant.
- Documento tributario.
- Fecha y hora.
- Modo de emision (`manual_mipyme`, `external_provider`, `citaya_own_dte`).
- Estado anterior y nuevo.
- Folio, si existe.
- Error o rechazo, si existe.
- Ambiente (`certification` o `production`).
- Origen de la acción (`admin`, `support`, `automation`, `lab`).

## Validaciones tributarias

Antes de emitir o registrar documentos:

- Validar RUT emisor.
- Validar RUT receptor cuando sea factura.
- Validar razon social, giro, comuna, direccion y email tributario cuando corresponda.
- Validar monto, tipo de documento y asociacion a pago/reserva.
- Evitar documentos duplicados para el mismo pago si no hay flujo de anulacion/nota de credito.

## Logs y observabilidad

- No registrar XML completo con datos sensibles en logs generales.
- No registrar certificados, passwords, claves privadas ni CAF.
- Registrar errores de proveedor o SII de forma resumida.
- Guardar trazabilidad suficiente para soporte y auditoria.
- Redactar tokens, seeds, track ids sensibles si SII los considera privados.
- Evitar logs de payloads completos en webhooks o jobs automáticos.

## Firma real

No implementar firma real en producción todavía.

Antes de construir firma XML real se requiere:

- Investigacion completa de schemas SII.
- Descargar y validar contra `xmldsignature_v10.xsd`.
- Validar también contra `DTE_v10.xsd`, `EnvioDTE_v10.xsd` y `SiiTypes_v10.xsd`.
- Ambiente de prueba aislado.
- Certificados de prueba o estrategia segura.
- Revision de seguridad.
- Revision legal/tributaria.
- Decisión explícita de activar `citaya_own_dte` por tenant y ambiente.

## CAF y folios

- CAF reales nunca van al repositorio.
- CAF por tenant debe guardarse cifrado o en storage privado con controles estrictos.
- El consumo de folios debe ser transaccional e idempotente.
- Cada folio usado debe quedar asociado a `tenant_id`, tipo DTE y documento tributario.
- Un folio de un tenant nunca puede ser utilizado por otro tenant.
- El control real de folios debe evitar doble emisión con bloqueo transaccional o una estrategia equivalente.
- El consumo debe auditar reserva, uso, liberación, anulación, usuario/servicio y documento asociado.
- La reserva de folios debe separarse por tenant y tipo de documento.
- Los CAF reales deben tener control de vigencia, rango, tipo DTE y ambiente.
- La concurrencia debe probarse antes de conectar pagos, reservas o emisión automática.
