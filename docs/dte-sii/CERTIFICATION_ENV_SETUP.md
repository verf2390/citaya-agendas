# Setup ambiente DTE certification

Estado: PENDIENTE / NO PRODUCTIVO.

Esta guia prepara una ejecucion local controlada con CAF, FRMT y XMLDSig desde archivos externos al repositorio. No envia al SII y no equivale a aprobacion SII.

## Ubicacion de secretos

Guardar archivos fuera del repo, por ejemplo:

```text
~/secure/citaya-dte/certification/
```

No guardar CAF, certificados, claves privadas ni passwords en `docs/`, `lib/`, `scripts/` ni cualquier ruta versionada.

## Variables requeridas

```bash
DTE_MODE=certification

DTE_CAF_PATH=/ruta/fuera/del/repo/caf.xml
DTE_CAF_PRIVATE_KEY_PATH=/ruta/fuera/del/repo/caf-private-key.pem

DTE_CERT_PATH=/ruta/fuera/del/repo/cert.pem
DTE_PRIVATE_KEY_PATH=/ruta/fuera/del/repo/private-key.pem
```

Opcionales:

```bash
DTE_CERT_PASSWORD=
DTE_CERT_P12_PATH=
DTE_CERT_P12_PASSWORD=
DTE_PUBLIC_CERT_PATH=/ruta/fuera/del/repo/cert.pem
```

SII certification:

```bash
DTE_SII_ENV=certification
DTE_SII_SEED_URL=
DTE_SII_TOKEN_URL=
DTE_SII_SUBMIT_URL=
DTE_SII_STATUS_URL=
SII_RUT_EMPRESA=
SII_RUT_USUARIO=
```

`DTE_SII_ENV=production` esta bloqueado hasta aprobacion SII real:

```text
DTE_PRODUCTION_DISABLED_UNTIL_SII_APPROVAL
```

## .env local

Usar `.env.local` o variables de shell. `.env.local` esta ignorado por git.

No agregar valores reales a `.env.example` ni a docs.

## Checklist antes de correr

- CAF corresponde al RUT emisor.
- CAF corresponde al tipo DTE.
- Folio esta dentro del rango CAF.
- Clave privada CAF existe y no esta versionada.
- Certificado XMLDSig existe y no esta versionado.
- Clave privada XMLDSig existe y no esta versionada.
- `git status --short` no muestra secretos.

## Comandos

Generar XML local certification:

```bash
DTE_MODE=certification node scripts/dte/generate-lab-xml.mjs --mode=certification
```

Validar XSD:

```bash
node scripts/dte/validate-xsd.mjs tmp/dte-certification/certification-envio-dte.xml docs/dte-sii/xsd/EnvioDTE_v10.xsd
```

Smoke SII certification sin enviar:

```bash
node scripts/dte/sii-certification-smoke.mjs --dry-run
```

## Rollback seguro

- Borrar `tmp/dte-certification/`.
- Cerrar shell que contiene variables.
- Remover rutas secretas desde `.env.local`.
- Confirmar `git status --short` antes de commitear.

## Limitaciones actuales

- XMLDSig usa Node crypto con serializacion estable controlada, pero la canonicalizacion debe verificarse contra SII.
- No se envia XML al SII.
- No se marca como produccion ni aprobado.
