# Local Business Promo V2

Renderer `business-modern`: media fullscreen, texto editorial, marca discreta y
CTA sobre el último medio disponible. Sólo `custom-client-video`; modos `media`
y `benefit`. Contrato JSON y validación de medios existentes.

- CSS aislado en `templates/business-modern.css`; compilador en
  `scripts/business_modern.py`. No hereda layouts/presets de V1.
- `minimal`, `dynamic`, `premium`: gradientes, tipografía y poses de cámara
  deterministas. Geist local; sin fuentes externas ni estilos del modelo.
- Videos: `cover`, sin marcos; reproducción/offsets originales. Fotos: Ken Burns
  por índice (sin random). Cortes limpios, sin crossfade en esta versión.
- Intro sin creator: primer medio como fondo desde cero. Cierre: último medio.
  Si son videos, se extraen fotogramas locales para estos fondos; no se extiende,
  repite o recorta la reproducción de la escena. Los clips creator conservan sus
  offsets y el hook pasa a la primera escena después del creator.
- Headline/CTA se ajustan a dos líneas con la fuente local; textos extremos se
  reducen de tamaño antes que ocultar texto. Laterales 84/108 px, base 350 px;
  subtítulos reservan más espacio. Logos se muestran tal como fueron aportados.
- Sin medios: fondo gráfico sobrio. Sin logo: businessName pequeño. Contacto
  sólo desde brand validado. Offer/price/featureLabels son overlays pequeños.

Nuevos briefs IA externos usan V2. El Director conserva templates explícitos
(incluyendo V1); CITAYA mantiene su selección/UI existente. El default del catálogo
sigue V1 para configuraciones legacy que omiten template. No hay migración.

Ver [evidencia y límites](../../docs/modern-business-renderer.md).
