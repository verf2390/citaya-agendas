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


## 5A. Dry-run set de boletas tipo 39 antes de CAF

Estado: `LAB / PENDIENTE / NO PRODUCTIVO`.

Antes de bajar CAF de boletas en certificacion, generar la estructura previa del set oficial y RCOF:

```bash
npm run dte:boleta:certification:dry-run
```

Salida local ignorada por git:

- `tmp/dte-certification/boleta-set-dry-run/boletas-tipo-39-set-dry-run.xml`
- `tmp/dte-certification/boleta-set-dry-run/rcof-boletas-tipo-39-dry-run.xml`
- `tmp/dte-certification/boleta-set-dry-run/metadata.json`

Este dry-run no usa CAF, no genera TED real, no firma XML, no contacta SII, no crea `track_id` y no habilita produccion. Sirve para confirmar que Citaya ya puede armar `CASO-1` a `CASO-5`, referencias `CodRef=SET` / `RazonRef=CASO-X`, sobre unico y RCOF asociado.

Solo bajar CAF de boletas cuando este dry-run este correcto, los datos reales del emisor esten listos fuera del repo y haya disponibilidad para terminar la generacion real controlada dentro de la ventana de 24 horas.


### Semaforo final PRE-CAF

El dry-run de boletas tipo 39 lee datos reales del emisor desde variables de entorno o desde el archivo externo por defecto:

```text
/home/verf/secure/dte-lab/issuer-certification.env
```

El repo no debe contener el `.env` real. Para apuntar a otra ruta externa:

```bash
DTE_BOLETA_PRE_CAF_ENV_PATH=/ruta/externa/issuer-certification.env npm run dte:boleta:certification:dry-run
```

Luego ejecutar:

```bash
npm run dte:boleta:pre-caf-check
```

Resultado permitido antes de iniciar la ventana CAF: `OK PARA BAJAR CAF`. Cualquier `NO BAJAR CAF` debe corregirse antes de descargar CAF. El checker valida que el emisor sea R&G SpA / 78195645-7 / Coquimbo, que DIVIR SpA no aparezca como emisor, que no existan placeholders demo, que CAF siga ausente, y que submit/produccion/track_id simulado esten bloqueados.


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




## XMLDSig, canonicalización y validación XSD

Estado: `LAB / PENDIENTE / NO PRODUCTIVO`. Esta ruta acerca la firma a SII certification, pero no acredita emision legal ni produccion.

XMLDSig controlado usa actualmente:

- CanonicalizationMethod: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`.
- Canonicalizacion efectiva: `xmllint --c14n` sobre XML parseado por libxml2; no canonicalizacion manual por string.
- DigestMethod: `http://www.w3.org/2000/09/xmldsig#sha1`.
- SignatureMethod: `http://www.w3.org/2000/09/xmldsig#rsa-sha1`.
- Transforms: C14N 20010315. `enveloped-signature` queda pendiente de confirmacion contra la forma final SII.
- Certificado soportado: PEM/CRT/CER externo.
- Private key soportada: PEM/KEY externa.
- PFX/P12: pendiente; se bloquea como `unsupported_certificate_format`.

La firma se construye con `SignedInfo`, `Reference URI`, `DigestValue`, `SignatureValue` y `KeyInfo/X509Data`. Luego se verifica localmente con `verifyXmlSignatureControlled`, usando el certificado o clave publica externa.

Estados importantes:

- `verified_controlled`: firma y digest verifican localmente con C14N y claves externas. No significa aprobado SII.
- `verification_failed`: la verificacion independiente fallo; `certification-submit` debe bloquear.
- `pending_real_certification`: falta canonicalizacion, archivos externos o una condicion verificable. No enviar a SII.
- `xsd_failed`: el XML final no paso XSD local. No enviar a SII.

Validar XML completo:

```bash
npm run dte:certification:validate-xml -- tmp/dte-certification/certification-envio-dte.xml
# o
DTE_CERTIFICATION_XML_PATH=/ruta/externa/al/xml npm run dte:certification:validate-xml
```

Si `xmllint` no existe, instalar `libxml2-utils` o usar un ambiente CI que lo incluya. El comando reporta `xsd_valid=true` o `xsd_valid=false` y no imprime XML completo.

`certification-submit` debe bloquear antes de seed/token/submit si XMLDSig no es `verified_controlled`, si la verificacion falla, si XSD falla, si faltan CAF/cert/key o si falta `DTE_SII_ENABLE_SUBMIT=true`.

Agenda/pagos siguen desconectados porque primero debe existir XML firmado, XSD valido, submit controlado y `track_id` real en certification por tenant. Este modulo no es productivo ni emite legalmente.


## Generar XML certification controlado

Estado: `LAB / PENDIENTE / NO PRODUCTIVO`. Este comando genera un artefacto XML local para validacion tecnica; no contacta SII, no crea `track_id` y no habilita emision legal.

Cargar ambiente LAB si corresponde:

```bash
set -a
source .env.dte-lab
set +a
```

Archivos externos requeridos, siempre fuera del repo:

```bash
DTE_CAF_PATH=/ruta/externa/citaya-dte/certification/<tenant-id>/caf.xml
DTE_CAF_PRIVATE_KEY_PATH=/ruta/externa/citaya-dte/certification/<tenant-id>/caf-private-key.pem
DTE_CERT_PATH=/ruta/externa/citaya-dte/certification/<tenant-id>/cert.pem
DTE_PRIVATE_KEY_PATH=/ruta/externa/citaya-dte/certification/<tenant-id>/private-key.pem
```

Variables opcionales del draft certification:

```bash
DTE_CERTIFICATION_FOLIO=<folio-dentro-del-rango-CAF>
DTE_CERTIFICATION_DOC_TYPE=factura_afecta
DTE_CERTIFICATION_OUTPUT_PATH=tmp/dte-certification/certification-envio-dte.xml
DTE_CERTIFICATION_ISSUE_DATE=YYYY-MM-DD
```

Si `DTE_CERTIFICATION_FOLIO` no existe, el generador usa el primer folio del rango CAF (`RNG/D`). Si el folio queda fuera del rango o el tipo DTE no coincide con el CAF, el comando bloquea con error claro.

Generar XML:

```bash
npm run dte:certification:xml
```

Salida esperada cuando todo externo existe y verifica localmente:

- `tmp/dte-certification/certification-envio-dte.xml`
- `tmp/dte-certification/certification-envio-dte.xml.sha256`
- `tmp/dte-certification/certification-envio-dte.xml.metadata.json`

La salida de consola muestra ruta, modo, folio, tipo documento, hash corto, `sii_contact=no` y `track_id_simulado=NO`. No imprime CAF completo, certificado, private key ni XML completo.

Validar XSD:

```bash
npm run dte:certification:validate-xml
npm run dte:certification:validate-xml -- tmp/dte-certification/certification-envio-dte.xml
DTE_CERTIFICATION_XML_PATH=/ruta/al/xml npm run dte:certification:validate-xml
```

Interpretacion:

- `pending_real_certification`: faltan CAF/cert/key externos, folio/tipo no coincide, FRMT no se pudo firmar o XMLDSig no queda verificable. No enviar a SII.
- `verified_controlled`: XMLDSig verifica localmente con C14N y certificado/clave publica externa. No significa aprobado SII.
- `xsd_failed`: el XML no pasa XSD local; `certification-submit` debe bloquear.
- `ready_for_submit`: solo puede considerarse despues de XMLDSig verificado, XSD valido, readiness listo, backend LAB y flag explicito.

Antes del primer submit real falta confirmar el XML final con XSD oficial, revisar ubicacion exacta de `Signature`, confirmar transforms finales con SII certification, tener endpoints reales y activar `DTE_SII_ENABLE_SUBMIT=true` solo para certification.

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
- XMLDSig: firma con PEM externo en modo controlado, canonicaliza con `xmllint --c14n`, calcula digest y verifica localmente. Sigue sin declararse aprobado SII hasta validar insercion final, transforms y XSD con un set SII certification real.
- XSD: si `xmllint` falla o no esta instalado, no hay XML listo para submit.

`pending_real_certification` significa que hay una pieza real incompleta o aun no verificable ante SII. No se debe resolver con firmas fake, `track_id` fake ni desactivando bloqueos.

Antes de submit real falta: XML final validado contra XSD/SII certification, endpoints reales de certification, tenant LAB real, Supabase LAB activo, `DTE_SII_ENABLE_SUBMIT=true`, y confirmacion de que no hay production ni agenda/pagos conectados.

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

## 10. Panel admin de facturacion

La vista `/admin/facturacion` funciona como centro de control **LAB / PENDIENTE / NO PRODUCTIVO** para el avance DTE/SII por tenant. No ejecuta comandos de shell, no hace submit real, no contacta SII y no expone secretos.

Muestra de forma segura:

- Estado global: `LAB / PENDIENTE / NO PRODUCTIVO`, SII no aprobado, produccion deshabilitada y submit bloqueado.
- Readiness visual por bloques: base tecnica, archivos externos, XML/firma y SII certification.
- Artefactos locales de certification si existen: nombre de archivo, existencia, hash SHA-256, metadata resumida, `xmlSignatureStatus`, verificacion local y XSD pendiente/true/false.
- Ultimas trazas DTE por tenant desde el repositorio configurado: ultimo documento, submission, audit log y `track_id` real si existe.
- Acciones seguras como instrucciones: `npm run dte:certification:xml`, `npm run dte:certification:validate-xml`, runbook y gap report.

No hace todavia:

- No genera XML certification desde la UI.
- No valida XSD desde la UI.
- No hace submit certification desde la UI.
- No crea ni simula `track_id`.
- No conecta agenda/pagos ni emite automaticamente.
- No muestra XML completo, CAF, certificados, private keys, tokens ni rutas privadas completas de secretos.

El endpoint de soporte es `/api/admin/dte-lab/status`. Requiere admin de tenant, usa `requireTenantAdmin`, devuelve solo resumen seguro y mantiene production deshabilitado. Si alguna evidencia no existe en el entorno actual, la UI debe mostrar `pendiente` o `unknown`, nunca inventar datos.

Submit permanece bloqueado hasta completar, como minimo: CAF real externo por tenant, llave CAF externa, certificado y private key externos, XML certification generado, XMLDSig `verified_controlled`, verificacion local OK, XSD valido, endpoints SII certification configurados, `DTE_SII_ENABLE_SUBMIT=true`, Supabase LAB con persistencia validada y autorizacion operativa para primer envio real a certification.
