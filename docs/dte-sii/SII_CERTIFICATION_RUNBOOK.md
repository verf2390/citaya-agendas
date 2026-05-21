# SII Certification Runbook

Estado obligatorio: `LAB / PENDIENTE / NO PRODUCTIVO`.

Citaya opera como `citaya_own_dte`: cada tenant emite con su propio RUT, certificado, CAF, folios y autorizacion SII. Citaya es software/orquestador DTE, no emisor unico para todos los tenants.

## 1. Cargar ambiente LAB

Usar solo el Supabase LAB/certification separado, nunca production.

```bash
set -a
source .env.dte-lab
set +a
```

El archivo `.env.dte-lab` no debe commitearse. No imprimir variables con `env`, `set`, `printenv` ni logs de depuracion.

Variables LAB esperadas para persistencia:

```bash
DTE_PERSISTENCE_BACKEND=supabase
DTE_MODE=lab
DTE_SII_ENV=certification
DTE_SMOKE_TENANT_ID=<uuid-tenant-lab>
```

## 2. Variables para certificacion real controlada

Para pasar de dry-run a certificacion real controlada, configurar fuera del repo:

```bash
DTE_MODE=certification
DTE_SII_ENV=certification
DTE_SII_SEED_URL=<endpoint certification SII>
DTE_SII_TOKEN_URL=<endpoint certification SII>
DTE_SII_SUBMIT_URL=<endpoint certification SII>
DTE_SII_STATUS_URL=<endpoint certification SII>
DTE_CAF_PATH=/ruta/externa/citaya-dte/certification/caf.xml
DTE_CAF_PRIVATE_KEY_PATH=/ruta/externa/citaya-dte/certification/caf-private-key.pem
DTE_CERT_PATH=/ruta/externa/citaya-dte/certification/cert.pem
DTE_PRIVATE_KEY_PATH=/ruta/externa/citaya-dte/certification/private-key.pem
```

Opcional para submit real controlado, solo cuando CAF/certificado/endpoints ya esten validados:

```bash
DTE_SII_ENABLE_SUBMIT=true
SII_RUT_EMPRESA=<rut tenant emisor>
SII_RUT_USUARIO=<rut usuario autorizado>
```

## 3. Ubicacion de CAF/certificados/llaves

Guardar CAF, certificados y llaves privadas fuera de `/home/verf/apps/citaya-agendas`.

Ejemplo seguro:

```text
~/secure/citaya-dte/certification/<tenant-id>/caf.xml
~/secure/citaya-dte/certification/<tenant-id>/caf-private-key.pem
~/secure/citaya-dte/certification/<tenant-id>/cert.pem
~/secure/citaya-dte/certification/<tenant-id>/private-key.pem
```

No guardar secretos en `docs/`, `lib/`, `app/`, `scripts/`, `tmp/` ni dentro del repo.

## 4. Readiness

Ejecutar:

```bash
npm run dte:certification:readiness
```

Estados esperados:

- `ready`: variables y archivos externos estan presentes para certification controlada.
- `pending_config`: faltan endpoints o variables todavia no obligatorias en lab/dry-run.
- `missing_external_file`: una ruta externa requerida no existe o apunta a una ubicacion insegura.
- `blocked_production`: `DTE_MODE=production` o `DTE_SII_ENV=production`; no avanzar.

El comando no imprime secretos, tokens, certificados ni llaves privadas.

## 5. Dry-run seguro

```bash
npm run dte:sii:dry-run:trace
npm run dte:persistence:check
npm run dte:persistence:trace
```

Dry-run no contacta SII, no genera `track_id` simulado y deja trazabilidad no productiva en Supabase LAB si `DTE_PERSISTENCE_BACKEND=supabase` esta activo.

## 6. Certification real controlada

Solo cuando readiness este `ready` y las credenciales externas sean reales del tenant:

```bash
DTE_MODE=certification npm run dte:certification
npm run dte:certification:readiness
npm run dte:sii:dry-run:trace
```

Luego, para submit real al ambiente de certificacion SII, usar solamente LAB/certification y mantener `DTE_SII_ENV=certification`. El submit sigue bloqueado salvo que `DTE_SII_ENABLE_SUBMIT=true` este definido explicitamente.

```bash
npm run dte:certification:submit
```

El comando nuevo reemplaza el submit manual de smoke para el primer contacto controlado. Si SII devuelve `track_id` real, se guarda como evidencia del tenant. Si no hay `track_id` real, debe quedar `null`/pendiente.



## XML real, CAF, TED, FRMT y XMLDSig

Estado: `LAB / PENDIENTE / NO PRODUCTIVO`. Esta seccion prepara XML certification controlado; no habilita emision legal ni production.

Archivos externos requeridos:

- `DTE_CAF_PATH`: CAF XML real del tenant, fuera del repo.
- `DTE_CAF_PRIVATE_KEY_PATH`: llave privada asociada al CAF en PEM/KEY externo para FRMT.
- `DTE_CERT_PATH`: certificado digital del tenant en PEM/CRT/CER externo.
- `DTE_PRIVATE_KEY_PATH`: llave privada del certificado en PEM/KEY externo.
- Opcional `DTE_PUBLIC_CERT_PATH`: certificado publico PEM/CRT/CER si difiere de `DTE_CERT_PATH`.

Formatos soportados actualmente:

- CAF: `.xml`.
- Llaves privadas: `.pem` o `.key` sin imprimir ni persistir contenido.
- Certificados: `.pem`, `.crt` o `.cer`.
- PFX/P12: no soportado todavia. Si el tenant entrega PFX/P12, extraer PEM fuera del repo o implementar soporte tecnico antes de usarlo.

Ubicacion recomendada:

```text
/home/verf/secure/citaya-dte/certification/<tenant-id>/caf.xml
/home/verf/secure/citaya-dte/certification/<tenant-id>/caf-private-key.pem
/home/verf/secure/citaya-dte/certification/<tenant-id>/cert.pem
/home/verf/secure/citaya-dte/certification/<tenant-id>/private-key.pem
```

Ejecucion segura:

```bash
npm run dte:certification:readiness
DTE_MODE=certification npm run dte:certification
node scripts/dte/validate-xsd.mjs tmp/dte-certification/certification-envio-dte.xml docs/dte-sii/xsd/EnvioDTE_v10.xsd
npm run dte:certification:submit
```

Interpretacion:

- CAF real externo: se parsea y se valida contra RUT/tipo/folio del draft; no se guarda CAF completo en DB.
- TED: se construye con `DD` y CAF embebido.
- FRMT: se firma con `RSA-SHA1` usando la llave CAF externa. Si falta llave o formato, queda `pending_real_certification`/`failed`.
- XMLDSig: actualmente firma con PEM externo en modo controlado, pero no se declara valido SII porque falta canonicalizacion robusta/insercion final validada. Por eso el submit debe seguir bloqueando si aparecen warnings de XMLDSig/canonicalizacion.
- XSD: si `xmllint` falla o no esta instalado, no hay XML listo para submit.

`pending_real_certification` significa que hay una pieza real incompleta o aun no verificable ante SII. No se debe resolver con firmas fake, `track_id` fake ni desactivando bloqueos.

Antes de submit real falta: XMLDSig canonicalizado y validado contra XSD/SII, endpoints reales de certification, tenant LAB real, Supabase LAB activo, `DTE_SII_ENABLE_SUBMIT=true`, y confirmacion de que no hay production ni agenda/pagos conectados.

No hacer todavia: no commitear CAF/cert/key, no imprimir XML completo con datos sensibles, no usar `DTE_SII_ENV=production`, no conectar pagos/citas, no decir que Citaya factura legalmente.

## Primer submit real controlado en certification

Estado actual obligatorio: `LAB / PENDIENTE / NO PRODUCTIVO`. Este flujo no activa produccion, no habilita emision legal y no conecta agenda/pagos.

Variables requeridas antes de intentar el comando controlado:

```bash
set -a
source .env.dte-lab
set +a

DTE_PERSISTENCE_BACKEND=supabase
DTE_MODE=certification
DTE_SII_ENV=certification
DTE_SMOKE_TENANT_ID=<uuid-tenant-lab>
NEXT_PUBLIC_SUPABASE_URL=<url-proyecto-lab>
SUPABASE_SERVICE_ROLE_KEY=<service-role-lab>
DTE_SII_SEED_URL=<endpoint-seed-certification>
DTE_SII_TOKEN_URL=<endpoint-token-certification>
DTE_SII_SUBMIT_URL=<endpoint-submit-certification>
DTE_SII_STATUS_URL=<endpoint-status-certification>
DTE_CAF_PATH=/home/<user>/secure/citaya-dte/certification/<tenant-id>/caf.xml
DTE_CAF_PRIVATE_KEY_PATH=/home/<user>/secure/citaya-dte/certification/<tenant-id>/caf-private-key.pem
DTE_CERT_PATH=/home/<user>/secure/citaya-dte/certification/<tenant-id>/cert.pem
DTE_PRIVATE_KEY_PATH=/home/<user>/secure/citaya-dte/certification/<tenant-id>/private-key.pem
DTE_SII_ENABLE_SUBMIT=true
```

Rutas externas seguras: usar un directorio fuera de `/home/verf/apps/citaya-agendas`, por ejemplo `/home/verf/secure/citaya-dte/certification/<tenant-id>/`. No guardar CAF completo, certificados, llaves privadas, tokens ni passwords dentro del repo.

Ejecucion recomendada:

```bash
npm run dte:certification:readiness
npm run dte:certification:submit
```

El comando `dte:certification:submit` imprime un resumen seguro: modo, ambiente, backend, presencia de endpoints, presencia/existencia de archivos externos, si estan fuera del repo, si submit esta habilitado y `track_id_simulado=NO`. No imprime `SUPABASE_SERVICE_ROLE_KEY`, tokens, private keys, contenido CAF, certificados ni XML completo.

Bloqueos esperados:

- Sin `DTE_SII_ENABLE_SUBMIT=true`: `blocked_submit`; no contacta SII.
- Con `DTE_MODE=production` o `DTE_SII_ENV=production`: `blocked_production`; no contacta SII.
- Sin Supabase LAB o sin `DTE_SMOKE_TENANT_ID`: `pending_config`/`blocked_submit`; no contacta SII.
- Con archivos faltantes o dentro del repo: `pending_real_certification`/`blocked_submit`; no contacta SII.
- Si readiness no esta `ready`: `pending_config` o `pending_real_certification`; no contacta SII.
- Si XML/firma aun no son marcables como reales ante SII: `pending_real_certification`; se guarda trazabilidad LAB si ya se creo documento, pero no se hace submit.

Cuando SII entregue `track_id` real, se guarda en `tax_document_sii_submissions.track_id`. Si SII no entrega `track_id`, queda `null`; no se inventa ni se simula. Solo con `track_id` real el comando consulta status y guarda `checked_at`, respuesta redactada, status history y audit log.

Despues de ejecutar, revisar en Supabase LAB:

- `tax_documents`
- `tax_document_sii_submissions`
- `tax_document_status_history`
- `tax_document_audit_log`

Interpretacion de estados:

- `ready`: configuracion local lista para el siguiente paso.
- `pending_real_certification`: falta una pieza real o la firma/XML aun no deben enviarse a SII.
- `blocked_submit`: falta flag explicito, backend Supabase LAB o condicion de seguridad.
- `submitted`: hubo intento real a SII certification y se persistio respuesta redactada.
- `accepted`/`rejected`/`failed`/`pending`: resultado de status real cuando existe `track_id`.

Que NO hacer todavia: no usar production, no tocar Supabase productivo, no conectar agenda/pagos, no emitir automaticamente desde citas/pagos, no guardar secretos en repo, no imprimir tokens completos, no guardar tokens completos y no declarar facturacion legal hasta aprobacion SII real por tenant.

## 7. Revisar Supabase LAB

Despues de dry-run o submit controlado, revisar por tenant:

- `tax_documents`
- `tax_document_sii_submissions`
- `tax_document_status_history`
- `tax_document_audit_log`

Confirmar:

- `environment` en `lab` o `certification`, nunca `production`.
- `track_id` solo aparece si vino de respuesta real SII.
- `raw_response_redacted` no contiene tokens completos ni secretos.
- `request_xml_sha256`/`response_sha256` existen cuando corresponde.

## 8. Rollback logico

Si algo falla:

```bash
DTE_PERSISTENCE_BACKEND=memory
```

No borrar tablas inmediatamente. Revisar logs, policies, constraints y trazas LAB. Corregir en repo y reaplicar solo en LAB/certification.

## 9. Que NO hacer todavia

- No activar produccion.
- No usar `DTE_SII_ENV=production`.
- No conectar agenda/pagos.
- No hacer emision legal.
- No guardar CAF/certificados/llaves/tokens en repo.
- No simular `track_id`.
- No decir que facturacion esta lista para produccion.
