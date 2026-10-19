# CIT-129 — Auditoría de precios y condiciones comerciales (2026-10-19)

**Estado:** inventario de fuentes, NO tarifario aprobado.
**Alcance:** documentación; no modifica precios, cotizaciones, reglas de negocio ni producción.

## Fuentes actuales en el repositorio

| Canal | Ubicación | Oferta anunciada | Observaciones |
| --- | --- | --- | --- |
| Home y /planes | `app/(marketing)/components/home/plans-section.tsx` | «Empieza a ordenar»: $14.990/mes | No indica explícitamente IVA, límite de profesionales ni relación con el cotizador demo. El copy promocional caducado se corrige por separado en CIT-127. |
| Home y /planes | archivo anterior | «Negocio profesional»: $250.000–$600.000 CLP | Implementación web a medida. El rango es orientativo; no indica impuestos, hosting ni mantenimiento. |
| Home y /planes | archivo anterior | «Solución personalizada»: desde $990.000 CLP | Proyecto web/automatizaciones; alcance sujeto a propuesta y no equiparable a suscripción de agenda. |
| Demo agenda | `app/tenants/[slug]/DemoQuoteCard.tsx` | $29.000 mensual para 1 a 10 profesionales + $3.000/mes por cada profesional adicional | Regla **codificada** en el cotizador: `BASE_MONTHLY = 29000`, `INCLUDED_PROS = 10`, `EXTRA_PER_PRO = 3000`. No indica claramente IVA en el resumen. |
| Demo agenda | mismo archivo | $49.900 implementación | `IMPLEMENTATION_PRICE = 49900`. La prueba `tests/demo-commercial-copy.test.mjs` protege el importe actual; no modificar sin decisión comercial. |
| Demo servicios | `app/servicios-demo/components/lead-capture-section.tsx` | «Planes desde $29.000 mensual» | Puede estar alineado con la demo de agenda pero contradice la apariencia de «desde $14.990» en la web principal si se leen como el mismo producto. |

## Material comercial externo revisado previamente

- `brochure_citaya.pdf` y `brochure_citaya_v2.pdf`: agenda $14.990/mes y webs $180.000–$200.000 (documentos anteriores; no asumir vigencia).
- `Citaya_Planes_y_Servicios_2026.pdf`: Esencial $14.990 + IVA/mes, Profesional $29.990 + IVA/mes y «A medida» según cotización; contempla 7 días de prueba para Esencial.
- Estos documentos **no son configuraciones operativas del repositorio**, ni prueban que una oferta esté vigente a octubre de 2026. Revisar cuál documento se envía hoy a prospectos.

## Preguntas de aprobación comercial pendientes

1. ¿El precio $14.990 mensual corresponde a un plan Esencial vigente? ¿Qué funcionalidades, profesionales y condiciones incluye?
2. ¿El cotizador demo de $29.000/mes y $49.900 de implementación representa un plan distinto, una promoción antigua o una tarifa desactualizada?
3. ¿Debe conservarse un plan Profesional de $29.990 + IVA, como en el PDF, y cómo se diferencia del plan calculado?
4. ¿Los importes publicados son netos + IVA o totales IVA incluido? (Debe indicarse expresamente por canal.)
5. ¿La web profesional se cotiza por rango de $250.000–$600.000 y los proyectos especiales desde $990.000, o cambiaremos condiciones?
6. ¿Se mantiene el anticipo 50%/50% para webs y cuáles son cobros recurrentes (hosting, dominios, soporte, automatizaciones, API/IA)?
7. ¿La prueba gratuita de siete días sigue vigente y en cuál plan?

## Política para la siguiente implementación (solo después de aprobar tarifa)

- Una tabla central de ofertas, distinguida por producto: `suscripcion_agenda`, `implementacion_agenda`, `web_profesional`, `solucion_a_medida`; no mezclar precios entre productos.
- La demo y el sitio comercial deben indicar «precio de referencia» cuando aplique, impuestos y alcance; **no** cambiar fórmulas ni contratos existentes silenciosamente.
- Agregar tests que detecten divergencia de copys/precios. Los tests actuales del cotizador protegen $49.900; actualizarlos solo con decisión expresa.
- El material institucional destinado a Sercotec usará «Cotización según alcance» cuando el servicio sea personalizado; no se inferirá que los fondos de Sercotec pagan automáticamente o a un precio fijado.

## Gate de cierre y publicación

- [x] Inventario de precios y referencias en repo realizado.
- [ ] Aprobación escrita del dueño del negocio para cada tarifa y su IVA.
- [ ] Modificaciones de código en otra rama/PR, con pruebas.
- [ ] Actualización del PDF/dossier una vez que el tarifario esté aprobado.
- [ ] Verificación de web y demo en vista previa; revisión de aceptación.
- [ ] Merge y despliegue solo con autorización y plan de reversión.

**Producción, tenants, bases de datos, facturación y reglas de cotización: sin cambios por este ticket.**
