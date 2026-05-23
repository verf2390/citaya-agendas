# XML Signature Certification Gap Report

Estado final obligatorio: `LAB / PENDIENTE / NO PRODUCTIVO`.

Citaya mantiene enfoque `citaya_own_dte`: cada tenant debe emitir con su propio RUT, CAF, certificado, llave privada, folios y autorizacion SII. Este documento no acredita emision legal ni aprobacion SII.

## Inventario tecnico

| Area | Estado | Evidencia | Brecha |
| --- | --- | --- | --- |
| Carga externa segura | Real/controlada | `lib/dte/config/external-dte-files.ts` valida existencia, ruta fuera del repo y extension esperada. | No integra vault/KMS; por ahora usa rutas locales externas. |
| CAF parsing | Real/controlado | `parseCafRealControlledXml` extrae `RE`, `RS`, `TD`, `RNG/D`, `RNG/H`, `FA`, `RSAPK/M`, `RSAPK/E`, `IDK`, `FRMA`; valida base64, fecha y rango. | No valida criptograficamente la firma `FRMA` del CAF contra llave publica SII. |
| CAF validation contra draft | Real/controlado | `validateCafForDraftOrThrow` valida RUT emisor, tipo DTE y folio dentro de rango. | Falta persistir metadata CAF real por tenant/rango desde proceso admin controlado. |
| TED/DD | Real/controlado | `buildTedControlled` construye `DD` con `RE`, `TD`, `F`, `FE`, `RR`, `RSR`, `MNT`, `IT1`, `CAF`, `TSTED`. | TED no es productivo hasta validar XML completo y set SII certification. |
| FRMT | Real/controlado | `signFrmtControlled` firma `DD` con `RSA-SHA1` usando llave CAF externa PEM. | Solo PEM/key local externo. No soporta PFX/P12 ni validacion de correspondencia llave-CAF mas alla del intento de firma. |
| XML DTE / EnvioDTE | Estructural/controlado | `generate-lab-xml.mjs --mode=certification` usa CAF, TED, FRMT y XMLDSig controlados si existen archivos externos. | Builder sigue siendo certification controlado, no productivo; debe validarse con casos reales SII certification y datos tenant. |
| XMLDSig | Avanzado/controlado, no marcable como real SII | `buildXmlDsigControlled` canonicaliza con `xmllint --c14n`, calcula digest SHA1 del nodo canonicalizado, firma `SignedInfo` canonicalizado con RSA-SHA1 y verifica con certificado/clave publica externa. | La insercion se hace como fragmento en el envelope actual y falta validar contra set SII certification real, `xmldsignature_v10.xsd`/`EnvioDTE_v10.xsd` y reglas finales de transform/enveloped-signature. |
| Certificado digital | Parcial/controlado | Carga PEM externo desde `DTE_CERT_PATH`/`DTE_PUBLIC_CERT_PATH`. | No soporta PFX/P12 ni password de contenedor. No extrae metadata certificado. |
| Private key XMLDSig | Real/controlado para PEM | Carga PEM externo desde `DTE_PRIVATE_KEY_PATH`, nunca lo imprime ni persiste. | No soporta llaves cifradas/PFX/P12. |
| XSD validation | Real si `xmllint` existe | `scripts/dte/validate-xsd.mjs` ejecuta `xmllint --schema`. | Depende de `xmllint`; no guarda reporte estructurado aun. Si XSD falla, submit se bloquea. |
| Submit SII certification | Preparado/bloqueado | `scripts/dte/certification-submit.mjs` bloquea sin flag/config, sin Supabase LAB, con production, si XMLDSig no verifica o si XSD falla. | No contactar SII sin `DTE_SII_ENABLE_SUBMIT=true`, endpoints reales, XMLDSig verificado y XSD valido. |

## Que esta real hoy

- Validacion de rutas externas para CAF/certificados/llaves: existe, no acepta rutas dentro del repo y no imprime contenido.
- Parser de CAF: extrae campos necesarios y rechaza CAF incompleto/mal formado a nivel estructural.
- Validacion CAF vs draft: RUT, tipo DTE y folio.
- TED/DD: estructura esperada con CAF embebido.
- FRMT: firma real criptografica `RSA-SHA1` del `DD` usando llave CAF externa PEM.
- Hash XML: se calcula/persiste sha256 cuando el flujo genera XML y crea trazabilidad.
- XSD: hay comando real basado en `xmllint`.

## Que sigue placeholder/sintetico/lab

- Modo `xsd-structure` usa CAF/FRMT/XMLDSig sinteticos solo para estructura.
- Firma mock de `sign-xml.placeholder.ts` sigue siendo laboratorio y no debe enviarse al SII.
- XMLDSig controlado actual ya canonicaliza con `xmllint --c14n`, calcula digest y verifica firma localmente, pero no debe marcarse como validado SII hasta confirmar insercion, transforms finales y XSD con un set SII certification real.

## Bloqueos por falta de CAF/cert/key

- Falta `DTE_CAF_PATH`: `pending_config` o `missing_external_file`.
- Falta `DTE_CAF_PRIVATE_KEY_PATH`: no hay FRMT real.
- Falta `DTE_CERT_PATH`/`DTE_PRIVATE_KEY_PATH`: no hay XMLDSig controlado.
- Cualquier ruta dentro del repo: `unsafe_repo_path`/`blocked_submit`.
- Formato no soportado: `failed` con error seguro. Actualmente soportado: CAF `.xml`, llaves `.pem`/`.key`, certificados `.pem`/`.crt`/`.cer`.

## Riesgos

- XMLDSig puede no ser aceptado por SII aunque verifique localmente, porque la posicion de `Signature`, los transforms finales y el set completo deben validarse contra XSD y SII certification.
- CAF `FRMA` no se valida criptograficamente contra autoridad SII; se parsea y se usa el CAF como insumo controlado.
- PFX/P12 no esta soportado; usar PEM externos por ahora.
- `generate-lab-xml.mjs` mantiene datos demo fijos; antes del submit real deben venir del tenant LAB/certification trazable y no de agenda/pagos.

## Siguiente accion concreta

1. Validar `Signature` insertada en `DTE`/`EnvioDTE` contra `xmldsignature_v10.xsd` y `EnvioDTE_v10.xsd` con XML final.
2. Confirmar transforms finales exigidos por SII, incluyendo si corresponde `enveloped-signature`.
3. Agregar soporte PFX/P12 si el certificado real del tenant viene en ese formato.
4. Validar CAF/FRMT/XMLDSig con un set SII certification controlado antes de permitir seed/token/submit.
5. Mantener `certification-submit` bloqueando si `xmlSignatureStatus` no es `verified_controlled`, si XSD falla o si falta flag/config.

## Estado final

`LAB / PENDIENTE / NO PRODUCTIVO`.

Sin produccion, sin agenda/pagos, sin secretos en repo, sin token completo, sin `track_id` simulado y sin submit real mientras XML/firma no sean reales y validados.



## Artefacto XML certification controlado

Comando nuevo: `npm run dte:certification:xml`.

Artefactos esperados cuando existen CAF/cert/key externos validos:

- `tmp/dte-certification/certification-envio-dte.xml`
- `tmp/dte-certification/certification-envio-dte.xml.sha256`
- `tmp/dte-certification/certification-envio-dte.xml.metadata.json`

Estado actual del artefacto:

- Si faltan `DTE_CAF_PATH`, `DTE_CAF_PRIVATE_KEY_PATH`, `DTE_CERT_PATH` o `DTE_PRIVATE_KEY_PATH`, el comando bloquea en `pending_real_certification` y no genera XML real/controlado.
- Si existen archivos externos, el flujo parsea CAF, valida tipo/folio, genera TED/DD, firma FRMT con RSA-SHA1, construye `DTE`/`EnvioDTE`, firma XMLDSig controlado y verifica localmente.
- El folio se toma desde `DTE_CERTIFICATION_FOLIO` o desde `RNG/D` del CAF. Folio fuera de rango bloquea. Tipo documento distinto al CAF bloquea.
- El XML no se imprime por consola. Solo se imprime ruta, hash corto, estado global, folio/tipo y metadata segura.

Validacion XSD:

- `npm run dte:certification:validate-xml` valida por defecto `tmp/dte-certification/certification-envio-dte.xml` contra `docs/dte-sii/xsd/EnvioDTE_v10.xsd`.
- Tambien acepta ruta por argumento CLI o `DTE_CERTIFICATION_XML_PATH`.
- Si el XML falta, devuelve `xsd_valid=false` y error claro.
- Si XSD falla, devuelve `xsd_valid=false`; esa brecha bloquea submit como `xsd_failed`.
- Si XSD pasa, devuelve `xsd_valid=true`.

Brechas exactas restantes:

- Validar el XML final real/controlado con CAF/cert/key reales del tenant; en este workspace no hay esos archivos externos cargados.
- Confirmar la ubicacion final de `Signature`: hoy se inserta firma de documento despues de `</Documento>` dentro de `DTE` y firma de envio despues de `</SetDTE>` dentro de `EnvioDTE`.
- Confirmar si SII exige transform `enveloped-signature` ademas de C14N en la forma final.
- Validar `xmldsignature_v10.xsd` y `EnvioDTE_v10.xsd` con artefacto real/controlado.
- PFX/P12 sigue pendiente; actualmente solo PEM/CRT/CER y PEM/KEY externos.

## XMLDSig: canonicalización, transforms, digest e inserción

Implementacion actual: `lib/dte/signing/sign-xml.real.ts`. Estado: avanzado/controlado, todavia no productivo ni aprobado SII.

- Nodo firmado actualmente: el builder recibe el fragmento a firmar. Para documento se usa el `Documento`/TED del DTE controlado; para envio se usa el identificador `SetDTE` combinado con el documento/TED en el generador actual. Esto sigue siendo una simplificacion controlada y debe llevarse al nodo XML final real.
- `Reference URI`: `#<referenceUri>`, con `referenceUri` igual al ID del `Documento` o `SetDTE` segun llamada.
- Alcance: se genera firma de documento y firma de envio como fragmentos XMLDSig separados; no se firma produccion.
- CanonicalizationMethod: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`.
- Canonicalizacion efectiva: `xmllint --c14n` sobre XML parseado por libxml2. No se usa canonicalizacion manual por string. Si `xmllint` no existe, el estado queda `pending_real_certification`.
- Transforms: C14N 20010315. No se declara todavia `enveloped-signature`; debe confirmarse contra la forma final esperada por SII.
- DigestMethod: `http://www.w3.org/2000/09/xmldsig#sha1`. `DigestValue` se calcula sobre el nodo/fragmento canonicalizado.
- SignatureMethod: `http://www.w3.org/2000/09/xmldsig#rsa-sha1`. `SignatureValue` se calcula sobre `SignedInfo` canonicalizado con private key PEM externa.
- KeyInfo: incluye `X509Data/X509Certificate` derivado del PEM/CRT/CER externo; no imprime ni persiste certificado completo en logs o DB.
- Insercion: `build-dte-envelope.ts` inserta la firma de documento despues de `</Documento>` dentro de `DTE`, y la firma de envio despues de `</SetDTE>` dentro de `EnvioDTE`. Esta ubicacion es controlada y debe validarse con XSD oficial y caso SII real antes de submit.
- Verificacion independiente: `verifyXmlSignatureControlled` canonicaliza nuevamente `SignedInfo`, recalcula digest si recibe el nodo canonicalizado y verifica `SignatureValue` con certificado/clave publica externa. Si falla, el estado es `verification_failed` y `certification-submit` debe bloquear.
- XSD: `scripts/dte/validate-xsd.mjs` usa `xmllint --schema`, acepta ruta por CLI o `DTE_CERTIFICATION_XML_PATH`, reporta `xsd_valid=true/false` y no imprime XML completo.

Metadata segura devuelta por XMLDSig controlado:

- `signed`
- `xmlSignatureStatus`: `verified_controlled`, `verification_failed`, `pending_real_certification`, `missing_external_file`, `unsafe_repo_path`, `unsupported_certificate_format`, `xsd_failed` o `failed`.
- `canonicalizationMethod`
- `digestMethod`
- `signatureMethod`
- `transforms`
- `referenceUri`
- `digestValueSha256`
- `signatureValueSha256`
- `verification.attempted` / `verification.ok`
- `reason`

Formatos soportados:

- Certificado publico: PEM/CRT/CER externo.
- Private key: PEM/KEY externo.
- PFX/P12: no soportado; se reporta `unsupported_certificate_format`.

Estado honesto:

- `verified_controlled` significa que la firma verifica localmente con canonicalizacion C14N y clave publica/certificado externo.
- `verified_controlled` no significa aprobado por SII, no habilita produccion y no prueba validez legal.
- Antes del primer submit real falta validar el XML final completo contra XSD oficial y contra un set SII certification real con CAF/cert/key del tenant.

Riesgos tecnicos pendientes:

- Confirmar si SII espera transform `enveloped-signature` en esta ubicacion exacta.
- Confirmar que la firma del `SetDTE` se calcula sobre el nodo final real, no sobre un fragmento auxiliar.
- Validar `Signature` final contra `xmldsignature_v10.xsd` y `EnvioDTE_v10.xsd`.
- Soportar PFX/P12 o documentar conversion externa segura a PEM para tenants.

Siguiente paso concreto XMLDSig:

1. Generar XML certification con CAF/cert/key externos reales del tenant.
2. Validar XML final firmado con `npm run dte:certification:validate-xml -- <ruta-xml>`.
3. Si XSD pasa y `xmlSignatureStatus=verified_controlled`, ejecutar readiness completo sin production.
4. Solo despues, habilitar `DTE_SII_ENABLE_SUBMIT=true` para primer submit controlado a SII certification.

## Panel admin de facturacion

`/admin/facturacion` ahora resume el estado operativo DTE/SII sin convertirlo en produccion. El panel consume `/api/admin/dte-lab/status`, que agrega readiness, artefactos locales y trazas del repositorio DTE con respuesta redactada.

Que muestra:

- Badges `LAB`, `PENDIENTE`, `NO PRODUCTIVO`, `SII no aprobado` y `Submit bloqueado`.
- Checklist visual de base tecnica, archivos externos, XML/firma y SII certification.
- Existencia de `certification-envio-dte.xml`, `.sha256` y `.metadata.json` sin exponer XML completo ni rutas privadas.
- `xmlSignatureStatus`, verificacion local, XSD true/false/pendiente y `track_id` real pendiente/null cuando no existe.
- Ultima traza DTE LAB/certification: documento, submission y audit log.

Que no hace:

- No ejecuta `npm run` desde frontend.
- No contacta SII.
- No desbloquea submit real.
- No guarda ni muestra CAF/cert/key/tokens.
- No conecta agenda/pagos.
- No declara validez legal ni aprobacion SII.

Uso recomendado:

1. Revisar `/admin/facturacion` para detectar faltantes sin exponer secretos.
2. Ejecutar manualmente `npm run dte:certification:xml` en entorno controlado con archivos externos reales.
3. Ejecutar manualmente `npm run dte:certification:validate-xml`.
4. Confirmar en el panel que XML/metadata/hash existen, XMLDSig esta `verified_controlled` y XSD esta valido.
5. Solo despues evaluar primer submit real a SII certification mediante comandos controlados, nunca desde la UI en esta etapa.
