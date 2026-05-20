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
npm run dte:sii:submit
```

Si SII devuelve `track_id` real, guardarlo como evidencia del tenant. Si no hay `track_id` real, debe quedar `null`/pendiente.

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
