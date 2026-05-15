# DTE Supabase Apply Plan

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Este plan no activa produccion, no emite documentos legales, no conecta agenda/pagos y no hace submit real al SII.

## Pasos

1. **Backup / snapshot**
   - Tomar snapshot Supabase o backup SQL antes de aplicar.
   - Confirmar entorno LAB/certification, no production.

2. **Revisar SQL**
   - Leer `DTE_SCHEMA_COMPATIBILITY_AUDIT.md`.
   - Revisar `DTE_SUPABASE_MIGRATION.sql` completo.
   - Confirmar que no hay `on delete cascade` en documentos tributarios.

3. **Validar membresias reales**
   - Confirmar si existe `public.tenant_members`.
   - Confirmar columnas: `tenant_id`, `user_id`, `role`.
   - Confirmar roles admin reales.
   - Confirmar si existe `public.platform_admins(user_id)`.
   - Ajustar funciones RLS si el schema real difiere.

4. **Aplicar en Supabase SQL editor o migracion controlada**
   - Aplicar solo en LAB/certification.
   - No cambiar `DTE_PERSISTENCE_BACKEND` todavia.

5. **Validar tablas**
   - Ejecutar `DTE_SUPABASE_POST_MIGRATION_CHECKS.sql`.
   - Confirmar tablas, indices, constraints, comments y triggers.

6. **Validar RLS**
   - Probar usuario tenant A y tenant B.
   - Tenant A no debe ver documentos/folios/certificados de tenant B.
   - Platform admin solo si el schema real existe y esta revisado.

7. **Probar tenant demo**
   - Usar tenant demo LAB.
   - No usar certificado, CAF ni folios reales productivos.
   - No guardar secretos.

8. **Activar temporalmente Supabase backend solo en LAB/certification**
   ```bash
   DTE_PERSISTENCE_BACKEND=supabase
   ```
   - Mantener production desactivado.
   - Mantener submit SII real bloqueado.

9. **Ejecutar scripts**
   ```bash
   npm run dte:persistence:check
   npm run dte:persistence:trace
   node scripts/dte/sii-certification-smoke.mjs --dry-run
   ```

10. **Revisar UI trazas**
    - Abrir `/admin/facturacion`.
    - Confirmar backend `supabase`.
    - Confirmar estado `LAB / PENDIENTE / NO PRODUCTIVO`.
    - Confirmar que no se exponen XML completos, tokens, private paths ni secrets.

11. **Rollback si falla**
    - Desactivar `DTE_PERSISTENCE_BACKEND`.
    - Volver a `memory`.
    - No borrar tablas salvo decision manual posterior.
    - Revisar logs de API y Supabase.
    - Corregir SQL/RLS y repetir en entorno LAB.

## Criterio Para Avanzar

Solo avanzar si:

- RLS queda validada entre tenants reales de prueba.
- Service role inserta desde backend controlado.
- No hay paths privados ni tokens completos en responses.
- `DTE_SUPABASE_PERSISTENCE_NOT_READY` desaparece solo despues de migracion aplicada.
- Readiness sigue mostrando **LAB / PENDIENTE / NO PRODUCTIVO**.
