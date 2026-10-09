# Video Studio: medios reales y Director

Implementación sobre `b049e93` (incluye PR #118). No requiere otra cola,
base de datos ni servicio HTTP. No despliega ni migra proyectos existentes.

## Producto y marca

`brand.businessName` identifica al productor; nunca habilita UI de Agenda.
El autoservicio sigue usando `product=custom-client-video`. Para demos reales
de Agenda se selecciona explícitamente `project.productContext=citaya-agendas`.
El valor por defecto es `external`. El CLI interno conserva su producto
`citaya-agendas`. Los proyectos antiguos que dependían del nombre deben elegir
el contexto de Agenda en el panel; no se infiere ni migra automáticamente.

`videoType=website_showcase` identifica un showcase de web real. No requiere
otra plantilla: utiliza `local-business-promo-v2` / `business-modern` con imágenes
y videos reales. Homepage, projects/portfolio, about, services y contact son
contenido observado para ordenar los medios, no pantallas sintéticas.

## Flujo de /admin/videos

1. Subir material privado, revisar copy/derechos y seleccionar roles.
2. La casilla **Autorizo a Qwen Visual local…** autoriza el análisis de las
   imágenes/videos seleccionados. Es distinta de `mediaApproved` y se reinicia
   al cargar/guardar el editor. Audio y subtítulos nunca entran a Qwen Visual.
3. **Dirigir con IA** guarda config y brief. El flujo compartido
   `lib/video/directorFlow.mjs` llama a `prepare_direction` con consentimiento y
   el conjunto exacto de IDs visibles. El servidor recalcula ese conjunto.
4. `director_analysis.prepare_direction` consulta el inventario aprobado y
   vigente. Para los assets faltantes llama a `approve_media_set` y
   `enqueue_analysis`, conservando snapshots SHA, aislamiento y versiones.
5. Despierta **el mismo** `analysis_worker.py --once --job-id …`, en un proceso
   separado de la petición, con el mismo lock global. Solo reclama ese job;
   puede coexistir con el daemon existente. Polling cada 3 s reintenta despertar
   jobs en cola si otro worker tiene el lock. No se inicia ni reinicia un servicio.
6. El panel muestra **Analizando medios…**; consulta
   `direction_analysis_status` bajo autenticación/origen/rate limit existentes.
   No publica rutas, hashes, observaciones, lease tokens ni errores del proveedor.
7. Solo `ready` permite llamar al Director. El bridge comprueba nuevamente el
   inventario; el guardado comprueba inventario y revisión para detectar cambios
   durante la inferencia. El modelo textual recibe IDs, metadata y observaciones
   compactas no confiables, nunca bytes de medios ni rutas de storage.
8. Preview → aprobación humana → final conserva el contrato anterior. La
   validación de Studio y el worker de render vuelven a verificar el inventario
   para proyectos media-first, incluidos approvals revocados y hashes cambiados.

Cerrar el panel no cancela el análisis. Reintentar después reutiliza el inventario
válido o el job equivalente activo. Un fallo técnico permite reintento explícito
con nueva aprobación; no hay fallback a dirección sin análisis. Un inventario
`unknown` no autoriza selección: se solicita material con evidencia suficiente.

## Fuentes de activación

La única política canónica persistida es `mediaPolicy.mediaFirst`. La decisión
efectiva es `mediaPolicy.mediaFirst === true OR videoType === website_showcase
OR detector_textual(brief)`:

1. **`mediaPolicy.mediaFirst=true` estructurado:** decisión explícita y
   autoritativa. La casilla **Usar únicamente los medios proporcionados** está
   disponible al crear y editar; se guarda en config, se restaura al reabrir y
   se conserva al editar otros campos. El Director usa la config guardada.
2. **`website_showcase`:** obligatorio incluso con flag ausente o `false` y
   texto neutro. El panel muestra la casilla activa y bloqueada para ese tipo.
3. **Detector textual:** ayuda de conveniencia / best effort para configs
   anteriores y restricciones reconocidas. Solo puede activar adicionalmente
   la política; ninguna frase puede desactivar las dos fuentes anteriores.

`false` no es un opt-out del showcase ni de una restricción textual detectada.
Las configs antiguas sin flag mantienen su comportamiento. `useOnlyProvidedAssets`
conserva su significado histórico (no stock ni generación); no equivale a
media-first. La casilla tampoco autoriza análisis: ese consentimiento sigue
siendo separado y sujeto a aprobación exacta, hashes y aislamiento de Studio.

La casilla representa la decisión estructurada guardada; un mensaje separado
indica la política efectiva y su fuente. `editorial_contract.media_first_state`
calcula ese resumen con el mismo `media_first` que usa el pipeline, con precedencia
de presentación `website_showcase > structured > brief > none`. Si solo el brief
activa la política, la casilla permanece desmarcada y el mensaje explica esa
activación. Para showcase la casilla se muestra marcada y bloqueada; esa obligación
no sobrescribe un `false` estructurado al editar otros campos.

El panel consulta la acción autenticada `media_first_state` del bridge con el
brief, tipo y decisión explícita del borrador al cargar o editar. Es una lectura
derivada sin abrir Studio, guardar config, analizar medios ni llamar a modelos.
No hay detector textual en JavaScript. La consulta se agrupa tras 400 ms sin
cambios; mientras se recalcula se muestra **Comprobando uso de medios…**, se
descartan respuestas de borradores anteriores y un fallo se muestra como error
de comprobación, nunca como política desactivada. El resumen no se persiste
como una segunda política.

Las actualizaciones API reemplazan la config; no son un deep-merge general.
La excepción es `mediaPolicy.mediaFirst`: si se omite el contenedor, el campo
o se envía `mediaPolicy={}`, se conserva el valor guardado (`true` o `false`).
Solo un booleano explícito cambia esa decisión; tipos inválidos se rechazan
antes de escribir. La lectura/preservación sucede dentro de la transacción
de update, con los mismos controles de tenant, revisión e inventario.
Los demás campos mantienen la semántica de reemplazo. En creación no se hereda
estado: la ausencia del flag conserva el default normal. `website_showcase`
sigue siendo obligatorio, incluso después de guardar `mediaFirst=false`.

El parser de lenguaje natural **no es una frontera de seguridad** ni garantiza
entender todas las paráfrasis, negaciones o recomendaciones del español. El
detector existente conserva sus casos soportados y sus límites; puede tener
falsos positivos o negativos. Para garantizar la restricción del usuario debe
activarse la casilla estructurada. Con esa política o con website showcase,
la ausencia de inventario válido bloquea dirección/render y ninguna respuesta
del modelo habilita escenas genéricas o UI ficticia, incluso en contexto Agenda.

## Media-first y copy

El conjunto de medios visuales incluye tanto `media.creatorIntro/creatorOutro`
como los aliases legacy `creator.introVideo/outroVideo`, deduplicados por asset ID.
Todos pasan por la misma aprobación, análisis e integridad de Studio. El Director
promueve un clip legacy al campo público cuando este no existe; los campos
públicos explícitos conservan precedencia. Materialización y render siguen el
contrato existente, sin accesos alternativos a archivos.

En media-first cada escena es `mode=media` y refiere un asset aprobado con
observación `partial` o `complete`. Un asset desconocido, sin observaciones o
fuera del conjunto seleccionado se rechaza. La introducción y cierre mantienen
frames del primer/último medio cuando no hay clips de creador. No se usan
fondos ficticios, UI de Agenda, stock ni música/SFX incorporados por defecto.
Un draft puede crearse antes de subir medios, pero no puede renderizarse vacío.

Errores seguros: `VISUAL_ANALYSIS_REQUIRED`, `ANALYSIS_APPROVAL_REQUIRED`,
`VISUAL_ANALYSIS_FAILED`, `DIRECTOR_MEDIA_INVALID`, `DIRECTOR_VISUAL_STALE`.
Una respuesta inválida del Director media-first falla; no usa el fallback genérico.

`project.creativeBrief` es dirección editorial. `content.hook`, `secondaryHook`,
`benefit` y `cta` son copy. Etiquetas explícitas equivalentes en el brief pueden
actualizarlos. Durante dirección el copy del modelo no es autoridad: se conserva
el autorizado y cualquier headline ajeno se sustituye por uno de esos campos.
Al crear un draft media-first solo se toman campos explícitos o texto neutro de
identidad, nunca las primeras líneas editoriales del brief. Los límites de copy
y el validador de producción siguen siendo obligatorios.

## Inventario autorizado y presupuesto del contexto

El inventario completo de Studio sigue sujeto a aprobación, hashes, tenant/project
y versiones. El Director valida ese inventario antes de construir el prompt;
`authorized_visual_ids` incluye sus entradas válidas `partial`/`complete`.
La ausencia de una entrada requerida o un estado `unknown` sí produce
`VISUAL_ANALYSIS_REQUIRED`. Un límite del prompt nunca significa falta de análisis.

`model_visual_context` es una representación separada, limitada a los mismos
12.000 caracteres existentes, medidos sobre el JSON compacto realmente enviado.
Primero conserva la proyección descriptiva habitual (resumen hasta 240 caracteres,
listas hasta cuatro entradas). Si no cabe, conserva todos los IDs, tipos,
dimensiones disponibles y duración real de videos; reduce las observaciones a
estado, orientación y una etiqueta observada completa de subjects/actions/setting.
Distribuye el espacio restante entre resúmenes, con una longitud común calculada
determinísticamente hasta el tope anterior de 240 caracteres. No promueve estados
`partial`/`unknown` ni considera las observaciones instrucciones.

No se descartan assets por presupuesto. Si ni siquiera cabe esa representación
mínima de todos los assets expuestos, `DIRECTOR_CONTEXT_TOO_LARGE` bloquea antes
del modelo; hay que reducir la selección. No existe un nuevo límite por cantidad
de assets. La autorización y el conjunto seleccionable siguen separados: solo se
aceptan IDs autorizados y expuestos en esa llamada, con observaciones válidas.
Un asset aprobado anteriormente pero fuera de la selección del editor no es
seleccionable. La llamada de reparación no media-first recibe el mismo contexto
limitado. Las duraciones se validan con metadata original, no con descripciones
compactadas; análisis, frames, approvals y el fencing del guardado no cambian.

## Voz y duración

La voz subida se conserva completa. Comienza en 0 salvo un clip de apertura,
en cuyo caso comienza después. Sin otro clip obligatorio, el total se aproxima
a voz + 0,5 s, respetando mínimos de intro, escenas y outro; las placas sin clip
se limitan a 2,5 s cuando hay voz. Un cierre con audio propio va después de la voz.
`targetDurationSeconds` es un objetivo, no un mínimo para voz grabada.

Se respetan duraciones propuestas dentro del presupuesto. La compresión reparte
proporcionalmente el tiempo por encima del mínimo de 1 s por escena. La extensión
se reparte entre escenas que aún tienen capacidad, nunca toda en la última. Los
videos no exceden su duración disponible; si no hay capacidad se devuelve
`DIRECTOR_MEDIA_TOO_SHORT` en lugar de congelar/extender el clip.

TTS sigue usando estimación previa y comprobación medida en síntesis. El
presupuesto estimado se redondea hacia arriba a décimas (18,95 → 19 s),
sin redondear ni truncar la duración medida del audio. Se conserva
`TTS_DURATION_EXCEEDS_VIDEO` y la normalización monetaria de PR #118.

## Segmentos / Smart Cut

Contrato cerrado: `scene.video = asset:<uuid>`, `scene.videoOffset` (segundos,
finito, >= 0; opcional, default 0), `scene.duration` (positivo, mínimo actual 1 s).
Tras materializar y verificar SHA, el validador usa ffprobe sobre el archivo real:
`videoOffset + duration <= duración real`. No acepta offset sin video ni NaN,
bools, valores negativos o rangos fuera del asset. El mismo asset puede aparecer
en varias escenas con segmentos distintos. No se confía en metadata del modelo.

Ambos renderers que soportan `scene.video` emiten `data-media-start`. En
business-modern los frames de apertura/cierre también respetan los límites del
segmento seleccionado. No hay retiming ni cambio de velocidad.

**Límite deliberado:** Qwen Visual observa como máximo 3 frames por video, sin
una evidencia temporal de segmentos continuos. Por eso el Director solo puede
proponer offset 0; un offset no nulo devuelve `DIRECTOR_SEGMENT_UNSUPPORTED`.
El contrato admite offsets explícitos validados en configs, pero el panel no
incluye todavía un editor de segmentos. No se promete detección automática de
cortes precisos. Para eso hará falta evidencia temporal adicional aprobada.

## Verificación

`tests/test_media_first_flow.py` modela CITAYA / Diego Videla con cuatro imágenes,
un recording de 20 s y voz de 10,13 s. Recorre uploads, aprobación exacta, worker
real, extracción real, SQLite, bridge, Director, materialización, validador,
composición y mezcla de audio. Produce timeline de 10,63 s. Los modelos son
fixtures deterministas: prueba el contrato, no la precisión del modelo instalado.
También prueba fallos, consentimiento separado, tenant y revisión concurrente.
Los tests de business-modern verifican offsets en ambos renderers y los límites
con ffprobe. Node ejecuta el mismo flujo que usa el panel, incluido fallo antes
del Director. Todo usa storage temporal, sin medios/proyectos reales.
