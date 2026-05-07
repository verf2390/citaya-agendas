# DTE/SII Security Notes — Citaya

## Estado actual

Citaya no implementa firma real DTE todavia.

No se deben guardar certificados reales, claves privadas, CAF productivos ni credenciales SII en el repositorio o en texto plano. La fase inicial es `manual_mipyme`, con documentos internos en estado `pending_manual_issue`.

## Reglas de secretos

- No guardar certificados reales en texto plano.
- No subir certificados al repositorio.
- No commitear claves privadas.
- No commitear passwords de certificados.
- No commitear CAF productivos.
- No guardar credenciales SII en archivos locales versionados.
- No enviar certificados o claves privadas a n8n, logs, emails o herramientas de soporte.

## Almacenamiento futuro de certificados

Si algun dia Citaya almacena certificados por tenant:

- Cifrar certificados por tenant.
- Separar el password del certificado.
- Usar variables seguras o secret manager.
- Rotar secretos cuando un usuario admin cambia o deja el negocio.
- Registrar version del secreto sin exponer el valor.
- Restringir lectura a servicios backend estrictamente necesarios.
- Evitar que el frontend reciba certificados, passwords o claves privadas.

## Multi-tenant

- Un tenant nunca debe ver documentos, certificados, folios, CAF ni datos tributarios de otro tenant.
- Toda consulta debe filtrar por `tenant_id`.
- Toda accion de emision debe validar tenant antes de ejecutarse.
- Los logs deben incluir `tenant_id` pero no secretos.
- Los IDs externos de proveedor deben estar asociados a tenant y documento.

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

## Firma real

No implementar firma real todavia.

Antes de construir firma XML real se requiere:

- Investigacion completa de schemas SII.
- Ambiente de prueba aislado.
- Certificados de prueba o estrategia segura.
- Revision de seguridad.
- Revision legal/tributaria.
- Decision explicita entre proveedor DTE y DTE propio.
