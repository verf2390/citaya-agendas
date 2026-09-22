# Citaya AI Core — arquitectura y primera integración

Estado: implementación inicial para Citaya App
Fecha: 2026-09-22
Rama: `feat/citaya-ai-core-assistant`

## Alcance de este bloque

Este bloque incorpora una base reutilizable de IA y un asistente de lectura para
Citaya App. No incorpora funciones de Citaya Retail, n8n ni Web Creators.

Capacidades autorizadas en esta etapa:

- consultar reservas del tenant autenticado;
- identificar clientes inactivos del tenant autenticado;
- resumir saldos pendientes del tenant autenticado;
- analizar los resultados y redactar texto;
- no enviar campañas, modificar citas, cobrar ni ejecutar otra mutación de negocio.

## Auditoría de la arquitectura existente

Hallazgos relevantes para la integración:

1. Las rutas administrativas usan Supabase Auth y `requireTenantAdmin` o
   `requireHostTenantAdmin` antes de acceder con `supabaseAdmin` (service role).
2. El repositorio ya dispone de `consume_api_rate_limit`, respaldado por
   PostgreSQL, y se reutiliza para limitar el asistente.
3. CIT-64 mantiene un inventario ejecutable de toda ruta y helper privilegiado.
   La ruta y el repositorio de lectura de IA se agregan explícitamente a ese
   inventario y tienen pruebas de aislamiento.
4. El panel administrativo obtiene el tenant desde el subdominio. La nueva API
   usa el boundary más estricto: el tenant se resuelve desde el hostname y no
   acepta `tenantId` ni `slug` elegidos por el navegador o por el modelo.
5. La aplicación ya usa Route Handlers con runtime Node.js, `adminFetch` para el
   Bearer de Supabase y componentes cliente para las pantallas administrativas.

No se encontró un bloqueo arquitectónico que obligue a cambiar los flujos
existentes. La integración se mantiene aislada bajo `lib/ai` y
`app/api/admin/ai`.

## Diseño

```text
Admin UI
  -> POST /api/admin/ai/assistant
     -> requireHostTenantAdmin(req)
     -> rate limit usuario + tenant
     -> configuración y presupuesto del tenant
     -> Citaya AI Core (orquestador)
        -> AIProvider
           -> OpenAIProvider (Responses API, store=false)
           -> LocalModelProvider (gateway privado Citaya)
           -> futuros adaptadores
        -> allow-list de tools read-only
           -> repositorio Supabase siempre filtrado por access.tenantId
     -> auditoría sin prompt, respuesta ni resultados
```

### Contrato de proveedor

`AIProvider` recibe instrucciones, entrada, schemas de tools, límite de salida,
señal de cancelación y una continuación opaca. Devuelve texto, tool calls, uso
de tokens y una continuación propia del proveedor. El orquestador controla el
bucle, valida la allow-list y ejecuta las tools.

Esta separación evita que la lógica de Citaya dependa del formato de OpenAI.
Agregar otro proveedor requiere un adaptador nuevo; no requiere reescribir las
tools, permisos, auditoría, límites ni UI.

### Proveedores iniciales

- `OpenAIProvider`: usa server-side `OPENAI_API_KEY`, el modelo configurado y la
  Responses API. Envía `store: false`, conserva `reasoning.encrypted_content`
  para continuaciones stateless con tools, desactiva tool calls paralelas y
  aplica timeout. El endpoint debe usar HTTPS, salvo loopback HTTP para pruebas
  locales.
- `LocalModelProvider`: llama a un endpoint privado configurable que implementa
  el contrato de gateway Citaya. No presupone una API key en el navegador ni
  obliga a que el modelo local imite la API de OpenAI.

No existe importación de proveedores desde componentes cliente. Todas las
variables sin prefijo `NEXT_PUBLIC_` se leen exclusivamente en módulos
server-only.

## Boundary multi-tenant

Reglas invariantes:

- el body no contiene un tenant confiable;
- la ruta autentica antes de parsear el JSON;
- `access.tenantId` se inyecta en el contexto interno y nunca se presenta como
  argumento modificable de una tool;
- todas las consultas de negocio incluyen `.eq("tenant_id", tenantId)`;
- ids devueltos por una consulta tenant-scoped no habilitan consultas globales;
- el modelo solo conoce los resultados mínimos necesarios;
- el historial no se persiste ni se comparte entre requests o tenants.

## Tools v1

| Tool | Acceso | Límites | Datos devueltos |
|---|---|---|---|
| `count_appointments` | lectura | un día, zona `America/Santiago` | fecha, zona horaria y conteos activo/cancelado/total |
| `list_inactive_customers` | lectura | 1–3650 días, máximo 50 resultados | id, nombre, última visita/servicio y días |
| `get_pending_receivables` | lectura | máximo 50 resultados | conteo, total CLP y saldos de citas |

Los schemas usan validación estricta y `additionalProperties: false`. La salida
de tools se trata como datos no confiables; el prompt prohíbe obedecer texto que
aparezca dentro de nombres, servicios o resultados.

Las consultas paginan todos los registros candidatos antes de calcular totales;
el máximo de 50 limita únicamente lo que se devuelve al modelo, no el conteo ni
la suma. Cada página conserva el filtro `tenant_id` y recibe la señal de
cancelación del request.

## Rate limit, tokens y costo

- límite duro por minuto mediante `consume_api_rate_limit`;
- `max_output_tokens` por request;
- límite diario configurable por tenant, verificado antes de llamar al proveedor;
- máximo de pasos/tools por request;
- timeout total por request, incluyendo auditoría, providers, tools y consultas Supabase;
- auditoría de tokens de entrada, salida y total cuando el proveedor los informa.

El límite diario inicial es una barrera de uso, no una contabilidad financiera
exacta: el precio depende del proveedor y modelo configurados. Una etapa futura
puede agregar precios versionados sin cambiar el contrato de proveedor.
La reserva conservadora de cada request nunca puede superar el presupuesto
diario configurado para el tenant.

## Auditoría y privacidad

`ai_request_audit` registra únicamente:

- tenant, usuario, modo de autorización;
- proveedor, modelo y versión del prompt;
- estado, duración, tools usadas y conteos de tokens;
- código de error seguro.

No registra mensajes, respuestas, argumentos ni resultados de tools. Así se
mantiene trazabilidad operativa sin convertir la auditoría en un almacén de PII.

## Configuración server-side

```bash
CITAYA_AI_ENABLED=false
CITAYA_AI_PROVIDER=openai
CITAYA_AI_PROMPT_VERSION=citaya-app-assistant-v1
CITAYA_AI_OPENAI_MODEL=
OPENAI_API_KEY=
CITAYA_AI_LOCAL_ENDPOINT=
CITAYA_AI_LOCAL_AUTH_TOKEN=
CITAYA_AI_TIMEOUT_MS=20000
CITAYA_AI_MAX_OUTPUT_TOKENS=800
CITAYA_AI_DAILY_TOKEN_LIMIT=50000
CITAYA_AI_REQUESTS_PER_MINUTE=10
```

La migración crea `ai_tenant_settings`. Una fila por tenant puede habilitar la
función y sobrescribir proveedor, modelo, versión de prompt, límites y timeout.
Solo se aceptan versiones de prompt registradas en el código; los secretos nunca
se guardan en esa tabla.

## Operación y despliegue

1. Aplicar la migración de AI Core.
2. Configurar el proveedor y sus secretos solo en el servidor.
3. Mantener `CITAYA_AI_ENABLED=false` durante el despliegue inicial.
4. Habilitar un tenant piloto en `ai_tenant_settings`.
5. Verificar preguntas de reservas, inactividad, cobros y redacción.
6. Revisar `ai_request_audit` antes de ampliar el rollout.

## Verificación de esta entrega

- build de producción completado con valores públicos sintéticos de Supabase;
- 23 pruebas específicas de AI Core, tools, UI y aislamiento aprobadas;
- 102 pruebas generales aprobadas, excluyendo una
  prueba de billing preexistente que falla también sin estos cambios;
- 545 pruebas de seguridad no dependientes de PostgreSQL aprobadas;
- lint dirigido a todos los archivos nuevos y modificados aprobado.

Después de esa verificación se corrigieron hallazgos adicionales de review sobre
reservas expiradas, `no_show` y el deadline de auditoría, y se agregaron pruebas
de regresión. El build y las suites completas deben re-ejecutarse sobre el HEAD
actual antes del merge o despliegue.

Limitaciones del entorno de verificación:

- no se ejecutaron las pruebas que requieren `psql`, porque el binario no está
  instalado en el entorno de trabajo;
- no se hizo una llamada real a un proveedor: los contratos y el tool loop se
  probaron con providers/fetch simulados y sin usar credenciales reales;
- el lint global conserva errores preexistentes fuera de este bloque;
- la migración debe validarse en un entorno PostgreSQL/Supabase antes de habilitar
  el primer tenant piloto.

## Fuera de alcance y próximos bloques

- memoria conversacional persistente;
- envío de campañas;
- cancelación o reagendamiento;
- cobros o mutaciones financieras;
- WhatsApp autónomo;
- Citaya Retail, n8n y Web Creators;
- estimación monetaria exacta por modelo.

La siguiente etapa de producto solo debe comenzar después de que este bloque
compile, pase las pruebas, esté desplegado con la migración y haya sido validado
con un tenant piloto.
