# Samples DTE/SII

Esta carpeta contiene muestras LAB generadas por scripts de Citaya.

## Archivos

- `lab-envio-dte.xml`: salida generada por `scripts/dte/generate-lab-xml.mjs`.

## Modos

```bash
node scripts/dte/generate-lab-xml.mjs
node scripts/dte/generate-lab-xml.mjs --mode=xsd-structure
node scripts/dte/generate-lab-xml.mjs --mode=certification
```

- `lab`: XML de laboratorio sin TED ni firmas reales.
- `xsd-structure`: XML con TED/FRMT/Signature sinteticos LAB solo para validar orden y nodos contra XSD. No tiene validez criptografica ni tributaria.
- `certification`: debe fallar si faltan secretos fuera del repositorio.

No guardar CAF reales, certificados, claves privadas, passwords ni XML reales de tenants en esta carpeta.

