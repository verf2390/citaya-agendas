# Citaya DTE Signing Lab

Este directorio contiene solo placeholders seguros para el laboratorio DTE.

## Estado actual

- `signXmlMockForLab()` inserta una firma MOCK con forma cercana a XMLDSig para probar UI, estados y flujo interno.
- La firma MOCK referencia `xmldsignature_v10.xsd`, pero no está validada contra ese XSD.
- `signXmlForLab()` queda preparado para una firma real futura de laboratorio y falla de forma controlada si no recibe certificado de prueba/controlado.
- `sign-xml.real.ts` prepara la ruta real/controlada leyendo solo referencias seguras desde variables de entorno y bloquea la firma hasta implementar XMLDSig completo.
- Ninguna función usa certificados reales, claves privadas reales ni passwords reales.

## Variables previstas

- `DTE_CERT_PATH`: ruta local ignorada o montada desde secreto seguro. No versionar el archivo.
- `DTE_CERT_PASSWORD`: password del certificado desde secret manager o entorno seguro.
- `DTE_SIGNING_MODE`: `lab`, `certification` o `production`.

Si faltan variables, la preparación falla con `missing_secret`. Si existen, sigue bloqueada con `pending_dependency` hasta implementar canonicalización, digest, firma RSA, `KeyInfo` e inserción del nodo `Signature`.

## Pendiente para firma real

Para avanzar a firma productiva o certificación SII se requiere:

- Certificado digital por contribuyente/tenant.
- Clave privada y password fuera del repositorio.
- Carga segura desde secret manager o almacenamiento cifrado por tenant.
- Canonicalización XML compatible con SII.
- Cálculo de digest del nodo correcto.
- Firma del `Documento`/DTE.
- Firma del sobre/envío si aplica al flujo.
- Validación contra `xmldsignature_v10.xsd`.
- Validación cruzada contra `DTE_v10.xsd` y `EnvioDTE_v10.xsd`.
- Pruebas con ambiente de certificación antes de producción.

Dependencia recomendada antes de activar: `xml-crypto`, evaluando compatibilidad con algoritmos SII y canonicalización requerida. Alternativa sin dependencia: implementación manual con `node:crypto`, pero aumenta riesgo de errores XMLDSig. Comando sugerido, si se aprueba despues de evaluar: `npm install xml-crypto`.

## Reglas

- No commitear certificados, `.pfx`, `.p12`, claves privadas, passwords ni CAF reales.
- No loggear XML firmado completo en logs generales.
- No enviar secretos a frontend, n8n, emails ni herramientas de soporte.
- No usar certificados productivos en laboratorio.
- Auditar cada uso futuro de certificado por `tenant_id`, ambiente, documento y usuario/servicio.
