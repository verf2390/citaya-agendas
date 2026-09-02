# Citaya DTE SII Client Lab

`sii-client.placeholder.ts` simula las operaciones necesarias para avanzar el laboratorio sin llamar endpoints reales.

Funciones mock:

- `getSeed()`
- `getToken()`
- `sendDteToSii()`
- `getDteStatus()`

Pendiente para certificación:

- Separar explícitamente ambiente `certification` y `production`.
- Implementar obtención real de semilla/token SII.
- Enviar sobre DTE firmado al endpoint de certificación.
- Persistir `track_id`, estado y respuesta resumida por tenant/documento.
- Consultar estado SII con manejo de rechazos y reintentos.
- Agregar idempotencia para evitar reenvíos accidentales.

Este módulo no debe usarse desde flujos productivos hasta completar certificación y revisión de seguridad.

