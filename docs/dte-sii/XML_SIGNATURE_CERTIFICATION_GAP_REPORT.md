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
| XML DTE / EnvioDTE | Estructural/controlado | `generate-lab-xml.mjs --mode=certification` usa CAF, TED, FRMT y XMLDSig controlados si existen archivos externos. | Builder conserva nombres `Lab` y warnings no productivos; debe revisarse contra casos reales de set SII certification. |
| XMLDSig | Parcial/controlado, no marcable como real SII | `buildXmlDsigControlled` firma `SignedInfo` con llave externa y embebe certificado PEM. | Canonicalizacion/digest son implementacion local simple; falta XMLDSig robusto con canonicalizacion real del nodo, transforms oficiales, insercion en nodo correcto y validacion contra `xmldsignature_v10.xsd`/SII. |
| Certificado digital | Parcial/controlado | Carga PEM externo desde `DTE_CERT_PATH`/`DTE_PUBLIC_CERT_PATH`. | No soporta PFX/P12 ni password de contenedor. No extrae metadata certificado. |
| Private key XMLDSig | Real/controlado para PEM | Carga PEM externo desde `DTE_PRIVATE_KEY_PATH`, nunca lo imprime ni persiste. | No soporta llaves cifradas/PFX/P12. |
| XSD validation | Real si `xmllint` existe | `scripts/dte/validate-xsd.mjs` ejecuta `xmllint --schema`. | Depende de `xmllint`; no guarda reporte estructurado aun. Si XSD falla, submit se bloquea. |
| Submit SII certification | Preparado/bloqueado | `scripts/dte/certification-submit.mjs` bloquea sin flag/config, sin XML/firma real, sin Supabase LAB o con production. | No debe avanzar mientras XMLDSig siga con warning de canonicalizacion no validada SII. |

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
- XMLDSig controlado actual no debe marcarse como validado SII: digest/canonicalizacion/insercion deben reemplazarse por una implementacion XMLDSig completa.

## Bloqueos por falta de CAF/cert/key

- Falta `DTE_CAF_PATH`: `pending_config` o `missing_external_file`.
- Falta `DTE_CAF_PRIVATE_KEY_PATH`: no hay FRMT real.
- Falta `DTE_CERT_PATH`/`DTE_PRIVATE_KEY_PATH`: no hay XMLDSig controlado.
- Cualquier ruta dentro del repo: `unsafe_repo_path`/`blocked_submit`.
- Formato no soportado: `failed` con error seguro. Actualmente soportado: CAF `.xml`, llaves `.pem`/`.key`, certificados `.pem`/`.crt`/`.cer`.

## Riesgos

- XMLDSig puede no ser aceptado por SII aunque firme criptograficamente, porque falta canonicalizacion robusta y validacion de transforms/insercion segun estandar SII.
- CAF `FRMA` no se valida criptograficamente contra autoridad SII; se parsea y se usa el CAF como insumo controlado.
- PFX/P12 no esta soportado; usar PEM externos por ahora.
- `generate-lab-xml.mjs` mantiene datos demo fijos; antes del submit real deben venir del tenant LAB/certification trazable y no de agenda/pagos.

## Siguiente accion concreta

1. Integrar una libreria XMLDSig probada o implementacion canonicalizada validada contra `xmldsignature_v10.xsd`.
2. Insertar firma XMLDSig en el nodo exacto requerido por DTE/EnvioDTE y validar con XSD oficial.
3. Agregar soporte PFX/P12 si el certificado real del tenant viene en ese formato.
4. Validar CAF/FRMT/XMLDSig con un set SII certification controlado antes de permitir seed/token/submit.
5. Mantener `certification-submit` bloqueando en `pending_real_certification` mientras XMLDSig no pueda declararse listo.

## Estado final

`LAB / PENDIENTE / NO PRODUCTIVO`.

Sin produccion, sin agenda/pagos, sin secretos en repo, sin token completo, sin `track_id` simulado y sin submit real mientras XML/firma no sean reales y validados.


## Estado XMLDSig SII

Implementacion actual: `lib/dte/signing/sign-xml.real.ts`.

- Canonicalizacion declarada: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`.
- Transforms declarados: canonicalizacion C14N 20010315. No se usa aun transform enveloped-signature.
- Digest: `http://www.w3.org/2000/09/xmldsig#sha1` calculado localmente sobre el fragmento recibido por el builder, no sobre una canonicalizacion robusta del nodo XML parseado.
- Signature method: `http://www.w3.org/2000/09/xmldsig#rsa-sha1` con private key PEM externa.
- Insercion: el generador actual arma `Signature` como fragmento y `build-dte-envelope` lo ubica como firma de documento despues de `</Documento>` y firma de envio despues de `</SetDTE>`. Esto es controlado, pero aun debe verificarse contra la estructura exacta esperada por SII.
- Referencia firmada: se pasa `referenceUri` del documento o set DTE. La firma actual no canonicaliza el nodo referenciado desde un DOM XML real.
- Alcance: se intenta firmar Documento/DTE y EnvioDTE mediante fragmentos separados en `generate-lab-xml.mjs --mode=certification`.
- XSD: el XML puede validarse con `scripts/dte/validate-xsd.mjs` si `xmllint` esta instalado. Si XSD falla, `certification-submit` bloquea antes de seed/token/submit.
- Estado honesto: `pending_real_certification`. Aunque hay `SignatureValue` criptografico con PEM externo, no se considera XMLDSig real SII hasta validar canonicalizacion, transforms, digest e insercion con casos SII certification.

Metadata segura devuelta por XMLDSig controlado:

- `signed`
- `xmlSignatureStatus`
- `canonicalizationMethod`
- `digestMethod`
- `signatureMethod`
- `transforms`
- `referenceUri`
- `reason`

Formatos soportados:

- Certificado publico: PEM/CRT/CER externo.
- Private key: PEM/KEY externo.
- PFX/P12: no soportado; se reporta `unsupported_certificate_format`.

Riesgos tecnicos:

- SII puede rechazar una firma que usa digest de string si el nodo canonicalizado real difiere.
- La posicion de `Signature` debe confirmarse contra `DTE_v10.xsd`, `EnvioDTE_v10.xsd` y pruebas SII.
- Falta extraer/validar certificado y llave desde PFX/P12 cuando el tenant no entregue PEM.
- Falta validacion automatizada de XMLDSig con un verificador independiente.

Siguiente paso concreto XMLDSig:

1. Reemplazar digest de string por canonicalizacion DOM del nodo referenciado.
2. Insertar `Signature` directamente en el nodo XML final y revalidar XSD completo.
3. Agregar verificacion XMLDSig independiente antes de permitir `ready_for_submit`.
4. Mantener `certification-submit` en bloqueo si `xmlSignatureStatus !== ready_controlled` o si XSD falla.
