# Citaya DTE Signing Lab

Este directorio contiene solo placeholders seguros para el laboratorio DTE.

## Estado actual

- `signXmlMockForLab()` inserta una firma MOCK con forma cercana a XMLDSig para probar UI, estados y flujo interno.
- La firma MOCK referencia `xmldsignature_v10.xsd`, pero no está validada contra ese XSD.
- `signXmlForLab()` queda preparado para una firma real futura de laboratorio y falla de forma controlada si no recibe certificado de prueba/controlado.
- Ninguna función usa certificados reales, claves privadas reales ni passwords reales.

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

## Reglas

- No commitear certificados, `.pfx`, `.p12`, claves privadas, passwords ni CAF reales.
- No loggear XML firmado completo en logs generales.
- No enviar secretos a frontend, n8n, emails ni herramientas de soporte.
- No usar certificados productivos en laboratorio.
- Auditar cada uso futuro de certificado por `tenant_id`, ambiente, documento y usuario/servicio.
