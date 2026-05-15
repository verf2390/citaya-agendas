# DTE Multi-Tenant Security

Estado: **LAB / PENDIENTE / NO PRODUCTIVO** hasta certificacion/aprobacion SII real.

## Reglas

- Un tenant no puede ver certificados, CAF, folios, documentos ni respuestas SII de otro tenant.
- RLS es obligatoria para todas las tablas DTE.
- Certificado, private key y CAF deben vivir fuera del repo y fuera del frontend.
- No exponer secretos al navegador, logs, errores, toasts ni payloads API.
- Logs solo pueden incluir hashes, rutas abstractas o metadata no sensible.
- Cada emision debe generar audit log con actor, tenant, documento, IP/evento y resultado.
- Platform admin opera solo soporte auditado; no emision cruzada sin trazabilidad.
- Cada tenant emite con su propio RUT. Citaya no emite por todos con su RUT.
- Separar `lab`, `certification` y `production` a nivel configuracion, storage y permisos.
- Backups deben cifrar metadata sensible y referencias a storage seguro.
- Rotacion de certificados debe permitir vigencia, reemplazo y desactivacion sin perder auditoria.

## Secretos

Permitido:

- Rutas absolutas fuera del repo.
- Referencias a vault/KMS/storage seguro.
- Metadata publica de certificado.

No permitido:

- `.pem`, `.pfx`, `.key`, CAF reales o XML sensibles dentro de `docs/`, `lib/`, `app/`, `scripts/`.
- Contenido de llaves privadas en DB plana.
- Certificados/CAF reales servidos por endpoints admin.
