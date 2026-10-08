# CIT-126 — análisis visual privado

Base del parche de cierre: `a18f91ea9ccd5654278cddba5c6f246f882ad806` (PR #109).
Esta implementación no instala modelos, servicios ni cambios de producción.

## Arquitectura y autorización

`video_assets → approval exacto → cola de análisis → snapshot privado → extract_frames → VisionProvider → finish_analysis → visual_inventory → Director`

- Se conservan `AnalysisMixin`, las tablas y los constraints del Bloque 2.
  No hay migración SQL ni otra identidad para el asset.
- `analysis_worker.run_one` reclama un job y trabaja secuencialmente. La CLI usa
  `flock` por storage root para impedir dos workers locales simultáneos.
- Solo procesa `strategy_version=visual-local-v2-frames3` y
  `extractor_version=frames-v1`. Enqueue sigue separado de la ejecución.
- Comprueba aprobación/hashes antes de extraer, después de extraer y al publicar.
  Copia el original a staging privado y verifica su SHA antes de extraer; el
  extractor no puede leer una versión cambiada del original durante la inferencia.
- Usa el extractor existente, máximo 3 frames por asset, 1 para imágenes,
  proxies de hasta 1280 px. Conserva el máximo de 256 frames por publicación.
  Los jobs anteriores `visual-local-v1-frames6` no se reinterpretan: este worker
  los rechaza con `ANALYSIS_VERSION_UNSUPPORTED`; encolar un job con estrategia
  nueva y otra idempotency key para ejecutar tres frames.
- Un heartbeat con conexión SQLite propia renueva el lease cada tercio del
  intervalo. La publicación conserva el fencing transaccional del Bloque 2.
- El worker solo acepta imágenes/videos. Audio/captions en el approval producen
  `ANALYSIS_MEDIA_UNSUPPORTED`; seleccionar un conjunto visual para esta cola.
- Publicación atómica de frames/resultados; cleanup de staging al terminar.
  Un fallo técnico hace fallar el job completo, sin resultados parciales de otros
  assets ni fallback semántico. Retry conserva identidad y utiliza otro lease.

Ejemplo interno, con un `Actor` construido por el adaptador autenticado:

```python
from analysis_worker import STRATEGY_VERSION, EXTRACTOR_VERSION

approval_id = studio.approve_media_set(actor, project_id, approved_visual_asset_ids)
job_id = studio.enqueue_analysis(
    actor, project_id, approval_id, "review-request-1",
    strategy_version=STRATEGY_VERSION, extractor_version=EXTRACTOR_VERSION,
)
```

No se expone approve/enqueue a Next ni se considera `mediaApproved` autorización
de análisis. Esa bandera anterior sigue siendo una aprobación separada del render.

## Contrato del modelo y evidencia

`schemas/media-analysis.schema.json` es general, cerrado y versionado como
`media-visual-v1`. Todos los campos estructurales son obligatorios; pueden usar
`unknown`, listas vacías o resumen vacío cuando no existe información suficiente.

```json
{
  "summary": "Una persona trabaja con una herramienta sobre una pieza.",
  "shotType": "medium",
  "orientation": "vertical",
  "setting": ["workshop"],
  "subjects": ["person", "workpiece"],
  "actions": ["tool_work"],
  "quality": {"lighting": "good", "focus": "good", "stability": "unknown"},
  "roleCandidates": ["process", "service"],
  "evidence": [{"frameRef": "evidence-1", "supports": ["tool_work"]}],
  "unknowns": []
}
```

Resumen máximo 400 caracteres, etiquetas 60, hasta 6 evidencias. Arrays y enums
están limitados en el schema; se rechazan claves adicionales, JSON duplicado,
NaN, HTML, rutas, URLs y fragmentos de código. No hay `confidence`.
Los filtros de texto no pueden demostrar que una frase natural carezca de
intención maliciosa: el Director también trata toda observación como datos y sus
únicas selecciones aceptadas pertenecen a una lista autorizada por el servidor.

`VisionProvider.analyze_asset` recibe solo JPEG bytes ordenados y un brief opcional
de hasta 1000 caracteres. El worker no envía brief, identidad, archivos originales,
hashes ni rutas. El provider construye referencias efímeras `evidence-1..6`.
No incluye tools; el sistema trata texto/QR/carteles como contenido y rechaza
respuestas con tool calls. No identifica personas ni afirma escenas no observadas.

El servidor deriva orientación desde los proxies. Estabilidad queda `unknown`
porque los frames estáticos no bastan para medirla. `complete` significa contrato
suficiente y evidencia enlazada; no garantiza exactitud factual del modelo.

- `complete`: observación válida, evidencia válida, plano/iluminación/enfoque
  definidos y sin incertidumbres declaradas.
- `partial`: incertidumbres, campos relevantes desconocidos o referencias
  inválidas descartadas, conservando al menos una evidencia válida.
- `unknown`: sin evidencia válida, sin resumen o sin contenido observado.
  Se vacían las afirmaciones/roles para no convertir falta de evidencia en hechos.
- `failed`: problema técnico de extracción, conexión, contrato, integridad o lease.

`finish_analysis` admite el descriptor antiguo y uno nuevo con `semantic`,
`provider`, `model`, `evidence_sha256`. Este último hash list viene del worker,
nunca del modelo. Debe coincidir con los bytes copiados a almacenamiento final.
Valida otra vez el contrato y resuelve cada referencia a `frameId` y `timestampMs`
de los frames recién persistidos. El modelo no puede proporcionar estos campos.
El JSON conserva `status`, `manifest`, `semantic` y `evidence` resuelta.
Provider: `local-vision`; model: `Qwen3-VL-2B-Instruct-GGUF:Q4_K_M`.
El esquema conserva `original_result_json`, `supersedes_result_id`, revisiones,
autor y fecha de corrección. No se añade UI/API de correcciones.

## Director y compatibilidad

`Studio.visual_inventory(actor, project_id)` verifica proyecto, approvals y
hashes actuales. Proyecta el resultado válido más reciente por asset. Un nuevo
`unknown` reemplaza la observación previa; un approval revocado queda fuera.
El inventario enviado al Director no contiene tenant, paths, hashes ni manifiestos.

`bridge.direct_project` carga el inventario desde Studio, nunca del payload.
`direct_tenant_config(..., visual_inventory=None)` conserva el contrato anterior
cuando no hay análisis. Con inventario, acepta `assetId` opcional solo en escenas
`visualIntent=media`, únicamente para IDs presentes en el contexto aprobado.
Lo convierte a los campos existentes `scene.video` o `scene.media`.
Rechaza clips más cortos que la escena y mantiene los guards de UI interna Citaya.
No cambia las reglas actuales de distribución de duración ni el renderer.

La proyección compacta tiene presupuesto de 12000 caracteres de contexto de
medios; si no caben más observaciones, deja de añadirlas. Solo las incluidas
pueden seleccionarse. No hay scoring ni selección de segmentos internos del clip.

`Studio.update_project` recibe opcionalmente `expected_visual_inventory` y
revalida dentro de la misma transacción que guarda el plan. Una revocación o
cambio de análisis durante la llamada al Director impide guardar el plan obsoleto.
Los callers antiguos siguen funcionando sin ese argumento.

## Proveedor privado y benchmark

La única conexión visual permitida es HTTP a `127.0.0.1`, puerto explícito,
`/v1/chat/completions`. Por defecto 8788; rechaza 3000, 3001 y 8787.
Usa `http.client`: sin DNS, proxies de entorno, redirects, credenciales ni fallback.
Hasta 6 JPEG, 8 MiB por frame, 16 MiB en total, respuesta máxima 64 KiB,
1600 tokens de salida y timeout de socket 180 segundos por intento. Concurrencia inicial 1.
El worker usa **3 frames como máximo por video**; el proveedor permite hasta 6
para comparaciones mediante benchmark. Las imágenes siguen produciendo un frame.

Se permite **un único segundo intento** solo para `VISION_INVALID_JSON`,
`VISION_INVALID_CONTRACT`, `VISION_INVALID_RESPONSE` o `VISION_INCOMPLETE_RESPONSE`.
Reutiliza los mismos frames, referencias y schema; añade una instrucción breve
indicando que la respuesta anterior fue inválida. No guarda, loggea ni reenvía
esa respuesta. Timeout, unavailable, HTTP error, unsafe text, tools y errores de
lease/integridad no habilitan retry. Si falla el segundo intento, propaga su error.
El schema y el fencing de publicación permanecen sin cambios.

`inferenceAttempts` cuenta las solicitudes intentadas (no garantiza que un servidor
indisponible haya inferido). El benchmark lo reporta por asset y total, también si
fallan ambos intentos; `inferenceSeconds` incluye el tiempo acumulado del retry.
Un segundo intento puede casi duplicar la latencia; no garantiza JSON válido.

Una vez disponible un servidor visual local aprobado, desde un checkout de prueba:

```bash
python3 video-production/scripts/benchmark_vision.py \
  --input video-production/inputs/test-fixtures/business.png \
  --input video-production/inputs/test-fixtures/intro.mp4 \
  --max-frames 3
```

El default de la función y de la CLI es 3. Usar `--max-frames 6` solo para comparar.

Benchmarks reales **reportados por el propietario**, Qwen3-VL-2B Q4_K_M en CPU
(no repetidos durante este parche):

| Caso | Inferencia | Total | Resultado | RSS reportado |
| --- | --- | --- | --- | --- |
| 1 frame | ~22.4 s estable, sin desglose | no informado | complete | ~3.9 GiB |
| Video, 6 frames | 136.4 s | 139.2 s | partial | no informado |
| Video, 3 frames, corrida 1 | 61.8 s reportados sin desglose | no informado | VISION_INVALID_CONTRACT | no informado |
| Video, 3 frames, corrida 2 | 40.57 s | 43.12 s | partial | ~4.63 GiB peak |

El diagnóstico inmediato después del contrato inválido produjo JSON correcto.
Estos datos motivan el default de tres frames y el retry limitado; no prueban
que el retry siempre repare el contrato ni generalizan el rendimiento a otros videos.

Para material privado usar copias expresamente aprobadas. El benchmark no crea
approvals ni persiste resultados; solo imprime conteos, errores y latencias por
posición numérica. Añadir `--server-pid NUMERO` permite muestrear RSS del proceso
local cada 100 ms. `serverSampledPeakRssKiB=null` significa no medido, no cero.
`clientLifetimePeakRssKiB` es la marca máxima del proceso cliente, no RAM del modelo.
No sumar ambas métricas como si fueran una medición precisa del sistema.

Worker manual para un storage de prueba previamente creado:

```bash
python3 video-production/backend/analysis_worker.py \
  --storage /tmp/citaya-visual-test-private --once
```

## Referencia histórica de instalación del Bloque 3

La inspección y comandos siguientes pertenecen a la implementación inicial, antes
del benchmark real reportado arriba. No describen una nueva instalación en este parche.

Inspección local inicial: Intel i5-8400T, 6 núcleos, 15860 MiB RAM, aproximadamente
12300 MiB disponibles en ese momento, 910 MiB swap usados. No se encontró
`llama-server` en PATH ni llama.cpp/GGUF en los directorios locales revisados.
La versión local de llama.cpp no está confirmada. No se inspeccionaron secretos
ni se consultó el proveedor de texto. El gateway existente es de texto y queda
sin cambios en 8787. La topología de `docs/ai/LOCAL_AI_CLUSTER.md` es una propuesta,
no evidencia del hardware del nodo que ejecuta el Qwen de texto.

Archivos oficiales propuestos, ambos de Qwen, revisión
`52d6c8ffea26cc873ac5ad116f8631268d7eb503`:

| Archivo | Descarga aproximada |
| --- | --- |
| `Qwen3VL-2B-Instruct-Q4_K_M.gguf` | 1.11 GB |
| `mmproj-Qwen3VL-2B-Instruct-F16.gguf` | 819 MB |

Fuentes: [modelo](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/blob/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf),
[encoder](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/blob/main/mmproj-Qwen3VL-2B-Instruct-F16.gguf),
[multimodal llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md),
[opciones del servidor](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Total aproximado 1.93 GB en disco. **Estimación de planificación, no medición**:
reservar 3–6 GiB para pesos, KV y buffers con contexto 8192 y máximo 512 tokens
por imagen. Medir RSS y presión de memoria antes de mantener dos modelos activos.
No se afirma rendimiento, compatibilidad de un binario local ni capacidad HDR real.

Ubicación propuesta: `/home/verf/apps/citaya-vision-runtime/models/qwen3-vl-2b`.
Binario separado en `/home/verf/apps/citaya-vision-runtime/llama.cpp/build/bin`;
antes de instalar debe fijarse una revisión llama.cpp compatible, comprobar sus
flags y registrar `llama-server --version`. No sustituir el runtime de texto.

Los comandos siguientes son una propuesta **no ejecutada**. Descargar requiere
aprobación explícita del propietario:

```bash
umask 077
VISION_DIR=/home/verf/apps/citaya-vision-runtime/models/qwen3-vl-2b
mkdir -p "$VISION_DIR"
curl --fail --location --proto '=https' --proto-redir '=https' \
  -o "$VISION_DIR/Qwen3VL-2B-Instruct-Q4_K_M.gguf" \
  https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/52d6c8ffea26cc873ac5ad116f8631268d7eb503/Qwen3VL-2B-Instruct-Q4_K_M.gguf
curl --fail --location --proto '=https' --proto-redir '=https' \
  -o "$VISION_DIR/mmproj-Qwen3VL-2B-Instruct-F16.gguf" \
  https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/52d6c8ffea26cc873ac5ad116f8631268d7eb503/mmproj-Qwen3VL-2B-Instruct-F16.gguf
cd "$VISION_DIR"
sha256sum --check <<'HASHES'
089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae  Qwen3VL-2B-Instruct-Q4_K_M.gguf
c3d5afbef5287953acd57b4043d2269456e5761a4eaccb3b71b062996970aea5  mmproj-Qwen3VL-2B-Instruct-F16.gguf
HASHES
```

Servicio futuro propuesto: `citaya-vision.service`, solo `127.0.0.1:8788`, sin
Cloudflare, UI, tools, proxy, logs de prompts ni acceso de red externo.
Verificar estos flags con el binario elegido antes de la prueba aprobada:

```bash
/home/verf/apps/citaya-vision-runtime/llama.cpp/build/bin/llama-server \
  -m /home/verf/apps/citaya-vision-runtime/models/qwen3-vl-2b/Qwen3VL-2B-Instruct-Q4_K_M.gguf \
  --mmproj /home/verf/apps/citaya-vision-runtime/models/qwen3-vl-2b/mmproj-Qwen3VL-2B-Instruct-F16.gguf \
  --alias Qwen3-VL-2B-Instruct-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8788 --parallel 1 --ctx-size 8192 \
  --threads 4 --n-gpu-layers 0 --no-mmproj-offload \
  --image-max-tokens 512 --no-cache-prompt --offline --no-webui --no-agent --log-disable
```

El futuro servicio `citaya-video-analysis-worker.service` tendrá una instancia,
storage privado y red restringida a loopback. No se añadieron/instalaron units.
Durante la implementación inicial no se descargó el modelo ni se ejecutó un
benchmark real. El benchmark reportado posteriormente por el propietario figura
arriba. Este parche no descarga modelos ni cambia servicios o producción.

## Verificación y límites

Tests con modelo fake y FFmpeg/SQLite reales prueban el flujo desde aprobación
hasta selección de un asset por el Director, evidencia real, leases/retry,
cancelación, revocación, hashes, aislamiento, cleanup, contrato y fallback legacy.
La selección por contenido en estos tests verifica el contrato y la conexión;
no demuestra la calidad de Qwen3-VL ni su comprensión de material HDR.

```bash
python3 -m unittest discover -s video-production/tests -p test_vision_provider.py -v
python3 -m unittest discover -s video-production/tests -p test_analysis_worker.py -v
python3 -m unittest discover -s video-production/tests -p test_media_analysis.py -v
python3 -m unittest discover -s video-production/tests -p test_tenant_brief.py -v
python3 -m unittest discover -s video-production/tests -v
python3 -m py_compile video-production/backend/*.py video-production/scripts/benchmark_vision.py
```

Verificación del parche de cierre frames3/retry: **248 tests, 246 aprobados y
los mismos 2 fallos baseline**, reproducidos también en un checkout limpio de
`a18f91ea9ccd5654278cddba5c6f246f882ad806`. Provider: 24/24; worker: 27/27.
`py_compile` y `git diff --check` GREEN. Sin nuevas inferencias contra el modelo real.

Resultado de la implementación inicial: suite Python general **239 tests: 237 aprobados y los 2
fallos baseline indicados abajo**. Las cuatro suites directamente relacionadas
suman 128 tests aprobados (provider 18, worker 24, persistencia 70, Director 16).
Hay 55 tests nuevos respecto de la base. `py_compile`, `git diff --check` y 11
pruebas Node de boundary/upload/render están GREEN en esa verificación inicial.

Dos fallos baseline se reprodujeron en un checkout limpio del merge PR #108:
`test_brief.BriefTests.test_duration_not_silently_defaulted_and_readability_gate`
(no lanza ConfigError) y `test_studio.SafetyTests.test_prior_outputs_unchanged`
(requiere `brag-output/README.md` histórico no versionado).

Límites: no análisis de audio/movimiento completo, detección facial, scoring,
selección de segmentos, renderer nuevo, TTS, UI de enqueue/aprobación/corrección
ni activación automática de análisis. La inferencia en curso puede acabar tras
una revocación, pero no publica. El timeout es de socket, no cancelación remota
garantizada. Un crash abrupto puede dejar staging/derivados privados huérfanos;
los resultados parciales no se publican ni se sobrescriben en un retry.
