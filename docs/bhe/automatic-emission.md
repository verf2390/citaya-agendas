# CIT-73 — Emisión automática BHE

## Respuesta pendiente y antecedentes SII

La respuesta oficial aplicable a Citaya está pendiente bajo el folio **GE00396714**. Aún no se decide si la integración futura corresponde al web service masivo de la Res. 64, a un mecanismo como usuario autorizado o a otro mecanismo oficial. Los antecedentes siguientes no seleccionan un transporte para Citaya. **No existe transporte BHE implementado.**

La emisión automática de Boletas de Honorarios Electrónicas (BHE) existe, pero no como una API pública general disponible para cualquier contribuyente.

La Resolución Exenta SII N°64 de 24-06-2021 establece un **web service de emisión masiva de BHE** sujeto a autorización y certificación previa del contribuyente.

Fuente oficial: https://www.sii.cl/normativa_legislacion/resoluciones/2021/reso64.pdf

### Condiciones conocidas

- El acceso está pensado para contribuyentes que emitan masivamente BHE.
- La resolución define, en principio, emisión masiva como promedio de **300 o más BHE mensuales** durante los 6 meses anteriores a la solicitud.
- El SII también puede considerar necesidades de simultaneidad temporal según la operación.
- El contribuyente debe certificar su sistema de emisión ante el SII.
- La certificación cubre generación de archivos electrónicos, comunicaciones autónomas con el web service y manejo de respuestas automáticas.
- El proveedor informático debe incorporarse al proceso de certificación cuando exista.
- La solicitud se presenta mediante Formulario 2117, materia `Boleta de Honorarios en forma masiva`.
- El acceso al web service sólo se habilita después de evaluación y certificación satisfactoria.

## Delegación a usuario autorizado

El SII permite que un contribuyente autorice a un tercero para emitir BHE usando la propia Clave Tributaria del tercero. Ese mecanismo está documentado como flujo del portal web y no debe considerarse una API genérica para Citaya.

Fuentes:

- https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_1040.htm
- https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_0609.htm
- https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_1767.htm

## Arquitectura Citaya

La BHE automática debe ser opcional y separada de DTE 33/39.

### Camino normal

`tax_document_mode = external_bhe`

El tenant puede operar live con agenda y campañas sin exigir DTE Citaya ni BHE automática.

### Camino automático futuro

Sólo se habilitará si existe evidencia verificable de:

1. elegibilidad o evaluación SII;
2. solicitud administrativa;
3. certificación del sistema;
4. autorización SII activa y evidencia de vigencia, sin inventar caducidad;
5. especificación técnica oficial recibida;
6. credenciales/configuración técnica completas;
7. worker e idempotencia listos.

No se implementarán endpoints, WSDL, formatos, tokens ni secretos inventados. La capa de transporte se construirá únicamente cuando el SII entregue o publique la especificación técnica aplicable al contribuyente autorizado.

## Dimarzo Barber

Dimarzo no debe depender de la automatización BHE para pasar a `live`. Su camino actual sigue siendo `external_bhe` manual, con automatización, pagos Citaya y DTE Citaya deshabilitados. R&G conserva `citaya_dte` y sus capabilities de pagos/DTE. Fase 1A no cambia reservas, pagos, DTE ni los resolvers operacionales.

## Fase 1A: control de autoridad independiente del transporte

Las migraciones nuevas `202609090008_cit73_bhe_control_plane.sql` y `202609090009_cit73_bhe_authority_audit_security.sql` agregan una base administrativa. Las migraciones 003 y 007 permanecen intactas. No hay backfill de autoridad, activación, integración al resolver `bheAutomation` ni ejecución externa.

Un **tenant** es la organización aislada en Citaya; un **profesional** es una persona que presta servicios; el **emisor** es el contribuyente que emite BHE. No son identidades equivalentes. Cada emisor se vincula explícitamente a un tenant y debe verificarse mediante evidencia revisada por un administrador de plataforma. La primera versión admite un solo emisor actual por tenant, incluyendo el candidato aún no verificado; los emisores inactivos permanecen en el historial. No se infiere un emisor a partir del tenant o del profesional.

El registro recibe el identificador tributario necesario, lo valida mediante el normalizador chileno ya existente y persiste únicamente SHA-256 de `tenant_id:identificador_normalizado`. Reutiliza esa función de validación, sin invocar emisión, configuración ni infraestructura DTE. La huella sirve para vinculación interna, no para reconstruir la identidad ni como secreto: el espacio de RUT es enumerable. Las tablas de identidad no tienen SELECT para roles de aplicación. La evidencia referenciada debe permitir verificar el contribuyente mediante el sistema documental con acceso restringido que use la operación administrativa.

| Tabla | Responsabilidad |
| --- | --- |
| `bhe_issuers` | Identidad, estado de verificación, referencia de evidencia, actor/fechas y `version`. Sin RUT en claro. |
| `bhe_authority_records` | Un registro independiente por dimensión y revisión: evaluación, solicitud, certificación o autorización. Cada dimensión tiene su propio ID, estado, evidencia, ascendencia y versión. |
| `bhe_authority_controls` | Generación monotónica por tenant y `requires_explicit_enablement=true`, protegido por CHECK. Fase 1A no ofrece ninguna operación para liberar este bloqueo. |
| `bhe_authority_audit` | Eventos derivados por DB, con estado anterior/nuevo, actor, motivo, fecha, versión y generación. |

Se usa una tabla discriminada para los cuatro tipos de expediente, **no un estado global**. Los CHECK limitan estados y forma del padre por dimensión. La cadena interna conservadora es evaluación → solicitud → certificación → autorización. Una autorización activa administrativamente exige la evidencia revisada de esa cadena. Estos requisitos son controles internos de Citaya y no afirman nombres o etapas oficiales de un transporte SII. Si GE00396714 exige otra estructura de evidencia, deberá revisarse explícitamente antes de habilitar ejecución.

### Estados y transiciones canónicas

Todos los nombres siguientes son **estados internos de Citaya**. Los destinos no enumerados se rechazan con `BHE_INVALID_TRANSITION`.

| Dimensión | Origen | Destinos permitidos |
| --- | --- | --- |
| Emisor | `UNVERIFIED` | `VERIFIED`, `INACTIVE` |
| Emisor | `VERIFIED` | `INACTIVE` |
| Elegibilidad | `NOT_ASSESSED` | `UNDER_REVIEW` |
| Elegibilidad | `UNDER_REVIEW` | `ELIGIBLE`, `INELIGIBLE` |
| Solicitud | `DRAFT` | `SUBMITTED`, `WITHDRAWN` |
| Solicitud | `SUBMITTED` | `UNDER_REVIEW`, `WITHDRAWN` |
| Solicitud | `UNDER_REVIEW` | `APPROVED`, `REJECTED`, `WITHDRAWN` |
| Certificación | `NOT_STARTED` | `IN_PROGRESS` |
| Certificación | `IN_PROGRESS` | `VALID`, `FAILED` |
| Certificación | `VALID` | `INVALIDATED` |
| Autorización | `NOT_GRANTED` | `ACTIVE`, `REVOKED` |
| Autorización | `ACTIVE` | `SUSPENDED`, `REVOKED` |
| Autorización | `SUSPENDED` | `ACTIVE` con evidencia explícita, `REVOKED` |

`INACTIVE`, `ELIGIBLE`, `INELIGIBLE`, `APPROVED`, `REJECTED`, `WITHDRAWN`, `FAILED`, `INVALIDATED` y `REVOKED` son terminales en su respectiva dimensión. Para reevaluar o solicitar nuevamente se abre un registro con ID y revisión nuevos. Nunca se cambia `REVOKED` a `ACTIVE` sobre el mismo registro.

No se abre un segundo expediente pendiente o activo de la misma dimensión. Una nueva evaluación sustituye a la anterior para el reporte; una solicitud o autorización que referencia una revisión anterior deja de completar la cadena. Los avances verifican recursivamente emisor, padre, última revisión, estado positivo, evidencia y fechas explícitas. Las decisiones de cierre o suspensión siguen disponibles aunque el padre ya no esté listo.

`ELIGIBLE`, `APPROVED`, `VALID` y `ACTIVE` requieren una referencia de evidencia revisada en esa decisión. DB fija quién la verificó y cuándo. `valid_from` y `valid_until` son metadata opcional de esa evidencia: no tienen caducidad por defecto. El reporte usa el intervalo `[valid_from, valid_until)` cuando existe. Una decisión sin nueva evidencia preserva las fechas; nueva evidencia puede declarar otras fechas o ausencia de ellas, quedando auditada.

### RPC, actor y concurrencia

| RPC | Uso |
| --- | --- |
| `bhe_register_issuer` | Crear identidad candidata con evidencia, sin verificarla automáticamente. |
| `bhe_transition_issuer` | Verificar o inactivar un emisor; exige `expected_version`. |
| `bhe_open_authority_record` | Crear una nueva revisión en el estado inicial de una dimensión. |
| `bhe_transition_authority_record` | Decidir o avanzar estado, incluida suspensión/revocación; exige `expected_version`. |
| `tenant_bhe_authority_report` | Lectura de completitud administrativa, sin datos tributarios ni referencias documentales. |

Las mutaciones derivan el actor de `auth.uid()`. Exigen simultáneamente rol SQL invocante `authenticated`, `auth.role()='authenticated'` y una fila activa `super_admin` en `platform_admins`. No reciben `p_actor_id`. Un tenant-admin no puede verificar emisores ni evidencia, evaluar elegibilidad, certificar, autorizar o reanudar. `service_role` carece de EXECUTE administrativo y tampoco pasa el control de rol invocante aunque recibiera accidentalmente ese permiso. La verificación criptográfica del contexto Auth corresponde al gateway; un propietario/superusuario SQL queda fuera de la frontera de roles de aplicación.

Las RPC y funciones que requieren privilegios son `SECURITY DEFINER`; los helpers `bhe_audit_state` y `bhe_deny_history_mutation` son `SECURITY INVOKER` y conservan sus ACL cerradas. Todas mantienen `search_path=''` y referencias calificadas. Las mutaciones canónicas primero bloquean la fila del tenant y luego la entidad, manteniendo un orden común. La apertura serializa la asignación de `revision`; cada actualización bloquea y compara `expected_version` contra la versión real. Una discrepancia, incluido NULL, falla con `BHE_CONCURRENT_MODIFICATION`. El trigger incrementa `version`, deriva actores/fechas y protege la identidad y ascendencia inmutables. Dos sesiones con la misma versión no pueden ganar ambas.

### Permisos efectivos y aislamiento

Antes de conceder permisos se hace `REVOKE ALL` explícito a `PUBLIC`, `anon`, `authenticated` y `service_role`, incluyendo los grants amplios heredados de Supabase.

| Recurso | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| Tablas nuevas: INSERT/UPDATE/DELETE/TRUNCATE | Sin permiso | Sin permiso | Sin permiso |
| Emisores, expedientes y controles: SELECT directo | Sin permiso | Sin permiso | Sin permiso |
| Auditoría nueva: SELECT | Sin permiso | Sólo platform-admin por RLS | Sin permiso |
| RPC administrativas | Sin EXECUTE | EXECUTE, con control platform-admin interno | Sin EXECUTE |
| Reporte | Sin EXECUTE | Plataforma o miembro activo owner/admin del tenant | Lectura interna |
| Funciones auxiliares y de triggers | Sin EXECUTE | Sin EXECUTE | Sin EXECUTE |
| Settings 003 | Sin permiso | Sin permiso | Sólo SELECT |
| Auditoría 003 | Sin permiso | Sin permiso | Sin permiso |

RLS está habilitada en las cuatro tablas nuevas. Las FK `(tenant_id, issuer_id)` y `(tenant_id, issuer_id, parent_id, parent_domain)` impiden relacionar otro tenant, otro emisor o una dimensión incorrecta. Las RPC además buscan por tenant e ID, de modo que una autorización A no puede suspenderse invocando tenant B. El reporte de un miembro de A no puede consultar B.

### Auditoría obligatoria y privacidad

Los triggers AFTER INSERT/UPDATE de emisor, expediente y settings legacy insertan auditoría **en la misma transacción**. Si la auditoría falla, se revierten entidad, versión y generación. El caller sólo aporta motivo y evidencia: no puede aportar snapshots, actor o fecha de auditoría. Los snapshots proceden de `OLD`/`NEW`; actor y fechas se derivan en DB. Cada cambio de entidad genera exactamente un evento; un cierre que también apaga settings legacy produce además el evento de esa segunda entidad.

La auditoría guarda tenant, dominio, ID, acción, actor, motivo, estado anterior/nuevo, fecha, versión de entidad y generación. Elimina la huella tributaria y las referencias de evidencia de los snapshots, conservando presencia y huella de la referencia para distinguir cambios. Los motivos redactan patrones comunes de RUT, pero el administrador debe usar referencias opacas y evitar datos personales en el texto libre; esa redacción no es un detector universal de PII. La configuración de logs del gateway/DB debe evitar registrar argumentos con identificadores tributarios: esta fase no modifica infraestructura de logging.

Los roles de aplicación no pueden insertar auditoría ni modificarla. Triggers defensivos rechazan UPDATE/DELETE/TRUNCATE de auditoría, incluso ante un grant accidental, y DELETE/TRUNCATE de emisores y expedientes. No se promete resistencia a un propietario de tablas que pueda deshabilitar triggers. El motivo se propaga mediante contexto local de transacción; ese contexto no sustituye la autenticación ni otorga DML.

La única excepción sin actor humano es la creación de defaults OFF de settings 003 por el trigger de provisioning existente: se audita como `SYSTEM / LEGACY_SETTINGS / DEFAULT_CREATED`, sin afirmar autoridad. No se crean eventos retrospectivos para datos anteriores.

### Suspensión, revocación y reporte

Suspender o revocar es una llamada a `bhe_transition_authority_record`, con versión y motivo. La misma transacción deja registrado el cierre y, si existe un estado legacy habilitado, lo apaga junto con su estado de autorización en un único UPDATE que respeta el constraint de 003. No se activa nada al reanudar; una reanudación exige nueva evidencia y decisión explícita.

Cada cambio incrementa `generation` y mantiene `requires_explicit_enablement=true`. Una fase posterior deberá vincular cualquier habilitación explícita a la generación revisada, de modo que restaurar hechos compatibles no restaure permiso automáticamente. Fase 1A no contiene una operación de habilitación.

El reporte es de sólo lectura y devuelve por defecto `issuerVerified=false`, `authorizationActive=false`, `evidenceComplete=false`, `controlReady=false`. Expone separadamente los cuatro estados. `authorizationActive` describe el estado ACTIVE de una autorización vinculada a un emisor verificado y su ventana explícita; `controlReady` exige además la cadena actual positiva, toda la evidencia y un control existente con bloqueo explícito y generación positiva coincidente con la última auditoría del tenant. Si falta el control, expone `generation=0` y `controlReady=false`; las inconsistencias de generación también cierran el reporte. La lectura nunca crea ni repara controles, y los errores SQL siguen abortando la llamada. Un padre invalidado puede dejar `authorizationStatus=ACTIVE` mientras `controlReady=false`: las dimensiones se conservan separadas y el reporte no autoriza ejecución.

Incluso con `controlReady=true`, `executionEnabled` permanece false y `requiresExplicitEnablement` true. El reporte no evalúa capabilities productivas ni modifica `bheAutomation`. Fase 1B lo consume desde la readiness efectiva descrita a continuación.

### Rol transitorio de foundation 003

`tenant_bhe_automation_settings` permanece como snapshot legacy leído por el readiness/resolver existente. Quedan deprecated como fuente de autoridad `authorization_status`, `eligibility_basis`, `average_monthly_bhe`, `evidence_period_months`, `eligibility_evidence_reference`, `form_2117_reference`, `certification_reference` y `sii_authorization_reference`. Ninguno se transforma en evidencia verificada del control nuevo.

`automation_mode` y `provider_included_in_certification` reflejan el supuesto histórico de emisión masiva; no seleccionan el transporte nuevo. `ws_spec_received`, `credentials_configured` y `worker_ready` son flags técnicos legacy, sin implementación nueva. `automation_enabled` queda congelado en OFF para los roles de aplicación. La migración 009 aborta con `BHE_LEGACY_AUTOMATION_MUST_BE_OFF` si encuentra alguna activación previa; no la corrige ni ejecuta backfill. Tras instalarse, sólo se admite el apagado auditado desde las RPC nuevas, además de provisioning de defaults OFF.

Antes del preflight, 009 toma un bloqueo `SHARE ROW EXCLUSIVE` sobre settings legacy y lo conserva hasta COMMIT. Así ninguna escritura concurrente puede introducir una activación entre el chequeo OFF y el cierre de permisos/triggers. Las lecturas continúan disponibles.

`created_at`, `updated_at` y `updated_by` conservan su función histórica; los eventos nuevos de settings se escriben en `bhe_authority_audit`. `tenant_bhe_automation_audit` queda como historial congelado. Los flags legacy nunca promocionan el control nuevo; la instalación con todos OFF y el cierre del DML impiden que su resolver antiguo tenga autoridad ejecutable superior. Desde Fase 1B, esos flags sólo representan prerequisites foundation/technical legacy; la autoridad proviene exclusivamente del reporte de 009.

### Fase 1B: readiness efectiva sin ejecución

La migración `202609090010_cit73_bhe_authority_readiness.sql` reemplaza únicamente `tenant_bhe_automation_readiness`. No reescribe 003, 007, 008 ni 009, no hace backfill y no modifica datos. Conserva los campos diagnósticos legacy —incluidos `siiAuthorized` y `automationEnabled`, que no acreditan autoridad ni permiso de ejecución— y separa tres condiciones:

| Campo | Fuente y significado |
| --- | --- |
| `foundationReady` | Conjunción histórica de 003: `automation_enabled`, modo legacy `sii_mass_webservice`, estado legacy `authorized`, proveedor incluido, especificación recibida, configuración técnica y worker declarados listos. Son requisitos legacy necesarios, nunca prueba de autoridad o ejecución real. |
| `authorityControlReady` | `controlReady` de `tenant_bhe_authority_report`, con emisor verificado, autorización activa, evidencia completa y generación positiva entera en el mismo reporte. No se infieren estados leyendo tablas de autoridad. |
| `authorityExecutionEnabled` | `executionEnabled=true` y `requiresExplicitEnablement=false` en ese reporte. 009 devuelve siempre false/true respectivamente. |
| `effectiveReady` | `foundationReady AND authorityControlReady AND authorityExecutionEnabled`. |

`ready` es un alias de `effectiveReady` para mantener el contrato del resolver de 007. Ese resolver permanece intacto: sólo un tenant activo, `live`, con `tax_document_mode=external_bhe` y readiness efectiva puede exponer `bheAutomation=true`. **Fase 1B NO habilita BHE automática:** con el reporte real de 009, `authorityExecutionEnabled=false`, `effectiveReady=false` y `bheAutomation=false`, incluso si los otros dos requisitos son true. Tampoco se modifica la compatibilidad de Fase 0: la aplicación sigue normalizando únicamente la ausencia de `bheAutomation` a false.

La composición es `STABLE`, `SECURITY INVOKER`, con `search_path=''` y EXECUTE sólo para `service_role`, que ya tiene SELECT sobre settings y EXECUTE sobre el reporte. No agrega permisos de mutación. Los callers operacionales usan `supabaseAdmin`; los guards SQL indirectos con otro rol de sesión no reciben el reporte interno y cierran sólo la readiness BHE, conservando sus otras capabilities. No se cambian roles ni claims para obtener el reporte.

Un reporte ausente, campos requeridos ausentes o de tipo incorrecto, contradicciones de autoridad o generación inválida cierran readiness. Los errores reales de DB se propagan y abortan la llamada; no se convierten en respuestas exitosas. La lectura no crea ni repara controles. Los flags legacy no pueden sustituir el reporte ni liberar ejecución.

El transporte oficial SII sigue sin implementarse y continúa pendiente **GE00396714**. Esta fase no agrega endpoints, SOAP/WSDL/API, worker, outbox, issuance intents, secretos, credenciales ni UI administrativa.

### Validación local

`node --test tests/security/cit73-bhe-authority-postgres.test.mjs` crea una base aleatoria y efímera en el contenedor PostgreSQL local `citaya-dte-sqltest` y la elimina al finalizar. No usa URLs ni conexiones Supabase. Reproduce grants por defecto amplios, deriva claims de sesiones de prueba, aplica las migraciones a fixtures y comprueba ACL/RLS, transiciones, rollback obligatorio de auditoría, aislamiento por FK, concurrencia real entre dos sesiones, vigencia y suspensión/revocación. También ejecuta contratos SQL CIT-72 y verifica que pagos/DTE y BHE manual conservan sus capabilities.

`node --test tests/security/cit73-bhe-readiness-postgres.test.mjs` usa otra base efímera local para comprobar la composición de Fase 1B con un expediente creado mediante las RPC reales, las combinaciones de prerequisites, ACL, lectura sin escrituras y preservación de capabilities/guards. Los flags legacy completos y los reportes hipotéticos se introducen únicamente mediante fixtures privilegiados con rollback; no son vías de habilitación de la aplicación.
