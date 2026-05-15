# DTE Schema Compatibility Audit

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Auditoria previa a aplicar `DTE_SUPABASE_MIGRATION.sql`. No se aplico migracion ni se activo `DTE_PERSISTENCE_BACKEND=supabase`.

## Hallazgos

| Pregunta | Resultado |
| --- | --- |
| ¿Existe `tenants.id`? | Si, inferido por schemas y codigo: `tenant_billing_settings`, `waitlist_requests`, `message_logs`, rutas admin y publicas referencian `tenants(id)` / `public.tenants(id)`. |
| ¿`tenant_members` usa `tenant_id`? | No hay schema SQL en el repo. Solo aparece como referencia documental/TODO. La migracion lo trata como supuesto y RLS retorna `false` si la tabla no existe. |
| ¿`tenant_members` usa `user_id` o email? | No confirmado. El supuesto documentado es `tenant_members(tenant_id, user_id, role)`, pero debe verificarse contra Supabase real. |
| ¿`platform_admins` existe? | No hay schema SQL en el repo. Solo aparece como referencia documental. La funcion RLS retorna `false` si no existe. |
| ¿`appointments.id` existe y conviene FK? | `appointments` existe en codigo y docs, con `id` y `tenant_id`. No hay schema canonico completo en repo. Conviene FK en una migracion posterior tras inspeccionar DB live. |
| ¿`payments` existe? | Si, usado por pagos/webhooks y documentado en `PAYMENTS_OPTIONAL_FLOW.md`. No hay schema canonico completo en repo. Mantener `payment_id`/`payment_reference` nullable sin FK por ahora. |
| ¿`customers` existe? | Si, usado por rutas `customers/*` con `id` y `tenant_id`. No hay schema SQL canonico en repo. Mantener `customer_id` nullable sin FK por ahora. |

## Supuestos De La Migracion DTE

- `public.tenants(id)` existe y es UUID.
- DTE usa `tenant_id` obligatorio en todas las tablas.
- `auth.uid()` esta disponible en Supabase RLS.
- Service role opera solo desde backend controlado.
- `tenant_members` y `platform_admins` pueden existir en Supabase real, pero no estan confirmadas por repo.

## Relaciones Seguras Ahora

- FK real: todas las tablas DTE referencian `public.tenants(id)` con `on delete restrict`.
- FK real entre tablas DTE: submissions/history/audit referencian documentos o submissions sin cascada destructiva.
- Referencias externas nullable: `appointment_id`, `payment_id`, `customer_id`, `payment_reference`.

## Riesgos Detectados

- El repo no trae schema real de `tenant_members`; no se puede garantizar RLS por rol hasta inspeccionar Supabase.
- El repo no trae schema real de `platform_admins`; soporte platform admin queda desactivado si la tabla no existe.
- Agregar FK a `appointments/payments/customers` sin revisar tipos exactos puede romper la migracion.
- `service role` bypasses RLS; debe quedar solo en API server.
- No debe haber `on delete cascade` en documentos tributarios: se cambio a `restrict` para preservar auditoria.

## Ajustes Necesarios Antes De Aplicar

1. Confirmar en Supabase real:
   - `public.tenant_members` existe.
   - columnas: `tenant_id uuid`, `user_id uuid`, `role text`.
   - roles validos: `owner`, `admin` u otros.
2. Confirmar `public.platform_admins(user_id uuid)` o ajustar funcion.
3. Confirmar tipos exactos de:
   - `appointments.id`, `appointments.tenant_id`
   - `payments.id`, `payments.tenant_id`
   - `customers.id`, `customers.tenant_id`
4. Ejecutar `DTE_SUPABASE_POST_MIGRATION_CHECKS.sql` despues de aplicar en LAB/certification.
5. Solo entonces activar temporalmente `DTE_PERSISTENCE_BACKEND=supabase` en entorno LAB/certification.

## Decision Actual

La migracion queda lista para revision manual, pero con TODO explicitos para RLS real. Si `tenant_members/platform_admins` no existen, las policies no exponen datos al frontend: retornan `false` y solo service role backend puede operar.
