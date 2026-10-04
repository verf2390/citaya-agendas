# Autoservicio y contrato del adaptador Citaya

Futura ruta `/admin/videos`: Crear video, Mis videos, Plantillas, Borradores, Procesando, Listos, Uso del mes.

1. Elegir tipo (promoción, servicio, campaña, sitio web, oferta, antes/después, educativo, creator-led).
2. Elegir plantilla registrada.
3. Subir logo, imágenes, grabaciones y audio opcional a staging **privado**.
4. Elegir objetivo y contenido público del negocio.
5. AI propone sólo JSON conforme al schema, con referencias `asset:<uuid>` recibidas del servidor.
6. Usuario revisa textos, precios/oferta, medios, derechos y privacidad.
7. Solicitar preview. La API valida y encola; responde 202 con ID, no renderiza.
8. Revisar preview completo y pulsar Aprobar.
9. Solicitar final. La API consume la aprobación del preview/configuración actuales.
10. Descargar artefactos autorizados o compartir manualmente.

## Contrato HTTP futuro (no desplegado)

| Operación | Servicio privado | Regla |
|---|---|---|
| POST /api/admin/videos/projects | create_project | Actor autenticado, producto custom-client-video |
| GET /api/admin/videos/projects | list_projects | Sólo actor.tenant_id |
| PATCH /api/admin/videos/projects/:id | update_project | Revision nueva, invalida aprobación |
| POST /api/admin/videos/projects/:id/assets | upload | Archivo temporal del servidor, nunca ruta enviada por cliente |
| POST /api/admin/videos/projects/:id/validate | validate_project | Schema + medios + tenant/proyecto |
| POST /api/admin/videos/projects/:id/previews | enqueue(preview) | Idempotency-Key requerido |
| POST /api/admin/videos/previews/:id/approve | approve_final | Acción humana autenticada explícita |
| POST /api/admin/videos/projects/:id/finals | enqueue(final) | Aprobación vigente y no consumida |
| POST /api/admin/videos/jobs/:id/cancel | cancel | Scope tenant, estado permitido |
| GET /api/admin/videos/outputs/:id/download | download_path + streaming | Autorizar antes de abrir archivo; Cache-Control: private, no-store |
| GET /api/admin/videos/usage | usage | Sólo ledger del tenant |

El adaptador debe validar sesión y membresía vigente usando los guards existentes de Citaya, verificar origen/CSRF para mutaciones, aplicar rate limits técnicos, mapear NOT_FOUND a 404 sin revelar existencia y filtrar campos internos de las respuestas. `Actor` es contexto confiable de servidor, no un mecanismo de autenticación autónomo. No montar esta biblioteca como API sin ese adaptador.

## Proyección permitida para AI

Únicamente nombre comercial, categoría, identidad visual, URL pública de reservas/sitio, contactos comerciales aprobados, servicios habilitados, precios **públicos** y nombres de profesionales expresamente aprobados como públicos. La proyección debe derivarse del tenant del guard, nunca de un ID elegido por AI. No se conecta automáticamente a datos de Citaya en esta implementación. `backend/business_projection.py` implementa la proyección pura y comprobada por tenant, lista para que el adaptador le suministre únicamente registros autorizados.

Excluir clientes, citas, teléfonos/correos de clientes, notas privadas, historias clínicas, credenciales, pagos privados, certificados, CAF y artefactos DTE. No enviar dumps de tablas al modelo. La API entrega assets disponibles mediante IDs, roles, dimensiones y duración, no credenciales o rutas de storage.

## Descargas y almacenamiento

Implementación local: permisos privados, directorios por tenant/proyecto y consulta autenticada del output antes de streaming. No se sirven uploads con un servidor estático. Futuro bucket privado: API autoriza tenant/proyecto/output antes de emitir un signed URL de corta duración (por ejemplo una duración técnica configurable); los URLs no se persisten en configs ni se pasan a AI. Un enlace firmado es un bearer temporal, por lo que el proxy autenticado es preferible cuando se necesita revocación inmediata.
