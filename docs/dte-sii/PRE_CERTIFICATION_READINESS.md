# Citaya DTE/SII Pre-Certification Readiness

Estado honesto actual: **LAB / PENDIENTE / NO PRODUCTIVO**.

Citaya avanza bajo el enfoque `citaya_own_dte`: cada tenant emite con su propio RUT, razon social, giro, direccion, certificado, CAF, folios y autorizacion SII. Citaya no debe emitir por todos usando un RUT central.

## Que esta listo

- Generacion XML LAB.
- Modo `xsd-structure` validable contra XSD oficiales SII.
- XSD oficiales en `docs/dte-sii/xsd/`.
- TED estructural controlado.
- FRMT y XMLDSig reales/controlados preparados para certification con secretos externos.
- Falla segura si faltan CAF/certificado/llaves en modo `certification`.
- Readiness tecnico por script y API admin.
- Cliente SII certification separado en seed/token/submit/status con errores controlados.
- Smoke test SII certification en dry-run por defecto, sin envio ni track_id simulado.
- Persistencia no productiva de dry-run/submissions/status/auditoria con hashes y redaccion.
- Base de muestra impresa/PDF LAB.
- Schema futuro documentado, no aplicado.

## Que falta para SII real

- CAF real de certificacion por tenant.
- Certificado digital real por tenant.
- FRMT real probado contra CAF real.
- XMLDSig real validado contra reglas SII.
- Cliente SII real: seed/token/upload/status.
- Envio a ambiente certificacion.
- `track_id` real.
- Consulta de estado real.
- Correccion de rechazos y aprobacion/certificacion SII.

## Comandos

```bash
npm run build
npx eslint lib/dte scripts/dte app/api/admin/dte-lab app/admin/facturacion
node scripts/dte/generate-lab-xml.mjs --mode=lab
node scripts/dte/generate-lab-xml.mjs --mode=xsd-structure
node scripts/dte/validate-xsd.mjs docs/dte-sii/samples/lab-envio-dte.xml docs/dte-sii/xsd/EnvioDTE_v10.xsd
node scripts/dte/precert-readiness.mjs
```

Tambien existen scripts:

```bash
npm run dte:lab
npm run dte:xsd
npm run dte:validate:xsd
npm run dte:precert
npm run dte:certification
npm run dte:sii:dry-run
npm run dte:sii:dry-run:trace
npm run dte:persistence:check
```

## Certification

`certification` requiere secretos reales fuera del repo:

```bash
DTE_MODE=certification
DTE_CAF_PATH=/ruta/fuera/del/repo/caf.xml
DTE_CAF_PRIVATE_KEY_PATH=/ruta/fuera/del/repo/caf-private-key.pem
DTE_CERT_PATH=/ruta/fuera/del/repo/cert.pem
DTE_PRIVATE_KEY_PATH=/ruta/fuera/del/repo/private-key.pem
DTE_SII_ENV=certification
DTE_SII_SEED_URL=
DTE_SII_TOKEN_URL=
DTE_SII_SUBMIT_URL=
DTE_SII_STATUS_URL=
```

No usar rutas como `./cert.pem`, `./private-key.pem`, `./caf.xml`, ni archivos dentro de `docs/`, `lib/`, `app/` o `scripts/`.

## Como interpretar scores

- Laboratorio tecnico: mide estructura local, generador, XSD y muestra impresa.
- Certificacion SII readiness: mide si el sistema esta cerca de iniciar certificacion real.
- Produccion tecnica: mide piezas necesarias para operar con tenant, folios, DB, auditoria e integraciones.

El score **no significa aprobado SII**, no significa emision legal, no significa facturacion productiva. Solo significa preparacion tecnica.

## Persistencia Supabase

Pre-certificacion ahora contempla:

- Migracion revisable `DTE_SUPABASE_MIGRATION.sql`.
- `SupabaseDteRepository` detras de `DTE_PERSISTENCE_BACKEND=supabase`.
- Factory `getDteRepository()` con default seguro `memory`.
- RLS sugerida por tenant/platform admin.
- Endpoints admin de trazas DTE/SII.
- UI de trazas en `/admin/facturacion`.
- Auditoria de compatibilidad `DTE_SCHEMA_COMPATIBILITY_AUDIT.md`.
- Checks post-migracion `DTE_SUPABASE_POST_MIGRATION_CHECKS.sql`.
- Plan de aplicacion controlada `DTE_SUPABASE_APPLY_PLAN.md`.

Esto no sube el estado a productivo: no hay migracion aplicada automaticamente, no hay submit real al SII, no hay track_id real, no hay agenda/pagos conectados y RLS debe probarse con tenants reales de LAB antes de activar Supabase backend.

## Regla permanente

Hasta tener CAF real, certificado real, FRMT real probado, XMLDSig real validado, envio a certificacion, `track_id`, consulta de estado y aprobacion SII, todo debe quedar marcado como:

**LAB / PENDIENTE / NO PRODUCTIVO**.
