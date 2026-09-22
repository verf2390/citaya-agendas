# Citaya AI — gateway local y topología de servidores

Estado: base operativa preparada; no desplegada
Fecha: 2026-09-22

## Objetivo

Permitir que Citaya AI Core use modelos locales sin depender de la laptop de desarrollo y sin acoplar la aplicación a un runtime concreto.

Esta es una **topología propuesta**, no un inventario de red confirmado. Antes del despliegue hay que validar IPs, RAM disponible y carga actual de cada nodo.

## Principio operativo

La laptop personal queda fuera del camino crítico de producción. Puede usarse para benchmarks, pruebas o desarrollo, pero apagarla no debe interrumpir Citaya ni la IA local.

## Topología propuesta con los cuatro nodos

```text
Citaya App / AI Core
        |
        v
rg-master
AI Gateway / router
        |
        v
worker-01
modelo local principal
        |
        +-------------------+
        |                   |
        v                   v
worker-02              servidor-casa
jobs IA pequeños       Citaya / n8n /
embeddings futuros     coordinación
```

Asignación inicial propuesta:

- **rg-master**: gateway Citaya y contrato estable entre aplicaciones y motores IA.
- **worker-01**: nodo preferente para inferencia local.
- **worker-02**: embeddings, clasificación, RAG o trabajos asíncronos futuros.
- **servidor-casa**: Citaya, n8n y coordinación; evitar usarlo como nodo pesado del LLM mientras sea infraestructura central.

No se intenta sumar la RAM de los cuatro equipos para ejecutar un único modelo. El diseño distribuye servicios y trabajos.

## Gateway incluido en el repositorio

- `services/ai-gateway/server.mjs`
- `services/ai-gateway/openai-compatible.mjs`

El gateway implementa el contrato que consume `LocalModelProvider`: `POST /v1/generate` con Bearer token y JSON. Convierte la solicitud a un upstream local compatible con Chat Completions y devuelve texto, tool calls, continuation y uso de tokens en el formato de Citaya.

`GET /health` no consulta datos de negocio ni expone configuración sensible.

## Variables del gateway

```bash
CITAYA_AI_GATEWAY_HOST=127.0.0.1
CITAYA_AI_GATEWAY_PORT=8787
CITAYA_AI_GATEWAY_TOKEN=
CITAYA_AI_GATEWAY_UPSTREAM_URL=
CITAYA_AI_GATEWAY_UPSTREAM_TOKEN=
CITAYA_AI_GATEWAY_TIMEOUT_MS=60000
```

Inicio: `npm run ai:gateway`.

Si el gateway escucha fuera de loopback, exige un token de al menos 32 caracteres.

## Conexión desde Citaya App

Modo recomendado:

```bash
CITAYA_AI_PROVIDER=local
CITAYA_AI_LOCAL_MODEL=<modelo>
CITAYA_AI_LOCAL_ENDPOINT=https://<gateway-privado>/v1/generate
CITAYA_AI_LOCAL_AUTH_TOKEN=<token>
```

Por defecto Citaya rechaza HTTP remoto.

Para una LAN privada aislada existe un opt-in explícito:

```bash
CITAYA_AI_LOCAL_ENDPOINT=http://<ip-privada>:8787/v1/generate
CITAYA_AI_LOCAL_AUTH_TOKEN=<token>
CITAYA_AI_LOCAL_ALLOW_HTTP_PRIVATE=true
```

Ese modo solo admite rangos IPv4 privados RFC1918 y sigue exigiendo token. Debe usarse únicamente si se acepta tráfico interno sin cifrar; para un despliegue más sensible se mantiene HTTPS.

## Seguridad

- el gateway no recibe `tenantId` como permiso de acceso;
- las tools siguen ejecutándose dentro de Citaya App y conservan el tenant autorizado por el servidor;
- el modelo local recibe únicamente los datos mínimos devueltos por las tools;
- no se registran prompts ni resultados en stdout;
- la aplicación conserva rate limit, presupuesto, timeout y auditoría;
- el gateway remoto exige autenticación;
- las mutaciones continúan fuera de alcance en esta primera etapa.

## Despliegue posterior

1. mergear AI Core;
2. aplicar y validar la migración;
3. instalar el runtime local en el nodo de inferencia;
4. desplegar el gateway en el nodo elegido;
5. validar conectividad privada;
6. benchmark con 2–3 modelos pequeños;
7. activar un único tenant piloto;
8. comparar calidad y latencia contra el provider cloud;
9. recién entonces decidir routing/fallback automático.

No se requiere la laptop para la operación permanente.

## Modo híbrido

Cuando se configure `CITAYA_AI_PROVIDER=hybrid`, Citaya intenta primero el
modelo local. Si el primer turno no puede iniciarse por indisponibilidad,
respuesta inválida o por superar el timeout corto del primario, puede usar
OpenAI como fallback.

```bash
CITAYA_AI_PROVIDER=hybrid
CITAYA_AI_LOCAL_MODEL=<modelo-local>
CITAYA_AI_OPENAI_MODEL=<modelo-cloud>
CITAYA_AI_HYBRID_PRIMARY_TIMEOUT_MS=5000
```

El cambio de proveedor solo puede ocurrir antes de que exista un primer turno
válido. Una vez iniciado un tool loop con un proveedor, Citaya no salta al otro
en mitad de la conversación. Esto evita reutilizar estado/continuations
incompatibles entre runtimes.
