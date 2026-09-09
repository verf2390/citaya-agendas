# CIT-72 — rollout capability-aware live

## Objetivo

Separar `operational_mode=live` de la activación implícita de todas las funciones de Citaya. Un tenant live puede operar agenda y comunicaciones mientras pagos y DTE permanecen deshabilitados.

## Estado previo obligatorio

Antes de aplicar `migrations/202609090002_cit72_capability_aware_live.sql` ejecutar:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cit72/live-transition-preflight.sql
```

El preflight es solo lectura y debe terminar con:

```text
CIT72_LIVE_TRANSITION_PREFLIGHT_OK
```

Si aparece `CIT72_LIVE_TRANSITION_BLOCKED`, no aplicar la migración hasta resolver los tenants listados mediante el flujo operacional correspondiente. No modificar filas de readiness a mano.

## Fixtures productivos detectados 09-09-2026

Los siguientes tenants técnicos están `live` pero tienen readiness histórico incompleto:

- `dte-auto-offline-d9167871`
- `dte-auto-offline-e3b3a979`

Ambos contienen datos de pruebas offline DTE del 21-08-2026. Incluyen citas, payment intents e historial DTE; uno contiene documentos `submitted` y existen estados `BLOCKED` / `AMBIGUOUS` de pruebas. No borrar esos registros.

Si se decide retirarlos de operación, usar `archive_tenant_for_offboarding(...)` mediante el flujo platform-admin. El archivado conserva historia y bloquea nuevas operaciones; no hacer DELETE ni limpieza destructiva.

## Validación en servidor antes de producción

En la rama del PR:

```bash
node --test tests/security/cit72-capability-aware-live.test.mjs
node --test tests/security/cit72-capability-aware-live-postgres.test.mjs
npm run test:security
npm run build
```

No reiniciar el servicio con artefactos de otro build. Aplicar migración y despliegue de código como una misma ventana controlada para evitar que el runtime nuevo consulte RPC/tablas aún inexistentes.

## Orden de despliegue

1. `live-transition-preflight.sql` PASS.
2. Tests CIT-72 enfocados PASS.
3. `npm run test:security` PASS.
4. `npm run build` PASS.
5. Aplicar migración CIT-72 en la base objetivo.
6. Verificar `tenant_operational_features`, `tenant_core_legal_gate_report`, `tenant_tax_document_readiness` y resolver de capacidades.
7. Desplegar/reiniciar Next con el commit validado.
8. Smoke de R&G SPA para confirmar preservación de capacidades existentes.
9. Configurar Dimarzo mediante Plataforma.
10. Solo después cambiar Dimarzo a `live`.

## Caso de aceptación — Dimarzo Barber

Perfil objetivo, sujeto a onboarding/evidencia:

```text
appointments_enabled                     true
appointment_communications_enabled       true
external_communications_enabled          true
campaigns_enabled                        true
payments_enabled                         false
dte_enabled                              false
tax_document_mode                        external_bhe
```

`external_bhe` requiere referencia de verificación explícita. No marcar el modelo como verificado solo para superar readiness.

### Legal pendiente observado 09-09-2026

El tenant nació correctamente fail-closed y hoy tiene:

```text
administrative_review_status   draft
tenant_is_service_provider     false
sensitive_data_review_status   pending
handles_sensitive_data         null
privacy_contact_name           null
privacy_contact_email          null
legal_documents                0
```

Para core legal readiness faltan, como mínimo:

- revisión administrativa completa;
- confirmar explícitamente si el negocio es prestador de servicios;
- resolver revisión de datos sensibles (`confirmed_no` o `confirmed_yes` con propósito válido);
- contacto de privacidad;
- publicar términos del consumidor;
- publicar aviso de privacidad;
- publicar política de cancelación/reembolso;
- si maneja datos sensibles, publicar además la autorización correspondiente.

No se exige identidad DTE, CAF, certificado ni autoridad DTE para el perfil `external_bhe`.

## Campañas

Una vez `live` y con `campaigns_enabled=true`, el runtime permite campañas reales solo si también está habilitada la comunicación externa. Los destinatarios siguen sujetos a consentimiento de marketing vigente y supresiones; CIT-72 no relaja esos controles.
