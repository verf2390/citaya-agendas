# Citaya DTE Signing Lab

Este directorio contiene solo placeholders seguros para el laboratorio DTE.

No hay firma real todavía. Para avanzar a firma productiva o certificación SII se requiere:

- Certificado digital por contribuyente/tenant.
- Clave privada y password fuera del repositorio.
- Carga segura desde secret manager o almacenamiento cifrado por tenant.
- Canonicalización XML compatible con SII.
- Firma del `Documento`/DTE.
- Firma del sobre/envío si aplica al flujo.
- Pruebas con ambiente de certificación antes de producción.

Reglas:

- No commitear certificados, `.pfx`, `.p12`, claves privadas, passwords ni CAF reales.
- No loggear XML firmado completo en logs generales.
- No enviar secretos a frontend, n8n, emails ni herramientas de soporte.

