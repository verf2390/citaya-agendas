# CIT-122 · Brief → Qwen local → preview

`create-from-brief.py` convierte un brief de texto en un config normalizado de Video Studio usando el contrato `citaya-ai-provider-v1`. Sólo invoca el gateway configurado; nunca llama directamente a llama.cpp ni a un proveedor cloud. No necesita Codex en tiempo de ejecución.

## Preparación

Usar las dependencias de [Video Studio](../README.md#preparación-local). El script lee estas variables del entorno del proceso, con fallback a `.env.local` de la raíz; no imprime ni copia ese archivo:

- `CITAYA_AI_PROVIDER`: `local` o `hybrid`; esta herramienta usa exclusivamente local.
- `CITAYA_AI_LOCAL_ENDPOINT`: por defecto `http://127.0.0.1:8787/v1/generate`. También acepta gateway HTTPS. No acepta credenciales en URL ni redirects.
- `CITAYA_AI_LOCAL_MODEL`: `Qwen/Qwen3-4B-GGUF:Q4_K_M` (default y modelo requerido).
- `CITAYA_AI_LOCAL_AUTH_TOKEN`: credencial del gateway, sólo si éste la requiere. Se envía como Bearer en el header, nunca al prompt ni al renderizador.

La credencial upstream permanece en el gateway. El gateway existente mantiene su timeout de 60.000 ms. `--timeout` controla únicamente la espera HTTP del cliente (70 segundos por defecto), no el timeout upstream. Esta implementación no modifica el gateway.

## E2E manual desde la raíz

Comprobar rama y disponibilidad:

```bash
git branch --show-current
curl --fail --silent --show-error http://127.0.0.1:8787/health
```

La rama debe ser `feat/cit-122-video-brief-qwen`. Generar solamente el config:

```bash
python3 video-production/scripts/create-from-brief.py --config-only "Haz un Reel de 20 segundos para promocionar Citaya Agendas para una barbería. Quiero destacar reserva online, elección de profesional y fecha/hora. Termina invitando a probar Citaya."
```

Resultado esperado: producto `citaya-agendas`, nicho `barber`, duración `20`, capacidades `online_booking`, `professional_selection`, `date_time_availability`, CTA invitando a probar Citaya. El copy puede variar con el modelo. El comando imprime la ruta del config y retorna 0 sólo después de `production.validate(..., "preview")`.

Generar el preview completo, sin editar JSON:

```bash
python3 video-production/scripts/create-from-brief.py "Haz un Reel de 20 segundos para promocionar Citaya Agendas para una barbería. Quiero destacar reserva online, elección de profesional y fecha/hora. Termina invitando a probar Citaya."
```

Esto realiza una nueva generación y llama a `generate-video.py --mode preview`: checks existentes de layout/runtime/contraste, MP4 720×1280 a 24 fps y verificación con FFprobe. La ruta de `final.mp4` se imprime al terminar; ese nombre de archivo también se usa para previews y **no significa modo final**. No hay flag de final ni de aprobación en `create-from-brief.py`. Un final sigue requiriendo revisión humana y `generate-video.py --mode final --approve-final`; la cola conserva su aprobación explícita de un preview vigente.

## Presupuesto y contrato reducido

1. Clasificación: sólo IDs de productos, nichos y tipos existentes, más `durationSeconds`; `maxOutputTokens=128`.
2. Config: producto/nicho/tipo/duración ya seleccionados y hasta **ocho** capacidades candidatas, con ID/nombre/status; `maxOutputTokens=256`. El modelo devuelve únicamente `hook`, `secondaryHook`, `cta` y de una a cuatro capacidades. No recibe el schema completo ni las 77 capacidades.

La selección local reutiliza producto, `alsoAppliesTo`, nichos, status, permiso comercial y gates del catálogo. Ordena por coincidencia de palabras del brief con ID, nombre y beneficios. Publicidad recibe sólo capacidades `live/demo`, comerciales y sin gates pendientes. `roadmap/concept` permite propuestas futuras; `production.py` aplica sus avisos y restricciones de CTA. Este flujo no acepta perfiles comerciales ni aprobaciones del modelo.

Cada petición usa un contexto nuevo (`continuation=null`, `tools=[]`) y termina con `/no_think`. El máximo es 3.000 bytes UTF-8 de texto de prompt, más reserva de 256 tokens para framing y el presupuesto de salida, por debajo de `n_ctx=4096` incluso usando la cota conservadora de un token por byte. No es una medición del tokenizer: el uso real se guarda desde el gateway. Brief máximo: 1.200 bytes UTF-8, sin truncamiento silencioso. Un JSON inválido o rechazado por validación permite una sola regeneración por etapa, sin acumular respuestas anteriores. Errores de red/autenticación/upstream no se reintentan automáticamente.

La duración solicitada se convierte en `timing` localmente; `production.py` verifica suma y legibilidad de escenas. Un brief incompatible con las capacidades, duración o medios permitidos falla sin renderizar. La clasificación no es un verificador semántico: revisar también que copy y capacidades reflejen el brief. Videos de negocios externos con marca/medios requieren el flujo de config revisado existente; no se inventa una marca para hacer pasar la validación.

## Evidencia y fallos

Cada ejecución crea `outputs/briefs/<UTC>/` y conserva:

- `brief.txt`: texto original aceptado, sin recortarlo ni reescribirlo.
- `classification.json`: clasificación validada, si se completó esa etapa.
- `generated-config.json`: config normalizado, sólo si pasó validación.
- `validation-report.json`: resultado del validador, hashes de catálogo, duración y modo.
- `ai-usage.json`: modelo, estado, etapas, intentos, tiempo por llamada, bytes de prompt, límite de salida y tokens reportados; también se escribe al fallar. `usageComplete=false` distingue uso no reportado de un cero medido.

No se guardan headers, tokens, prompts con historial ni respuestas crudas del gateway/modelo. Los artefactos quedan ignorados por Git. El renderizador recibe el entorno permitido de `production.process`, sin heredar secretos de la aplicación. Las propuestas de herramientas se rechazan y nunca se despachan. Campos de medios, shell, approvals o perfiles comerciales ajenos al contrato también se rechazan.

| Error | Acción |
| --- | --- |
| HTTP 400 | Revisar versión de contrato, modelo y límites de petición. |
| HTTP 401 | Revisar la credencial **del gateway** en el entorno; no pegarla en el brief. |
| HTTP 502 | Revisar en el gateway disponibilidad/autenticación upstream, modelo y contexto de llama.cpp. El status no identifica por sí solo la causa. |
| HTTP 504 | El gateway agotó su plazo: acortar brief o reducir carga local. Aumentar `--timeout` no amplía el plazo del gateway. |
| `CONTEXT_BUDGET` | Resumir el brief; no se envió una petición que exceda el límite local. |
| `INVALID_PROPOSAL` | Consultar código del validador en `ai-usage.json`; no se renderizó ni se guardó un config inválido. |
| `PREVIEW_FAILED` | Config y métricas IA siguen disponibles. Revisar logs del directorio de render impreso. |

## Pruebas sin Qwen

```bash
python3 -m py_compile video-production/scripts/*.py video-production/backend/*.py video-production/tests/*.py
python3 -m unittest discover -s video-production/tests -v
```

`test_brief.py` levanta un gateway HTTP simulado en loopback con respuestas controladas; no necesita Qwen, credenciales, gateway real ni renderizado. Cubre contrato HTTP, presupuesto, selección, gates, duración, reparaciones acotadas, fallos, métricas, credenciales, tools y preview por defecto. Las pruebas existentes siguen comprobando aprobación final y preservación de originales Brag.

## Verificación realizada · 2026-10-04

En `feat/cit-122-video-brief-qwen`, con el gateway y modelo locales indicados, ambos comandos E2E anteriores terminaron con código 0:

| Ejecución | Entrada/salida IA | Tiempo IA | Resultado |
| --- | --- | --- | --- |
| `--config-only` | 782 / 79 tokens | 21,990 s | Config validado; las tres capacidades solicitadas, duración 20 s. |
| Preview por defecto | 782 / 77 tokens | 8,443 s | MP4 720×1280, 24 fps, 480 frames, 20 s; H.264 + AAC. |

Ambas completaron clasificación y config al primer intento. Estos tiempos son observaciones locales, no garantías: carga y caché del modelo pueden variarlos. El render duró 84,864 s, terminó en modo `preview`, pasó los checks existentes y la decodificación FFmpeg; se inspeccionó el poster. No se produjo un final de entrega.

Evidencia local ignorada por Git, relativa a `video-production/`:

- Config-only: `outputs/briefs/20261004T152114.522447Z/`.
- Brief/config/métricas del preview: `outputs/briefs/20261004T152412.986960Z/`.
- MP4, poster y reportes del preview: `outputs/20261004T152421.605276Z-citaya-agendas-preview-1815cd/`.

`py_compile` pasó y la suite completa aprobó **58 pruebas** (37 existentes + 21 nuevas). Se verificaron hashes/conjunto de archivos originales Brag mediante la suite existente. El gateway, `production.py`, catálogos y aprobación final quedaron sin cambios.
