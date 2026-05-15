# DTE Persistence and Audit

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Esta capa prepara trazabilidad seria para DTE/SII sin activar produccion, agenda/pagos ni emision legal.

## Que se guarda

- `tax_documents`: metadata tributaria, folio, estado interno, estado SII, montos, referencias futuras a agenda/pagos y `xml_sha256`.
- `tax_document_sii_submissions`: ambiente, `track_id` real cuando exista, estado de submission, estado SII, hash de request/response, token fingerprint y respuesta redactada.
- `tax_document_status_history`: transiciones internas/SII con fuente (`system`, `admin`, `sii`, `webhook`, `script`) y razon.
- `tax_document_audit_log`: acciones auditables con actor, metadata redactada e `ip_hash`.

## Que NO se guarda

- Tokens completos.
- Private keys.
- Certificados completos.
- CAF reales completos en logs/auditoria.
- Passwords.
- Rutas completas sensibles.
- XML completo en la traza smoke cuando no corresponde.

## Hashes

`xml_sha256` se calcula con SHA-256 sobre el XML exacto que se quiere trazar. Permite comprobar integridad sin exponer el documento completo.

## Redaccion

- `redactToken()` deja solo prefijo/sufijo.
- `fingerprintToken()` guarda SHA-256 con prefijo interno, no el token.
- `redactSiiResponse()` conserva estado, `track_id`, mensaje, lista de llaves y hash de respuesta segura.
- `safeJsonForAudit()` reemplaza tokens, secretos, certificados, passwords y PEM por marcas `[redacted]`.
- `redactSensitivePath()` conserva basename y hash corto, no ruta completa.

## Track ID

No se inventa `track_id`. Solo se guarda cuando venga de una respuesta real SII clara. En dry-run queda `null`.

## Status History

Cada cambio debe registrar:

- `previous_status`
- `next_status`
- `previous_sii_status`
- `next_sii_status`
- `reason`
- `source`
- `created_by`

Las transiciones usan `lib/dte/status/dte-status.ts` para impedir saltos peligrosos como `draft -> accepted`.

## Doble emision

El schema propone unique constraints por:

- `tenant_id + document_type + folio`
- `tenant_id + appointment_id + document_type`
- `tenant_id + payment_id + document_type`
- `tenant_id + payment_reference + document_type`
- `tenant_id + track_id`

## Supabase LAB/certification

`InMemoryDteRepository` sigue siendo el default seguro para tests/LAB.
`SupabaseDteRepository` esta implementado detras de:

```bash
DTE_PERSISTENCE_BACKEND=supabase
```

La migracion revisable vive en `DTE_SUPABASE_MIGRATION.sql` y la guia operativa en `DTE_SUPABASE_PERSISTENCE.md`. Si faltan tablas/configuracion, debe fallar con `DTE_SUPABASE_PERSISTENCE_NOT_READY`.

Endpoints admin:

- `GET /api/admin/dte-lab/traces`
- `GET /api/admin/dte-lab/traces/[id]`

Estos endpoints son solo para trazas LAB/certification, no devuelven XML completo, tokens completos ni rutas privadas completas.

## Regla

Hasta tener CAF real, certificado real, FRMT/XMLDSig reales, envio a certification, `track_id`, status real y aprobacion SII:

**LAB / PENDIENTE / NO PRODUCTIVO**.
