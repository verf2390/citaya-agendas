# Worker automático DTE: instalación y rollout seguro

Este runbook cubre únicamente emisión automática DTE33/DTE39. El worker manual,
la reconciliación de estado SII y la entrega por correo permanecen separados.

## Invariantes

- El runner hace una sola iteración y llama al endpoint interno con
  `mode: "automatic"`.
- `DTE_AUTOMATIC_WORKER_ENABLED` debe ser exactamente `true`; cualquier otro
  valor desactiva el runner antes de hacer la llamada interna.
- `DTE_AUTOMATIC_TARGET_OUTBOX_ID` activa el claim exacto. Un target no elegible
  falla cerrado y jamás cae al outbox automático más antiguo.
- No usar `DTE_TARGET_OUTBOX_ID`: pertenece exclusivamente al worker manual.
- Sólo `automatic_system` + `automatic_payment`, tipos 33 y 39, son elegibles.
- El lease dura 15 minutos; el timeout HTTP es 12 minutos y el timeout del unit
  es 13 minutos.

## Instalación sin habilitar el timer

Después de desplegar y aplicar la migración mediante el procedimiento normal:

```bash
sudo install -m 0644 ops/systemd/citaya-dte-auto-worker.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/citaya-dte-auto-worker.timer /etc/systemd/system/
sudo systemctl daemon-reload
systemctl is-enabled citaya-dte-auto-worker.timer
systemctl is-active citaya-dte-auto-worker.timer
```

Los dos últimos comandos deben responder `disabled` e `inactive`. La instalación
no incluye `enable`, `start` ni `restart`.

## Preflight

Antes de cada canary:

1. Confirmar que no hay issuance outbox ni recipient outbox activos.
2. Confirmar que el timer automático está `disabled` e `inactive`.
3. Confirmar que el tenant objetivo y el producto siguen en modo manual.
4. Confirmar readiness legal, autorización del tipo, CAF/folios, certificado,
   endpoints, storage y worker.
5. Confirmar que el outbox objetivo está `PENDING`, tiene cero intentos de red,
   no tiene documento ni submission attempt, y pertenece al dominio automático.
6. Confirmar que el tipo resuelto es exactamente 39 para el primer canary.
7. Guardar el UUID del outbox como evidencia operativa; no registrar secretos,
   XML, identidad tributaria completa ni material de firma.

## Canary dirigido DTE39

1. Mantener el timer automático deshabilitado.
2. Configurar temporalmente `DTE_AUTOMATIC_TARGET_OUTBOX_ID` con el UUID exacto.
3. Abrir sólo para el tenant canary los modos tenant/product y los gates de
   producción; poner `DTE_AUTOMATIC_WORKER_ENABLED=true` al final.
4. Ejecutar una única vez `citaya-dte-auto-worker.service`.
5. Volver inmediatamente `DTE_AUTOMATIC_WORKER_ENABLED=false` y retirar el
   target. No arrancar el timer.
6. Volver inmediatamente los modos tenant/product del canary a manual antes
   de iniciar la auditoría o cualquier reconciliación de estado.

## Auditoría posterior al canary

Verificar por identificadores internos, sin exponer payloads sensibles:

- exactamente un claim y un `claim_token` consumido;
- un solo documento y un solo folio asociado al intent;
- como máximo un submission attempt y un solo cruce de frontera de red;
- Track ID/resultado terminal persistido, o estado `AMBIGUOUS` si existe
  posibilidad de efecto remoto no confirmado;
- ausencia de otra fila automática o manual reclamada;
- ausencia de polling de estado y de recipient delivery por este scheduler.

Si hay documento o attempt persistido sin `before_fetch_at`, el estado esperado
tras expirar el lease es `BLOCKED` con evidencia preservada y sin retry. Si existe
`before_fetch_at` o cualquier contador de red, el estado esperado es
`AMBIGUOUS`, nunca un segundo intento automático.

## Canary dirigido DTE33

Sólo después de aprobar la auditoría DTE39, repetir la misma secuencia con un
nuevo outbox exacto cuyo tipo resuelto sea 33. No reutilizar documentos, intents,
folios ni targets históricos.

## Habilitación continua posterior

Después de aprobar ambos tipos:

1. Confirmar `DTE_AUTOMATIC_TARGET_OUTBOX_ID` vacío.
2. Habilitar un solo tenant y mantener los demás en manual.
3. Configurar `DTE_AUTOMATIC_WORKER_ENABLED=true`.
4. Habilitar e iniciar únicamente `citaya-dte-auto-worker.timer`.
5. Auditar cada documento inicial antes de ampliar tenants o frecuencia.

El timer usa `OnUnitInactiveSec`, por lo que programa desde la finalización del
oneshot. systemd no inicia una segunda instancia del mismo service mientras la
primera sigue activa.

## Verificación de separación manual/automática

```bash
systemctl list-timers citaya-dte-manual-worker.timer citaya-dte-auto-worker.timer
systemctl cat citaya-dte-manual-worker.service citaya-dte-auto-worker.service
systemctl show -p ActiveState -p SubState citaya-dte-manual-worker.service citaya-dte-auto-worker.service
```

Verificar que el manual usa `run-manual-worker-once.mjs` y
`DTE_TARGET_OUTBOX_ID`, mientras el automático usa
`run-automatic-worker-once.mjs` y `DTE_AUTOMATIC_TARGET_OUTBOX_ID`. Los claims
SQL y sus sweeps stale también deben permanecer separados por provenance.

## Rollback inmediato

1. Detener y deshabilitar el timer automático para impedir nuevos oneshots.
2. Poner `DTE_AUTOMATIC_WORKER_ENABLED=false`.
3. Volver los modos tenant/product del canary a manual.
4. No matar a ciegas un oneshot activo: clasificar primero su frontera.
5. Si aún es PRE-NETWORK, el próximo fence lo deja `BLOCKED` sin contactar SII.
6. Si ya es POST-NETWORK, permitir únicamente que persista Track ID/resultado;
   si no puede confirmarse, conservar `AMBIGUOUS` para reconciliación manual.
7. Confirmar que no queda timer automático activo ni target automático cargado.

Cambiar modos detiene trabajo nuevo y bloquea mutaciones pre-red, pero no debe
impedir guardar evidencia terminal de una operación que ya cruzó la frontera.
Cada boundary de seed/token/upload revalida gates: si caen después de un fetch,
se corta el fetch siguiente y la fila queda `AMBIGUOUS`. Sólo renew y persistencia
terminal ya disponible continúan después de la frontera; no se autoriza más red.
