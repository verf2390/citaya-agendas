# CIT-127 — renderer moderno de negocios externos

Base: `befa4400827ea515302153f2b9c7dacc9447c9cc` (PR #110).
Rama: `feat/cit-127-modern-business-renderer`.

## Arquitectura y compatibilidad

`config validado → compose.py → business_modern.py → business-modern.css → HyperFrames → finalize_video.py`.

`local-business-promo-v2` registra renderer `business-modern`, versión 2, sólo
para `custom-client-video`. `compose.py` incorpora únicamente el despacho de V2;
el código legacy permanece intacto. El nuevo renderer copia sólo GSAP, Geist y
medios seleccionados, sin assets de UI ni logo de CITAYA.

Capas: medio `cover` ocupando el lienzo, cámara suave sobre wrapper no temporizado,
gradiente, copy editorial, marca y subtítulos. HyperFrames controla visibilidad y
reproducción. Cada video conserva `data-start`, `data-duration` y media start;
no se anida dentro de otro elemento temporizado. GSAP pausado y seekable controla
poses de código; no hay JS/CSS recibido desde config. Hard cuts sin solapamientos.

Los intervalos de intro/demo/outro siguen intactos. Sin creator, intro/cierre
reutilizan primer/último medio seleccionado. Un video se usa como fotograma
extraído (primero/último de la ventana de la escena) para esos dos fondos; su
escena reproduce exactamente el tramo validado. Esto evita reproducción extra,
loops o recortes para forzar duración. Creator conserva offsets y audio mezclado
por el motor existente. El hook se difiere después del creator intro.

No cambia `presets.css`, layouts V1/SaaS/website, validadores, mezcla, finalizador,
codec, resolución, proveedor IA ni análisis visual. Los hashes de HTML completo
V1, creator-led, SaaS y website coinciden con PR #110. Además pasa la verificación
histórica de archivos de los videos V1/V2 originales.

## Cambio mínimo al Director

`generate_tenant_config` elige V2 sólo para negocios externos nuevos; CITAYA
conserva V1. `direct_tenant_config` conserva template externo explícito y elige V2
si falta. La rama CITAYA mantiene la selección anterior. No se modifican prompts,
modelos, semántica de assetId, selección video/media ni reglas de duración. El
default del catálogo permanece V1 para preservar configs antiguas sin template.

La prueba de integración usa un gateway simulado para seleccionar un asset por
inventario, resolverlo a un video local validado y compilarlo fullscreen. No se
invocó Qwen ni un servicio de visión durante esta validación.

## Fixture y reproducción local

`configs/examples/local-business-modern.json`: negocio conceptual Estudio Demo,
1 video vertical de 3 s, 2 imágenes, logo, 3 escenas, oferta/precio ficticios y CTA.
Reutiliza `inputs/test-fixtures/business.png`, `intro.mp4` y `logo.png` existentes.
`modern-video-still.png` es el primer frame extraído de ese video. No son fotos de
un negocio: los rótulos de prueba pertenecen a los propios medios. El precio sólo
existe en config de prueba. No hay HDR ni nombres de clientes en el renderer.

```bash
python3 -m unittest discover -s video-production/tests -p test_business_modern.py -v
python3 -m unittest discover -s video-production/tests -p test_tenant_brief.py -v
python3 video-production/scripts/generate-video.py \
  --config video-production/configs/examples/local-business-modern.json --mode preview
```

Con Node/FFmpeg y dependencias locales instaladas, el último comando valida,
compone, mezcla, hace el check, renderiza y verifica el MP4. Los artefactos se
escriben en `video-production/outputs/` (ignorados por Git). Para una revisión
fotográfica, copiar medios aprobados a `inputs/`, sustituir las rutas del fixture
y ajustar scene.duration/timing.demo al video; no usar material stock/generado.

## Evidencia inspeccionada

Preview local de 10 s: **720×1280, 24 fps, 240 frames, H.264/AAC estéreo**. Decodifica
sin errores. Master silencioso intencional: no TTS ni música en este fixture.
Modo final conserva **1080×1920, 30 fps** y el pipeline de encoding existente;
se verificó compilación final, no se exportó un final de entrega.

Los tres JPEG provienen del MP4, no sólo del HTML:

| Frame | Tiempo | Observación directa |
| --- | --- | --- |
| [Inicial](../tests/artifacts/business-modern/initial.jpg) | 0 s | Imagen hasta los bordes, logo pequeño, hook y secundario sobre gradiente; sin tarjeta. |
| [Medio](../tests/artifacts/business-modern/middle.jpg) | 5 s | Video fullscreen, headline legible; etiqueta y oferta/precio pequeños; sin marco. |
| [Final](../tests/artifacts/business-modern/final.jpg) | 9.9 s | Última imagen de fondo, marca secundaria y CTA dominante; sin lámina sólida de cierre. |

El finalizador existente incorpora el poster de 0.9 s al frame cero; se conserva
ese comportamiento. La composición tiene fondo desde 0, con entrada del texto en
0.20 s. Movimiento video dinámico observado: escala 1 → 1.055 durante 3 s. Imagen:
1.02 → 1.08, pan hasta ±0.8%, alternado por índice.

[Reporte del MP4](../tests/artifacts/business-modern/media-verification.json),
[check](../tests/artifacts/business-modern/check-summary.json),
[poses](../tests/artifacts/business-modern/keyframes.json) y
[verificación DOM](../tests/artifacts/business-modern/browser-proof.json).

HyperFrames: runtime/layout/contraste sin errores; 13/13 textos contrastados en
el fixture principal. También pasan minimal, premium, sin medios, creator con
subtítulos y copy al límite del esquema. Comprobación en Chromium: medios
1080×1920 con cover antes de escalar al preview, headlines/CTA de hasta dos líneas,
poses diferentes a distinto tiempo e idénticas al volver al mismo tiempo.

Lint conserva advertencias estructurales: recomienda subcomposiciones para
escenas anidadas/densidad de pistas y reporta reutilización del mismo asset en
intro/escena/outro. Los medios tienen intervalos sin solaparse y se revisaron
los frames exportados. No se debilitaron los gates de layout/contraste.

Suite completa: **261/262 pasan**, con el único fallo preexistente descrito abajo.
Suites enfocadas: **12/12 renderer** y **18/18 tenant/Director**.
[Registro de verificación](../tests/artifacts/business-modern/verification.json).

## Límites y pendientes

- No se aportó una carpeta de medios reales aprobados. La prueba demuestra
  fullscreen, legibilidad, overlays y salida técnica; **queda pendiente validar
  el acabado fotográfico de un anuncio real**. No se afirma calidad de campaña
  basándose en estos fondos de prueba.
- Intro/outro basados en videos son fotogramas con movimiento, no reproducción
  adicional. Hard cuts solamente; no crossfade. Recorte espacial centrado: no hay
  seguimiento de rostros ni encuadres decididos por IA.
- Copy excepcionalmente largo reduce tipografía para conservar dos líneas; no
  inventa, trunca ni reescribe claims. No se añade serif ni fuente remota.
- La suite completa contiene un fallo preexistente:
  `test_brief.BriefTests.test_duration_not_silently_defaulted_and_readability_gate`.
  Reproducido por separado sobre un archive exacto de `befa440` (la expectativa
  de ConfigError para 8 s ya no coincide con ese flujo). No se cambia en CIT-127.
- La prueba histórica necesita los directorios `brag-output*`, externos al repo.
  Se enlazaron los artefactos locales originales sólo para ejecutarla; no se
  incluyen esos enlaces en el commit.

Sin TTS, deploy, producción, publicación ni cambios de Qwen/visión/systemd.
