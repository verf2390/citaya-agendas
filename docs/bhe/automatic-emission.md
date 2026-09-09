# CIT-73 — Emisión automática BHE

## Conclusión oficial SII

La emisión automática de Boletas de Honorarios Electrónicas (BHE) existe, pero no como una API pública general disponible para cualquier contribuyente.

La Resolución Exenta SII N°64 de 24-06-2021 establece un **web service de emisión masiva de BHE** sujeto a autorización y certificación previa del contribuyente.

Fuente oficial: https://www.sii.cl/normativa_legislacion/resoluciones/2021/reso64.pdf

### Condiciones conocidas

- El acceso está pensado para contribuyentes que emitan masivamente BHE.
- La resolución define, en principio, emisión masiva como promedio de **300 o más BHE mensuales** durante los 6 meses anteriores a la solicitud.
- El SII también puede considerar necesidades de simultaneidad temporal según la operación.
- El contribuyente debe certificar su sistema de emisión ante el SII.
- La certificación cubre generación de archivos electrónicos, comunicaciones autónomas con el web service y manejo de respuestas automáticas.
- El proveedor informático debe incorporarse al proceso de certificación cuando exista.
- La solicitud se presenta mediante Formulario 2117, materia `Boleta de Honorarios en forma masiva`.
- El acceso al web service sólo se habilita después de evaluación y certificación satisfactoria.

## Delegación a usuario autorizado

El SII permite que un contribuyente autorice a un tercero para emitir BHE usando la propia Clave Tributaria del tercero. Ese mecanismo está documentado como flujo del portal web y no debe considerarse una API genérica para Citaya.

Fuentes:

- https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_1040.htm
- https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_0609.htm
- https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_1767.htm

## Arquitectura Citaya

La BHE automática debe ser opcional y separada de DTE 33/39.

### Camino normal

`tax_document_mode = external_bhe`

El tenant puede operar live con agenda y campañas sin exigir DTE Citaya ni BHE automática.

### Camino automático futuro

Sólo se habilitará si existe evidencia verificable de:

1. elegibilidad o evaluación SII;
2. solicitud administrativa;
3. certificación del sistema;
4. autorización SII vigente;
5. especificación técnica oficial recibida;
6. credenciales/configuración técnica completas;
7. worker e idempotencia listos.

No se implementarán endpoints, WSDL, formatos, tokens ni secretos inventados. La capa de transporte se construirá únicamente cuando el SII entregue o publique la especificación técnica aplicable al contribuyente autorizado.

## Dimarzo Barber

Dimarzo no debe depender de la automatización BHE para pasar a `live`. Mientras no cuente con una autorización SII de emisión masiva, su camino correcto es `external_bhe` con automatización deshabilitada.
