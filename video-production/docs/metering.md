# Medición, cuotas y facturación futura

Sin precios, planes ni números comerciales predefinidos.

El renderer guarda modo, resolución, fps, duración, CPU de procesos hijos y wall time, bytes de MP4, hashes y versiones. AI es null/0 porque el motor no llama a un modelo; no se inventan tokens. `Studio.record_ai` recibe conteos reales de un adaptador de proveedor confiable, con provider, local/cloud y request_id idempotente. Nunca aceptar conteos reportados por el navegador como base de facturación.

`video_usage_events` es el ledger inmutable lógico: upload, render_attempt, render_complete y ai. Sus claves son únicas por tenant. `video_usage` agrega por mes UTC previews/finales completados, CPU/wall de todos los intentos, input/output tokens, bytes subidos y bytes de salida. `storage_bytes` refleja bytes añadidos en ese período; `usage()` también devuelve `current_storage_bytes`, calculado desde todos los assets/outputs vigentes. No confundir acumulación mensual con ocupación actual. Borrados/retención necesitan futuros eventos de eliminación y reconciliación del bucket.

Las métricas de render_complete incluyen duración/resolución/modo; render_attempt incluye job/attempt/error. Los fallos y cancelaciones no suman previews/finales exitosos, pero sí consumo real. Una caída abrupta de host puede impedir medir los últimos segundos; un futuro agente de nodo debe reconciliar esos intentos. No interpretar ausencia de telemetría como costo cero.

## Cuotas configurables

Studio recibe un diccionario confiable por tenant. Sin valores, no hay cuotas comerciales impuestas. Soporta max_upload_bytes, max_storage_bytes en ingreso, max_duration_seconds, max_videos_per_month y max_final_renders al encolar, incluyendo trabajos reservados/activos. El ledger permite max_ai_tokens; su reserva debe implementarse antes de llamar al proveedor cuando se añada el adaptador AI. Nunca descartar tokens ya consumidos porque superaron un límite.

Futuras cuotas de salida deben reservar espacio antes del render y reconciliar después. Hoy se miden todos los bytes publicados; el límite de storage se comprueba al subir assets, no se promete un control total de disco del host. El aislamiento del worker debe tener límites operacionales de disco independientes.

## Futuro billing

Calcular precios desde eventos con versión de tarifa/plan y moneda, sin reescribir el ledger. Distinguir consumo técnico de unidades facturables, aplicar idempotencia por job completado y request AI. No crear cobros, suscripciones ni transacciones en esta base. Los precios se decidirán después de observar uso real.
