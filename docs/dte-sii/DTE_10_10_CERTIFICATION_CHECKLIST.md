# DTE/SII 10/10 Certification Checklist

Estado actual obligatorio: `LAB / PENDIENTE / NO PRODUCTIVO`.

Este checklist mide preparacion tecnica para certificacion real SII. No declara emision legal, no activa produccion, no contacta SII por defecto y no permite `track_id` simulado.

## Listo en este bloque

- Readiness separa `labReady`, `certificationFilesReady`, `xmlGenerationReady`, `siiEndpointsReady` y `submitReady`.
- CAF/certificado/llaves deben venir desde rutas absolutas externas al repo.
- Rutas sensibles dentro del repo quedan bloqueadas antes de generar XML.
- `DTE_CERTIFICATION_DOC_TYPE` acepta codigo SII numerico (`33`, `34`, `39`, `41`, `56`, `61`) o nombre interno soportado.
- El generador elige builder factura o boleta segun el tipo DTE real del CAF/draft.
- CAF real/controlado se parsea sin imprimir contenido completo.
- Folio se valida contra rango CAF.
- Tipo DTE se valida contra CAF.
- TED se construye con `DD` y CAF embebido.
- FRMT se firma con llave CAF externa usando RSA-SHA1.
- XMLDSig se genera con certificado/private key externos, canonicalizacion C14N via `xmllint`, digest SHA1 y firma RSA-SHA1.
- XMLDSig debe verificar localmente como `verified_controlled`; si no verifica, no se emite artefacto certification.
- Se genera SHA256 del XML y metadata segura.
- Metadata no contiene CAF completo, XML completo, private keys, certificado completo, tokens ni passwords.
- Submit certification sigue bloqueado salvo flag explicito, endpoints, backend LAB, XML existente, XSD valido y firma sin bloqueos.
- Produccion sigue bloqueada.

## Pendiente para primer XML certification real

- Colocar CAF real de certificacion fuera del repo.
- Colocar llave privada CAF real fuera del repo.
- Colocar certificado digital PEM fuera del repo.
- Colocar private key del certificado fuera del repo.
- Confirmar que el tipo DTE del CAF coincide con `DTE_CERTIFICATION_DOC_TYPE`.
- Confirmar que `DTE_CERTIFICATION_FOLIO` pertenece al rango CAF.
- Ejecutar generacion y revisar que XMLDSig quede `verified_controlled`.
- Ejecutar validacion XSD sobre `tmp/dte-certification/certification-envio-dte.xml`.

## Pendiente para submit SII certification

No ejecutar submit real hasta cumplir todo:

- `npm run dte:certification:xml` genera XML, `.sha256` y `.metadata.json`.
- `npm run dte:certification:validate-xml` pasa.
- Metadata reporta TED/FRMT real/controlado.
- Metadata reporta XMLDSig document/envio `verified_controlled`.
- Endpoints `DTE_SII_SEED_URL`, `DTE_SII_TOKEN_URL`, `DTE_SII_SUBMIT_URL`, `DTE_SII_STATUS_URL` configurados para certification.
- `DTE_PERSISTENCE_BACKEND=supabase` apuntando solo a LAB.
- Tenant LAB existe y puede trazarse sin tocar produccion.
- `DTE_SII_ENABLE_SUBMIT=true` activado solo para la ejecucion controlada.
- `DTE_MODE` no es `production`.
- `DTE_SII_ENV=certification`.
- Sin agenda/pagos conectados a emision automatica.

## Criterio para conectar agenda/pagos

No conectar agenda/pagos hasta que exista:

- XML certification generado con CAF/TED/FRMT/XMLDSig reales/controlados.
- XSD validado.
- Submit real a SII certification ejecutado con respuesta trazada.
- `track_id` real recibido o ausencia trazada sin simulacion.
- Consulta de estado por `track_id` real cuando exista.
- Flujo de errores y reintentos auditado.
- Revision tributaria antes de automatizar documentos desde reservas o pagos.

## Criterio para produccion

Produccion queda bloqueada hasta cumplir todo:

- Certificacion SII completada y aprobada para el tenant/documentos aplicables.
- CAF productivo real obtenido y almacenado fuera del repo.
- Certificado/llaves productivas protegidas fuera del repo o en vault seguro.
- Endpoints productivos validados con controles de entorno.
- RLS, constraints, auditoria y retencion revisadas.
- Procedimiento de contingencia y anulacion documentado.
- Revision legal/tributaria completada.
- Feature flag explicito de produccion y rollback.

## Comandos exactos

```bash
npm run dte:certification:readiness
npm run dte:certification:xml
npm run dte:certification:validate-xml
npm run dte:certification:submit
```

`dte:certification:submit` debe bloquear mientras no esten todos los requisitos y `DTE_SII_ENABLE_SUBMIT=true`. No debe generar `track_id` simulado.

## Riesgos abiertos

- La validacion criptografica local no equivale a aprobacion SII.
- La ubicacion exacta de `Signature`, transforms y canonicalizacion deben ser confirmadas con set real de certification SII.
- XSD local puede no cubrir todas las reglas de negocio SII.
- Certificados cifrados o PFX/P12 pueden requerir manejo adicional fuera del repo.
- Persistencia Supabase debe mantenerse en LAB hasta aprobar seguridad/RLS por tenant.
- El modulo no emite legalmente hasta certificacion y paso controlado a produccion.

## Resultado aceptable sin archivos reales

- Readiness muestra LAB listo, pero `certificationFilesReady=false`, `xmlGenerationReady=false`, `submitReady=false`.
- XML bloquea con variables faltantes y doc de setup.
- Validate XML falla porque no existe artefacto.
- Build pasa.
- Estado final: `LAB / PENDIENTE / NO PRODUCTIVO`.

## Resultado aceptable con archivos reales

- XML se genera en `tmp/dte-certification/certification-envio-dte.xml`.
- Hash se genera en `.sha256`.
- Metadata segura se genera en `.metadata.json`.
- TED y FRMT quedan reales/controlados.
- XMLDSig document/envio queda `verified_controlled`.
- XSD pasa o reporta errores reales entendibles.
- No se contacta SII.
- No se simula `track_id`.
