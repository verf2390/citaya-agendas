# Citaya AI + WhatsApp

Estado: CIT-87 foundation en desarrollo, sin llamadas reales a Meta.

## Objetivo

WhatsApp será un canal del mismo Citaya AI Core. No se construye un bot separado.

```text
Cliente WhatsApp
      |
      v
Meta Cloud API
      |
      v
/api/webhooks/whatsapp
      |
      +-- verifica firma Meta
      +-- resuelve tenant por phone_number_id
      +-- idempotencia/auditoría segura
      |
      v
Citaya AI Core                (CIT-89)
   |        \
   |         \--> OpenAI fallback
   v
LLM local
   |
   v
Tools tenant-scoped
```

## Foundation CIT-87

Incluye:

- verificación GET del webhook mediante verify token;
- verificación POST de `x-hub-signature-256` sobre el raw body;
- resolución del tenant exclusivamente desde `phone_number_id` configurado;
- settings WhatsApp por tenant, OFF/fail-closed por defecto;
- referencia a secreto en vez de access token persistido en tabla de negocio;
- eventos webhook idempotentes;
- persistencia solo de metadata operativa;
- adapter server-side para templates Meta Cloud;
- tests de firma, parsing, aislamiento tenant y provider.

No incluye todavía:

- credenciales reales;
- Embedded Signup;
- envío productivo;
- conexión de mensajes entrantes con el LLM;
- acciones mutables;
- campañas masivas.

## Datos deliberadamente no persistidos por CIT-87

`whatsapp_webhook_events` no guarda:

- texto del mensaje;
- número/wa_id del cliente;
- payload completo de Meta;
- access token;
- App Secret;
- argumentos/resultados de Citaya AI.

Se registra únicamente metadata necesaria para idempotencia y operación:
tenant, event key, `phone_number_id`, provider message id, tipo/dirección y
timestamps.

## Configuración

Variables globales server-only:

```bash
CITAYA_WHATSAPP_VERIFY_TOKEN=
CITAYA_WHATSAPP_APP_SECRET=
CITAYA_WHATSAPP_GRAPH_VERSION=
```

La configuración de cada tenant vive en `whatsapp_tenant_settings`.
`access_token_secret_ref` es una referencia a almacenamiento seguro futuro; no
es el token.

Un tenant solo se considera resoluble por webhook cuando:

- existe settings;
- `enabled=true`;
- `readiness_status='ready'`;
- `phone_number_id` coincide exactamente.

## Plan de trabajo en Linear

Parent: **CIT-86**.

- **CIT-87**: foundation multi-tenant/provider/webhook.
- **CIT-88**: Embedded Signup y credenciales por tenant.
- **CIT-89**: WhatsApp → Citaya AI Core.
- **CIT-90**: templates transaccionales, idempotencia y delivery.
- **CIT-91**: consentimiento, opt-out y retención.
- **CIT-92**: metering/cuota/costo.
- **CIT-93**: E2E controlado con un tenant piloto.

## Hipótesis comercial

Objetivo a validar, no precio final:

```text
Citaya AI + WhatsApp ≈ $39.000 CLP / mes
bolsa inicial ≈ 100 mensajes / tenant / mes
```

Antes de publicar esta oferta se debe validar con datos reales:

- tarifa Meta vigente por categoría;
- mix service / utility / marketing / authentication;
- uso local vs cloud;
- tokens cloud;
- tasa de fallback;
- margen por tenant;
- excedentes y límites.

## Seguridad de rollout

1. CIT-87 debe quedar verde y mergeado sobre AI Core.
2. No aplicar migración en producción hasta revisar SQL/RLS.
3. No configurar secretos reales en GitHub ni tablas.
4. Completar CIT-88 y CIT-91 antes de mensajería productiva.
5. El primer flujo AI por WhatsApp permanece read-only.
6. Un fallo de WhatsApp nunca cambia el estado de una reserva.
7. Rollout inicial: un tenant piloto.
