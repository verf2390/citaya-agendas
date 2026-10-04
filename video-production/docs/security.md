# Seguridad y límites de esta base

- No se accede a cuentas, datos de producción, archivos de entorno, certificados ni CAF. Se reutilizan únicamente assets de demostración V2 y evidencia local de código/documentación.
- SQLite y archivos están separados de la aplicación y de su base productiva. Todas las entidades y eventos persistidos tienen tenant_id; FKs compuestas unen tenant + proyecto + job/asset. IDs ajenos devuelven NOT_FOUND.
- El autoservicio acepta IDs opacos, nunca rutas locales, URLs remotas o HTML/JS del cliente. Resolver un asset exige tenant **y** proyecto coincidentes, ubicación privada y SHA-256 idéntico. Se bloquean symlinks fuera de los directorios permitidos.
- JSON Schema rechaza campos desconocidos, tipos incorrectos y comandos. Los textos se escapan antes de entrar en HTML. La composición usa CSP local y JS estático del motor. Subprocess siempre usa listas de argumentos y nunca shell=True.
- No se heredan secretos de la aplicación hacia FFmpeg/HyperFrames. Se suministra un entorno mínimo con Node local; telemetría, autoinstalación y comprobación de actualizaciones se desactivan durante producción. npm/Chromium se instalan durante preparación, no a petición de un tenant.
- `inspect-media.py` verifica existencia, contenedor/streams, tipo raster, dimensiones/duración/bytes. FFprobe sólo permite protocolos file/pipe. Se rechazan SVG/HTML subidos y más de 40 MP como límite de seguridad del decoder; no es una cuota comercial. Captions tienen límites de tamaño/duración. No es un antivirus ni una inspección de PII por visión.
- mediaPolicy por defecto: sólo assets proporcionados, stock false, generated false. No hay búsqueda stock ni generación de imágenes. Un video externo sin imágenes usa tarjetas de texto, nunca imágenes ficticias que aparenten pertenecer al negocio. Sitios demo internos se identifican como demostración.
- mediaApproved significa revisión humana; no prueba automáticamente derechos, privacidad, veracidad de precios ni consentimiento. Los guardrails detectan capacidades planificadas seleccionadas y ciertas menciones obvias, pero no comprenden toda posible afirmación en lenguaje natural o audio. El usuario revisa el guion y medios antes del preview y el final.
- La normalización no modifica el catálogo. Roadmap/concept se marca durante todo el video y en la escena. Los gates tributarios/comerciales exigen un perfil revisado con evidencia, fecha y expiración; no hay ninguno habilitado por defecto. No se afirma rollout universal por encontrar código.
- El worker es un proceso local de confianza. El código no proporciona una sandbox de sistema operativo por sí solo. Antes de exponer autoservicio público se requiere usuario de sistema dedicado, aislamiento de procesos, límites CPU/memoria/disco/tiempo, decoders actualizados y salida de red restringida (mantener loopback requerido por HyperFrames). No exponer Studio/renderer directamente.
- El staging y los intentos fallidos pueden dejar archivos privados si un proceso muere. Añadir mantenimiento que borre sólo directorios huérfanos sin lease activo, con retención configurable y ajuste del gauge de storage. No reutilizar nombres de archivos subidos para rutas finales.

## Integración futura con PostgreSQL/Citaya

Portar schema.sql a un esquema privado, conservar todas las FKs e índices compuestos. No otorgar acceso directo a anon/authenticated. Agregar RLS defensiva con políticas basadas en la membresía confiable del usuario y tenant, no en user_metadata. Las rutas seguirán exigiendo los guards de Citaya aun con service-role. Workers obtienen acceso sólo al esquema/almacenamiento de Video Studio. Esta entrega no incluye ni ejecuta DDL contra Supabase.

## Aprobación y retry

El JSON no tiene approveFinal ni tenant_id. La aprobación es una operación humana autenticada fuera del LLM y se liga al fingerprint. Cada retry conserva job_id y cambia lease_token/attempt; sólo un worker vigente publica. Contadores exitosos tienen una única clave complete:job_id; reintentos no duplican outputs facturables. Los intentos fallidos sí conservan métricas de recursos.
