# Runbook para cargar archivos DTE reales externos

Estado obligatorio durante este runbook: `LAB / PENDIENTE / NO PRODUCTIVO`.

Codex no puede inventar CAF, certificado digital, llaves privadas, aprobacion SII ni `track_id`. Este flujo solo prepara y valida archivos reales cuando el responsable los obtenga desde SII/certificado digital.

## Que necesitas conseguir

- Certificado digital real del contribuyente o representante autorizado.
- Acceso SII al ambiente de certificacion/prueba que corresponda.
- CAF real de folios para el tipo DTE que se quiere probar.
- Llave privada asociada al CAF si viene separada o exportable segun el flujo SII/proveedor.
- Private key del certificado digital en PEM.

No usar archivos inventados para pasar pruebas. Si falta una pieza, el sistema debe bloquear.

## Donde guardar cada archivo

Guardar todo fuera del repo:

```text
/home/verf/secure/dte-lab/
  caf/
    caf-certification.xml
  certs/
    certificado-digital.pem
  private/
    caf-private-key.pem
    certificado-private-key.pem
```

Rutas esperadas por `.env.dte-lab`:

```bash
DTE_CAF_PATH=/home/verf/secure/dte-lab/caf/caf-certification.xml
DTE_CAF_PRIVATE_KEY_PATH=/home/verf/secure/dte-lab/private/caf-private-key.pem
DTE_CERT_PATH=/home/verf/secure/dte-lab/certs/certificado-digital.pem
DTE_PRIVATE_KEY_PATH=/home/verf/secure/dte-lab/private/certificado-private-key.pem
```

Permisos recomendados:

```bash
chmod 700 /home/verf/secure/dte-lab
chmod 700 /home/verf/secure/dte-lab/private
chmod 600 /home/verf/secure/dte-lab/private/caf-private-key.pem
chmod 600 /home/verf/secure/dte-lab/private/certificado-private-key.pem
chmod 640 /home/verf/secure/dte-lab/caf/caf-certification.xml
chmod 640 /home/verf/secure/dte-lab/certs/certificado-digital.pem
```

## Convertir certificado P12/PFX a PEM

Si recibes un `.p12` o `.pfx`, dejalo fuera del repo y ejecuta:

```bash
DTE_CERT_P12_PATH=/ruta/externa/certificado.p12 DTE_CERT_P12_PASSWORD='password-temporal-no-commitear' npm run dte:cert:convert
```

Tambien puedes usar argumentos:

```bash
DTE_CERT_P12_PASSWORD='password-temporal-no-commitear' npm run dte:cert:convert -- --input=/ruta/externa/certificado.p12
```

El script escribe solo en:

- `/home/verf/secure/dte-lab/certs/certificado-digital.pem`
- `/home/verf/secure/dte-lab/private/certificado-private-key.pem`

No imprime private key, certificado completo ni password. Si `openssl` no esta disponible, muestra comandos equivalentes para ejecutar manualmente fuera del repo.

## Diagnosticar archivos externos

Ejecutar:

```bash
npm run dte:external:check
```

El diagnostico carga `.env.dte-lab` si existe y reporta, sin imprimir secretos:

- existencia de CAF/cert/key.
- rutas absolutas.
- rutas externas al repo.
- permisos recomendados.
- hashes/fingerprints seguros.
- tipo DTE del CAF.
- rango de folios CAF.
- RUT emisor CAF.
- folio solicitado dentro del rango.
- tipo DTE solicitado coincide con CAF.
- certificado PEM legible por OpenSSL si esta disponible.
- private keys legibles por OpenSSL si esta disponible.
- `readyForXml=true/false`.

Mientras falte cualquier archivo real o validacion, debe terminar con `readyForXml=false`.

## Generar y validar primer XML real/controlado

Cuando `npm run dte:external:check` diga `readyForXml=true`:

```bash
npm run dte:certification:readiness
npm run dte:certification:xml
npm run dte:certification:validate-xml
```

Resultado esperado con archivos reales validos:

- `tmp/dte-certification/certification-envio-dte.xml`
- `tmp/dte-certification/certification-envio-dte.xml.sha256`
- `tmp/dte-certification/certification-envio-dte.xml.metadata.json`
- TED real/controlado.
- FRMT real/controlado.
- XMLDSig `verified_controlled`.
- XSD valido o error XSD real entendible.
- `sii_contact=no`.
- `track_id_simulado=NO`.

Resultado esperado antes de cargar archivos reales:

- `dte:external:check`: `readyForXml=false`.
- `dte:certification:readiness`: LAB listo, archivos/endpoints pendientes.
- `dte:certification:xml`: bloquea por archivos faltantes.
- `dte:certification:validate-xml`: falla porque no existe XML.

## Que NO hacer

- No commitear CAF real.
- No commitear `.pem`, `.key`, `.p12`, `.pfx`, passwords ni `.env.dte-lab` real.
- No copiar secretos a `docs/`, `app/`, `lib/`, `scripts/` ni `tmp/`.
- No usar llaves falsas para pasar XML.
- No simular `track_id`.
- No activar `DTE_MODE=production`.
- No usar endpoints productivos.
- No conectar agenda/pagos a emision automatica antes de certificacion real.
- No correr submit SII hasta tener XML, XSD, firma, endpoints y flag controlado.

## Verificar que no hay secretos en Git

```bash
git status --short
git diff --name-only
git ls-files | rg '(^|/)(secure|secrets|private|certs|dte-lab|dte-secrets|tmp/dte-certification)(/|$)|\.(pem|key|p12|pfx|crt|cer|der|csr|jks|keystore)$|caf.*\.xml$|(^|/)caf\.xml$'
```

El ultimo comando no debe mostrar secretos reales. Si muestra rutas de API como `app/api/admin/dte-lab/...`, no son secretos; revisar manualmente cualquier archivo material.
