# Citaya LAB Base Schema Setup

Estado: **LAB / PENDIENTE / NO PRODUCTIVO**.

Este documento prepara un Supabase LAB/certification vacio para poder aplicar despues `DTE_SUPABASE_MIGRATION.sql`. No activa produccion, emision legal, agenda/pagos automaticos ni submit real al SII.

## Objetivo

Crear solo el schema base minimo que la migracion DTE necesita y que el admin LAB puede consultar:

- `public.tenants`
- `public.tenant_members`
- `public.platform_admins`
- `public.customers`
- `public.appointments`
- `public.payments`

## Orden Manual

1. Confirmar que estas apuntando a Supabase LAB/certification, no production.
2. Tomar snapshot/export si el proyecto no esta completamente vacio.
3. Abrir `docs/dte-sii/CITAYA_LAB_BASE_SCHEMA.sql`.
4. Pegar y ejecutar el SQL completo en Supabase SQL editor.
5. Verificar que las 6 tablas existen.
6. Crear datos LAB minimos con SQL manual controlado:
   - un tenant LAB
   - un usuario auth real como `tenant_members.role = 'owner'` o `admin`
   - opcionalmente un `platform_admins` para soporte
   - customers/appointments/payments de prueba si se quiere validar referencias DTE
7. Ejecutar checks basicos de este documento.
8. Aplicar despues `docs/dte-sii/DTE_SUPABASE_MIGRATION.sql`.
9. Ejecutar `docs/dte-sii/DTE_SUPABASE_POST_MIGRATION_CHECKS.sql`.
10. Solo si todo pasa, activar temporalmente `DTE_PERSISTENCE_BACKEND=supabase` en LAB/certification.

## Checks Basicos Despues Del Base Schema

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'tenants',
    'tenant_members',
    'platform_admins',
    'customers',
    'appointments',
    'payments'
  )
order by table_name;
```

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'tenants',
    'tenant_members',
    'platform_admins',
    'customers',
    'appointments',
    'payments'
  )
order by tablename;
```

```sql
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'tenants',
    'tenant_members',
    'platform_admins',
    'customers',
    'appointments',
    'payments'
  )
order by tablename, policyname;
```

```sql
select
  public.citaya_lab_current_user_is_tenant_member(gen_random_uuid()) as random_member_false,
  public.citaya_lab_current_user_is_tenant_admin(gen_random_uuid()) as random_admin_false,
  public.citaya_lab_current_user_is_platform_admin() as current_platform_admin;
```

## Seed LAB Sugerido

Usar solo datos ficticios. Reemplazar UUIDs/emails por valores LAB reales.

```sql
-- 1) Crear tenant LAB.
insert into public.tenants (slug, name, admin_email, contact_email, phone_display)
values ('tenant-lab-dte', 'Tenant LAB DTE', 'lab@example.com', 'lab@example.com', '+56900000000')
returning id;

-- 2) Asociar un usuario auth real al tenant.
-- Reemplazar ambos UUIDs.
insert into public.tenant_members (tenant_id, user_id, role, is_active)
values ('<tenant_id>', '<auth_user_id>', 'owner', true);

-- 3) Opcional: platform admin de soporte LAB.
insert into public.platform_admins (user_id, role, is_active)
values ('<auth_user_id>', 'support', true)
on conflict (user_id) do update set is_active = excluded.is_active, role = excluded.role;

-- 4) Cliente/cita/pago LAB opcionales para referencias DTE.
insert into public.customers (tenant_id, full_name, email, phone)
values ('<tenant_id>', 'Cliente Demo LAB', 'cliente.lab@example.com', '+56911111111')
returning id;

insert into public.appointments (
  tenant_id,
  customer_id,
  customer_name,
  customer_email,
  service_name,
  start_at,
  end_at,
  status,
  booking_status,
  payment_status,
  payment_required,
  payment_required_amount,
  payment_paid_amount,
  payment_remaining_amount,
  payment_reference
) values (
  '<tenant_id>',
  '<customer_id>',
  'Cliente Demo LAB',
  'cliente.lab@example.com',
  'Servicio Demo LAB',
  now() + interval '1 day',
  now() + interval '1 day' + interval '1 hour',
  'confirmed',
  'confirmed',
  'pending',
  true,
  11900,
  0,
  11900,
  'lab-payment-reference-001'
)
returning id;

insert into public.payments (tenant_id, appointment_id, external_reference, amount, status, provider)
values ('<tenant_id>', '<appointment_id>', 'lab-payment-reference-001', 11900, 'pending', 'lab')
returning id;
```

## Despues De Aplicar DTE

Con base schema listo, aplicar:

1. `docs/dte-sii/DTE_SUPABASE_MIGRATION.sql`
2. `docs/dte-sii/DTE_SUPABASE_POST_MIGRATION_CHECKS.sql`
3. Validar tenant isolation A/B.
4. Activar temporalmente solo en LAB/certification:

```bash
DTE_PERSISTENCE_BACKEND=supabase
```

5. Correr:

```bash
npm run dte:persistence:check
npm run dte:persistence:trace
npm run dte:sii:dry-run:trace
npm run build
npm run dte:test
```

## Rollback Logico

Si algo falla:

```bash
DTE_PERSISTENCE_BACKEND=memory
```

No borrar tablas inmediatamente. Revisar logs, policies, RLS y datos LAB insertados. Corregir SQL en repo y reaplicar solo en LAB/certification.

## Que NO Es Esto

- No es schema productivo.
- No emite documentos legales.
- No aprueba SII.
- No crea `track_id` real.
- No conecta agenda/pagos reales.
- No guarda secretos, tokens completos, private keys, certificados completos ni CAF XML.
- No reemplaza una migracion productiva futura del schema completo de Citaya.
