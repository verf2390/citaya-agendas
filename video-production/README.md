# CITAYA VIDEO STUDIO

Base reutilizable de producción local y backend de referencia para futuro autoservicio Citaya. **JSON validado → plantilla determinista → HyperFrames → FFmpeg → MP4.** Un Qwen local puede redactar configuraciones; no escribe código ni necesita conocer el repositorio.

La base visual/técnica viene de `brag-output-2026-10-03-122343/`. Los originales V1 y V2 permanecen intactos. Esta entrega no despliega `/admin/videos`, no consulta producción y no ejecuta migraciones de Citaya.

## Preparación local

Necesita Python 3.10+, Node 22+, FFmpeg/FFprobe y Chrome headless compatible con HyperFrames. Desde la raíz del repositorio:

```bash
python3 -m venv video-production/.venv
video-production/.venv/bin/pip install -r video-production/requirements.txt
npm ci --prefix video-production
```

La preparación puede requerir red para dependencias/Chromium. El render posterior usa la CLI instalada y assets locales; no invoca un agente cloud ni un modelo. Activar la venv para usar `python3`. El Chrome cacheado que ya usó V2 sirve en esta máquina. Si falta, preparar el navegador con el procedimiento de instalación de HyperFrames antes de procesar trabajos de clientes.

## Crear desde un brief (CIT-122)

Con el Citaya AI Gateway local activo y Qwen3-4B disponible:

```bash
python3 video-production/scripts/create-from-brief.py --config-only "Haz un Reel de 20 segundos para promocionar Citaya Agendas para una barbería. Quiero destacar reserva online, elección de profesional y fecha/hora. Termina invitando a probar Citaya."
```

Quitar `--config-only` genera el preview. No requiere Codex ni escribir JSON manual. Usa dos solicitudes pequeñas (128/256 tokens de salida), capacidades filtradas del catálogo y validación final de `production.py`. Conserva brief original, config normalizado y métricas IA. El modo final sigue requiriendo aprobación humana explícita. Ver [configuración, E2E manual, límites y errores](docs/brief-to-preview.md).

## Crear desde un brief + carpeta de material (CIT-123)

Copia medios revisados a una carpeta dentro de `video-production/inputs/`, idealmente `inputs/projects/<nombre>/`. El sistema detecta logo, fotos, screenshots, clips, creator intro/outro, voiceover, musica, SFX y SRT/VTT por tipo + nombre de archivo; inspecciona contenido, tamano, resolucion/duracion y SHA-256 antes de incorporarlos.

Primero puedes inspeccionar sin IA ni render:

```bash
python3 video-production/scripts/ingest-media.py \
  --dir video-production/inputs/projects/victor-promo
```

Luego:

```bash
python3 video-production/scripts/create-from-brief.py \
  --media-dir video-production/inputs/projects/victor-promo \
  --approve-media \
  "Crea un Reel de Citaya Agendas"
```

`--approve-media` es obligatorio para usar material detectado: confirma revision humana de derechos y privacidad. La IA no recibe los bytes de los medios ni decide su aprobacion. Los medios siguen fuera de Git.

## Generar desde un config

```bash
python3 video-production/scripts/validate-config.py --config video-production/configs/veterinary.json
python3 video-production/scripts/generate-video.py --config video-production/configs/veterinary.json --mode preview
python3 video-production/scripts/generate-video.py --config video-production/configs/veterinary.json --mode final --approve-final
```

Preview: **720×1280**, 24 fps, calidad draft. Final: **1080×1920**, 30 fps, calidad delivery. `--approve-final` es una confirmación del operador; nunca se obtiene desde JSON AI. Para autoservicio, el backend exige además aprobación de un preview vigente antes de encolar final.

Cada ejecución crea `outputs/<UTC-timestamp>-<product>-<mode>-<suffix>/` exclusivo. Incluye `final.mp4`, `poster.jpg`, `normalized-config.json`, `validation-report.json`, `render-metadata.json`, `share-copy.txt`, copia de capacidades, reporte HyperFrames, evidencia de audio y proyecto editable. También genera caption Instagram, texto WhatsApp y ad copy corto. La portada asentada sustituye sólo el primer fotograma, como en V2. Nunca sobrescribe otra ejecución. Un fallo conserva su estado/log en su propio directorio.

`--validate-only` no renderiza. `--prepare-only` compila y mezcla sin renderizar. La validación no ejecuta la aplicación Citaya ni lee archivos de entorno.

## Catálogo de verdad

`catalog/capabilities.json` contiene 77 capacidades con ID, producto, descripción, status, permiso comercial, nichos, beneficios, escenas, pista de UI, notas/evidencia y gates.

- **live**: capacidad comercial verificada dentro del alcance descrito. No significa activación universal por tenant.
- **demo**: sólo comercial si el propietario la aprobó expresamente (`safeForCommercialVideo=true`); el video la etiqueta como demo.
- **in_progress / planned**: bloqueadas en publicidad normal. Sólo `roadmap` o `concept`, con aviso visible permanente, estado por escena y CTA informativo.

Las funciones clínicas completas, odontograma, migraciones, rollout WhatsApp, Growth Copilot, CFO, Meta Ads y otras capacidades futuras quedan bloqueadas. AI se limita a lectura, propuestas y confirmación humana. No se presenta BHE externa como emisión BHE automática. La emisión DTE automática queda **in_progress** de forma conservadora: el runbook local describe canary/gates, no acredita un rollout comercial general. DTE33/39, pagos y campañas sujetos a gates requieren perfil operacional revisado en `catalog/commercial-profiles.json` (vacío por defecto). Un JSON de video no puede activar gates ni cambiar statuses.

Para actualizar: revisar evidencia local/operacional autorizada, editar catálogo manualmente, registrar fecha/notas y alcance, mantener aliases/IDs estables, ejecutar tests. Nunca promover estado sólo porque un modelo lo sugirió o porque existe código. Perfil de gates debe tener `id`, `enabledGates`, `approvedBy`, `evidenceReference`, `reviewDate`, `expiresOn`; usar referencias pseudónimas sin datos privados.

El proyecto Diego Videla Arquitectos se usa **sólo como evidencia** del workflow WordPress: identidad, Home, servicios, estudio, portafolio, contacto, QA y publicación. No se reutilizan nombres del cliente en videos, imágenes, teléfonos, formularios reales ni contenido privado. Las escenas de prueba son ficticias.

## Configurar videos

Ejemplos internos listos:

```bash
python3 video-production/scripts/generate-video.py --config video-production/configs/examples/barber.json --mode preview
python3 video-production/scripts/generate-video.py --config video-production/configs/examples/psychology.json --mode preview
python3 video-production/scripts/generate-video.py --config video-production/configs/examples/website-services.json --mode preview
python3 video-production/scripts/generate-video.py --config video-production/configs/examples/roadmap.json --mode preview
```

Veterinaria, barbería y psicología cambian `niche`, copy y capacidades seleccionadas; no requieren modificar código. También hay beauty, dentistry, massage, healthcare, architecture, local-business y professional-services, restaurant, retail y construction. Barbería usa una UI ficticia específica (`Barbería Demo`, Corte/Barba/Corte + barba y profesionales genéricos) para mantener coherencia visual sin inventar clientes; los demás nichos conservan los fixtures demo genéricos. Los demos de salud no incluyen historias clínicas ni información de pacientes.

`timing` define intro/demo/outro. Por ejemplo `{ "intro":3, "demo":15, "outro":4 }` produce 22 segundos. Cada escena puede especificar duration; la suma debe coincidir con demo. Sin duraciones se distribuye el segmento entre escenas. Se rechazan tiempos que impidan leer las escenas.

## Medios, branding y privacidad

Para operador interno, rutas relativas **a video-production/**: `inputs/logo.png`, `inputs/victor-intro.mp4`. No se aceptan rutas absolutas, traversal, URLs remotas ni SVG subidos. Rutas relativas al directorio de ejecución/config no se infieren. Campos de marca: businessName, logo/logoLight/logoDark, colores hex, website, socialHandle y whatsapp **comerciales públicos aprobados**. Website debe ser HTTPS sin credenciales, query ni fragmento. Contactos privados de clientes están prohibidos.

```json
{
  "product":"custom-client-video",
  "template":"local-business-promo-v1",
  "niche":"veterinary",
  "brand":{"businessName":"Veterinaria Demo","logo":"inputs/logo.png","primaryColor":"#186A61","secondaryColor":"#FFFFFF"},
  "media":{"images":["inputs/local.jpg"],"creatorIntro":"inputs/victor-intro.mp4","creatorVoiceover":"inputs/voz.wav"},
  "content":{"hook":"Conoce nuestros servicios","benefit":"Atención para tu mascota","cta":"Conversemos","finalTagline":"Veterinaria Demo"},
  "creator":{"voiceoverStart":3},
  "timing":{"intro":3,"demo":15,"outro":4},
  "mediaPolicy":{"useOnlyProvidedAssets":true,"allowStockMedia":false,"allowGeneratedMedia":false},
  "mediaApproved":true,
  "audio":{"music":true,"sfx":true,"duckMusicDuringVoice":true}
}
```

Las rutas del ejemplo requieren archivos reales revisados. `mediaApproved=true` sólo después de revisar privacidad y permisos. Logo y fotos nunca se buscan ni se inventan. Un negocio externo sin imágenes obtiene texto, no una falsa foto de su local. Una ruta opcional ausente/null usa fallback animado; si se indicó un archivo que falta, falla claramente en vez de ignorarlo. Inspección manual: `python3 video-production/scripts/inspect-media.py --path inputs/logo.png --type image`.

## Victor, voz y subtítulos

`media.creatorIntro`/`creatorOutro` aceptan MP4/MOV/WebM; sin intro, aparece el hook animado. `creator.introOffset`/`outroOffset` seleccionan el inicio del clip. La duración debe cubrir el segmento. Audio del clip se conserva en el master local salvo `creator.useClipAudio=false`; el video visual está muted para evitar duplicarlo.

Una voz: `media.clientVoiceover` **o** `creatorVoiceover`; alias `creator.voiceover`. `voiceoverStart` ubica la grabación en el timeline completo. Si se superpone a audio de intro/outro, se rechaza: mover el inicio o desactivar audio de clips. No hay TTS obligatorio. Música: instrumental original incluido o `media.backgroundMusic`. `media.soundEffects` opcional. FFmpeg normaliza voz, atenúa la música dinámicamente y reduce la banda de voz de 250–3200 Hz; la música vuelve con suavidad durante pausas/final. No se heredan credenciales de proveedores.

Subtítulos: `{ "enabled":true, "srt":"inputs/captions.srt" }` o `vtt`. Tiempos absolutos sobre todo el video, sin solapamientos, máximo dos líneas por cue. Preparado para un adaptador futuro de whisper.cpp, no instalado ni requerido. Ver [contrato AI](docs/ai-contract.md).

## Sitios, antes/después y ofertas

`website-showcase-v1` y la variante compatible `citaya-websites-vertical-v1`: desktop, mobile, homepage, services, about, portfolio, contact y technical. Para proyectos de clientes, suministrar screenshot por escena o grabación `scene.video`; no hay captura automática de URLs privadas. El esquema `scenes` enlaza cada escena con su capacidad. En custom-client-video usar `provided_business_content` y aportar medios aprobados.

`before-after-v1`: dos imágenes `beforeMedia` y `afterMedia` obligatorias para clientes. Nunca inventa un “antes” del negocio. `offer-promo-v1`: content.offer, price, benefit, featureLabels y CTA suministrados/revisados; no inventa descuentos. `creator-led-v1` conserva el mismo contrato de medios y tiempos. Los presets reutilizan código de animación determinista; no son videos únicos.

## Backend y worker

[Arquitectura](docs/architecture.md), [flujo tenant/API](docs/tenant-video-flow.md), [seguridad](docs/security.md), [medición](docs/metering.md).

```bash
python3 video-production/backend/worker.py --storage video-production/storage/private --node render-1 --once
```

La cola debe llenarse desde un adaptador autenticado mediante `Studio`. No hay endpoint de render público ni autenticación falsa. El backend local implementa proyectos, assets, jobs, outputs, aprobaciones, ledger e índices/FKs por tenant. Para ver un flujo completo de pruebas sin producción: `python3 video-production/tests/queue_smoke.py`.

La futura UI Next.js y el adaptador de Auth/storage están documentados pero **no desplegados**. Antes de habilitar clientes: conectar guards Citaya, uploads privados, límites operacionales, aislamiento de worker y descargas autorizadas. No se requiere Kubernetes. Pricing y cuotas comerciales permanecen sin valores inventados.

## Verificación

```bash
python3 video-production/tests/make_fixtures.py
python3 -m unittest discover -s video-production/tests -v
```

Fixtures de medios sintetizados y etiquetados como pruebas; no son Victor ni un cliente real. Las pruebas cubren schema, verdad, medios, voz/captions, aislamiento A/B, FKs, aprobación final, idempotencia, cancelación, fencing, uso y hashes V1/V2. `tests/preview-results.json` registra previews reales realizados. Las pruebas de contrato no renderizan finales 1080p. Revisar visualmente los previews propios antes de aprobar final.

Para ampliar producto/plantilla/nicho/nodo, seguir [arquitectura](docs/architecture.md). No introducir lógica nueva por cada guion: un modelo local sólo produce JSON revisable.

Ejemplo de despliegue con usuario dedicado y red privada: `ops/citaya-video-worker.service.example` (no instalado ni activado; validar límites y cache de Chromium antes de usarlo). Los videos de contenido/b-roll están silenciados; el audio de intro/outro y la voz se mezclan explícitamente.

Resultado de esta entrega: **37 pruebas aprobadas**, previews reales de Agendas, web, creator-led y negocio externo mediante cola privada; ningún final 1080p generado durante desarrollo. Evidencia: [resumen](tests/verification-summary.json), [previews](tests/preview-results.json), [tests](tests/test-results.txt). V1/V2 conservan todos sus hashes y el mismo conjunto de archivos.

## Renderer moderno de negocios externos (CIT-127)

`local-business-promo-v2` usa media fullscreen y overlays con CSS/renderer aislados. Nuevos briefs IA externos lo seleccionan; templates explícitos y defaults legacy conservan V1. Ver [arquitectura, preview, evidencia y límites](docs/modern-business-renderer.md).
