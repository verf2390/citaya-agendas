# Validación de la corrección media-first

Base: `main`, `b049e93bd69a03937b913d04a4e24af4d1064ebb`.
Rama: `feat/video-studio-media-first-director`.

## Causa raíz

En la base, `_director_visual_intents` en `backend/tenant_brief.py` usaba
`brand.businessName` para habilitar escenas del producto Agenda. `expand_inputs`
en `scripts/production.py` y `compile_composition` en `scripts/compose.py`
repetían esa asociación. El Director elegía además `creator-led-v1` al encontrar
voz, aunque la marca fuese una agencia productora de contenido externo.

`bridge.direct_project` consultaba el inventario, pero el panel no aprobaba ni
encolaba análisis. Sin inventario el modelo podía usar escenas genéricas. El
copy del modelo y el fallback podían promover instrucciones editoriales a texto
visible. El timeline trataba el objetivo como mínimo y añadía su extensión a la
última escena. Las escenas normales no tenían un offset de video validado.

El contrato y las decisiones finales están en
[media-first-director.md](media-first-director.md). No se desplegó, reinició,
mergeó ni modificó storage real. Las pruebas usan medios y SQLite temporales.

## Archivos del cambio

- Panel/API: `app/admin/videos/page.tsx`, `app/api/admin/videos/route.ts`.
- Adaptador/flujo: `lib/video/studioBridge.ts`, `lib/video/directorFlow.mjs`.
- Backend: `video-production/backend/analysis_worker.py`, `bridge.py`,
  `director_analysis.py`, `media_analysis.py`, `studio.py`, `tenant_brief.py`.
- Contratos: `video-production/schemas/tenant-video-config.schema.json`,
  `video-config.schema.json`.
- Producción: `video-production/scripts/business_modern.py`, `compose.py`,
  `editorial_contract.py`, `production.py`, `tts_contract.py`.
- Python tests: `video-production/tests/test_brief.py`, `test_business_modern.py`,
  `test_media_first_flow.py`, `test_studio.py`, `test_tenant_brief.py`.
- Node tests: `tests/cit126-video-admin-ui.test.mjs`,
  `tests/cit126-video-director-flow.test.mjs`.
- Documentación: `video-production/docs/analysis-persistence.md`,
  `tenant-video-flow.md`, `visual-analysis.md`, `media-first-director.md`,
  `media-first-validation.md`.

## Alcance de las pruebas

La integración Diego Videla usa uploads y extracción de frames reales, el
worker existente, aprobaciones exactas, hashes, inventario persistido, bridge,
materialización, validador de producción, renderers y mezcla de audio. Sustituye
los modelos por fixtures deterministas y el despertar del proceso por ejecución
directa del mismo worker: no certifica la precisión del Qwen instalado ni
ejecuta inferencia contra servicios reales.

El caso produce 10,63 s para una voz de 10,13 s, conserva assets reales y rechaza
instrucciones editoriales como titulares. Las demos explícitas de Agenda tienen
regresiones de routing, validación y composición. Los tests de offsets usan
ffprobe y verifican ambos renderers, segmentos repetidos y frames de apertura/cierre.

No hay detección automática precisa de cortes: con tres frames el Director usa
offset 0. Los offsets explícitos son admitidos y validados; falta un editor de
segmentos en el panel. Proyectos antiguos que dependían del nombre CITAYA deben
seleccionar explícitamente su contexto de producto; no se migran datos reales.

## Preparación y comandos

El test histórico `SafetyTests.test_prior_outputs_unchanged` requiere los archivos
ignorados por Git de `brag-output*`. En este entorno viven en
`/home/verf/local-artifacts/citaya-agendas`. Se verificaron los 657 hashes del
manifiesto antes de enlazarlos para lectura desde el worktree. La primera
ejecución encontró los archivos ausentes; no se omitió ni debilitó ese test.
Los enlaces de apoyo no forman parte del commit ni modifican los originales.

Desde la raíz del repositorio:

```bash
python3 -m unittest discover -s video-production/tests -v
node --test tests/cit12*-video*.test.mjs tests/security/cit126-video*.test.mjs
node_modules/.bin/eslint app/admin/videos/page.tsx app/api/admin/videos/route.ts lib/video/studioBridge.ts lib/video/directorFlow.mjs tests/cit126-video-director-flow.test.mjs
python3 -m py_compile video-production/backend/*.py video-production/scripts/*.py video-production/tests/*.py
git diff --check
node_modules/.bin/tsc --noEmit --incremental false
```

TypeScript global devuelve 80 errores preexistentes. Se ejecutó también sobre
`main` en la base obligatoria y los logs son idénticos byte por byte; no hay
errores nuevos del cambio. Ese chequeo global no se declara GREEN.

## Resultado final (2026-10-09)

| Comprobación | Resultado |
| --- | --- |
| Suite Python completa, con preparación histórica corregida | 333 tests, OK, exit 0 |
| Node de Video Studio, flujo del panel y límites de seguridad | 25 tests, 25 pass, 0 fail, 0 skipped, exit 0 |
| ESLint de los archivos JS/TS del cambio | Sin errores ni warnings, exit 0 |
| `py_compile` de backend, scripts y tests | Exit 0 |
| `git diff --check` | Exit 0 |
| TypeScript global y comparación con la base | Exit 2, 80 errores idénticos a `main`; sin errores nuevos |

Los logs de la sesión están en `/tmp/citaya-media-first-resumed-python-green.log`,
`/tmp/citaya-media-first-resumed-node.log`,
`/tmp/citaya-media-first-resumed-eslint.log`,
`/tmp/citaya-media-first-resumed-tsc.log` y
`/tmp/citaya-media-first-resumed-base-tsc.log`.
