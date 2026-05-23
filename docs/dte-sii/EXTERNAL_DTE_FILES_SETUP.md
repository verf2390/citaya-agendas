# Setup seguro de archivos externos DTE/SII LAB

Estado esperado de este bloque: `LAB / PENDIENTE / NO PRODUCTIVO`. Esta guia prepara rutas locales para CAF, certificado digital y llaves reales en LAB/certification, pero no contacta SII, no hace submit real, no genera `track_id` y no habilita produccion.

## Principio de seguridad

Los archivos reales de CAF, certificado digital y llaves privadas deben vivir fuera del repositorio Git. El codigo valida que las rutas de estas variables sean absolutas y externas al repo:

- `DTE_CAF_PATH`
- `DTE_CAF_PRIVATE_KEY_PATH`
- `DTE_CERT_PATH`
- `DTE_PRIVATE_KEY_PATH`

Si una ruta esta vacia, es relativa, apunta dentro del repo, no existe, no es archivo regular o tiene extension no soportada, el flujo bloquea antes de generar XML certification. En ese caso tampoco se contacta SII.

## Carpeta recomendada

Usar una carpeta local fuera del proyecto:

```bash
/home/verf/secure/dte-lab/
```

Estructura sugerida:

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

## Variables esperadas

| Variable | Archivo esperado | Extension aceptada | Uso |
| --- | --- | --- | --- |
| `DTE_CAF_PATH` | CAF real de certificacion del tenant | `.xml` | Rango de folios y datos CAF para TED/FRMT. |
| `DTE_CAF_PRIVATE_KEY_PATH` | Llave privada asociada al CAF | `.pem` | Firma FRMT del TED. |
| `DTE_CERT_PATH` | Certificado digital del tenant | `.pem`, `.crt`, `.cer` | XMLDSig controlado. |
| `DTE_PRIVATE_KEY_PATH` | Llave privada del certificado digital | `.pem` | Firma XMLDSig controlada. |
| `DTE_CERTIFICATION_FOLIO` | Folio de prueba dentro del rango CAF | numero positivo | Si no se define, el generador puede usar el primer folio del CAF. |
| `DTE_CERTIFICATION_DOC_TYPE` | Tipo DTE de certificacion | codigo SII `39`, `33`, `41`, etc. o nombre interno | Debe coincidir con el CAF. El generador acepta codigo numerico SII o nombre interno (`boleta_afecta`, `factura_afecta`, etc.). |
| `DTE_CERTIFICATION_OUTPUT_PATH` | Salida XML LAB | ruta dentro de `tmp/dte-certification/` | Artefacto generado, ignorado por Git. |

## Permisos recomendados

Crear carpetas:

```bash
mkdir -p /home/verf/secure/dte-lab/{caf,certs,private}
chmod 700 /home/verf/secure /home/verf/secure/dte-lab /home/verf/secure/dte-lab/private
chmod 750 /home/verf/secure/dte-lab/caf /home/verf/secure/dte-lab/certs
```

Aplicar propietario del usuario que ejecuta la app:

```bash
chown -R verf:verf /home/verf/secure/dte-lab
```

Permisos de archivos:

```bash
chmod 640 /home/verf/secure/dte-lab/caf/caf-certification.xml
chmod 640 /home/verf/secure/dte-lab/certs/certificado-digital.pem
chmod 600 /home/verf/secure/dte-lab/private/caf-private-key.pem
chmod 600 /home/verf/secure/dte-lab/private/certificado-private-key.pem
```

Si el proceso corre con otro usuario/grupo, ajustar `chown` y permisos para que solo ese usuario o grupo operativo pueda leer los archivos. No usar permisos world-readable (`chmod 644`) para llaves privadas.

## Que nunca commitear

No commitear ni copiar al repo:

- CAF real (`*.xml`, `caf.xml`, `*.caf.xml`) si contiene datos reales.
- Llaves privadas (`*.pem`, `*.key`, `*.p12`, `*.pfx`).
- Certificados reales (`*.crt`, `*.cer`, `*.der`, `*.csr`).
- Archivos `.env` con rutas o passwords reales.
- Artefactos generados en `tmp/dte-certification/`.
- Metadata que contenga paths internos, hashes reales o evidencia operacional sensible.

El repo puede contener fixtures publicos y muestras controladas bajo `docs/dte-sii/samples/`, pero no secretos reales ni CAF/certificados reales de tenants.

## Ejemplo de variables

Ver `docs/dte-sii/env.dte-lab.example`. Copiar sus valores a tu entorno local seguro o a `.env.local` solo si `.env.local` permanece ignorado por Git.

```bash
# Ejemplo local, no commitear .env.local
cp docs/dte-sii/env.dte-lab.example /tmp/env.dte-lab.local
```


## Conversion de certificados

El flujo controlado espera certificado y private key en archivos PEM legibles por Node/OpenSSL. Si recibes un `.p12`/`.pfx`, conviertelo fuera del repo y guarda solo los PEM resultantes en `/home/verf/secure/dte-lab/`:

```bash
openssl pkcs12 -in certificado-digital.p12 -clcerts -nokeys -out /home/verf/secure/dte-lab/certs/certificado-digital.pem
openssl pkcs12 -in certificado-digital.p12 -nocerts -nodes -out /home/verf/secure/dte-lab/private/certificado-private-key.pem
chmod 600 /home/verf/secure/dte-lab/private/certificado-private-key.pem
```

Si el PEM queda cifrado con password, validar primero compatibilidad del flujo antes de usarlo. No copiar el `.p12`, `.pfx`, password, PEM ni llaves dentro del repo.

## Flujo de prueba local sin SII

1. Configurar variables desde `docs/dte-sii/env.dte-lab.example` en un entorno local ignorado.
2. Ejecutar readiness:

```bash
npm run dte:certification:readiness
```

El output debe separar `labReady`, `certificationFilesReady`, `xmlGenerationReady`, `siiEndpointsReady` y `submitReady`. Mientras falten archivos o endpoints, el estado global sigue `LAB / PENDIENTE / NO PRODUCTIVO`.

3. Generar XML certification controlado:

```bash
npm run dte:certification:xml
```

Con archivos reales externos, el comando debe generar:

```text
tmp/dte-certification/certification-envio-dte.xml
tmp/dte-certification/certification-envio-dte.xml.sha256
tmp/dte-certification/certification-envio-dte.xml.metadata.json
```

La metadata solo puede contener hashes/fingerprints parciales, folio, tipo, modo, ambiente, estados TED/FRMT/XMLDSig, timestamps y warnings seguros. No debe contener CAF completo, XML completo, private keys, certificado completo, tokens ni passwords.

4. Validar XSD local:

```bash
npm run dte:certification:validate-xml
```

Este paso usa los XSD versionados en `docs/dte-sii/xsd/`. Si el XML no existe o no cumple XSD, falla claro y no oculta el error.

## Verificaciones antes de generar XML certification

Comprobar estado:

```bash
npm run dte:certification:readiness
```

El comando debe reportar `globalStatus=LAB / PENDIENTE / NO PRODUCTIVO` y nunca debe indicar produccion habilitada.

Generar XML LAB/certification controlado solo cuando los archivos externos existan:

```bash
npm run dte:certification:xml
```

Si falta una variable, la ruta es relativa, apunta dentro del repo, falta el archivo o la extension no corresponde, el comando debe bloquear, no generar XML y no contactar SII.

Validar XML generado:

```bash
npm run dte:certification:validate-xml
```

Si `tmp/dte-certification/certification-envio-dte.xml` no existe, el fallo es esperado.

## Verificar que no quedaron secretos en Git

Antes de commit:

```bash
git status --short
git diff --name-only
git ls-files | rg '(^|/)(secure|secrets|private|certs|tmp/dte-certification)/|\.(pem|key|p12|pfx|crt|cer|der|csr|jks|keystore)$|caf.*\.xml$'
```

El ultimo comando no debe mostrar archivos reales. Si aparece un fixture esperado, revisar manualmente que no sea secreto real.

Buscar contenido accidental en staged changes:

```bash
git diff --cached --name-only
git diff --cached -- docs app lib scripts | rg -i 'private key|BEGIN .*PRIVATE|certificado|CAF|DTE_CERT_PASSWORD|DTE_PRIVATE_KEY_PASSWORD'
```

Si aparece material sensible, abortar el commit y mover el archivo fuera del repo.

## Garantias de este bloque

- No activa produccion.
- No contacta SII.
- No hace submit real.
- No simula `track_id`.
- No conecta agenda/pagos.
- No guarda secretos en repo.
