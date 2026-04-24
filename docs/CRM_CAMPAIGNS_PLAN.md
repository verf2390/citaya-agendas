# CRM CAMPAIGNS PLAN

## 1. Estado actual del CRM

- Existe listado de clientes por tenant en `app/admin/customers/page.tsx`.
- Existe ficha individual con historial en `app/admin/customers/[id]/page.tsx`.
- Existe API de historial consolidado por cliente.
- Existe preparación manual de campañas masivas:
  - filtros rápidos
  - export CSV/PDF
  - selección de canal `email | whatsapp | both`
  - generación de payload `bulkPayload`
- Hoy no existe ejecución real de campañas; la UI solo prepara el payload y lo envía a consola.

## 2. Datos disponibles del cliente

- `id`
- `tenant_id`
- `full_name`
- `phone`
- `email`
- `notes`
- `created_at`
- Historial derivado:
  - total de citas
  - última visita
  - próxima cita
  - `service_name`
  - `service_id`
  - `professional_id`
  - `professional_name`
  - `status`

## 3. Datos faltantes recomendados

- Fecha de nacimiento/cumpleaños
- Consentimiento por canal:
  - whatsapp opt-in
  - email opt-in
- Fuente de adquisición
- Última interacción de campaña
- Métricas RFM simples:
  - recencia
  - frecuencia
  - gasto o ticket si se integra pago
- Etiquetas/segmentos manuales
- Motivo de cancelación
- Idioma preferido

## 4. Idea de campañas automáticas

- Recordatorio de próxima cita por WhatsApp/email.
- Re-engagement a clientes sin volver en 30/60/90 días.
- Recuperación tras cancelación.
- Cumpleaños con cupón o beneficio.
- Clientes frecuentes con acceso anticipado o beneficio recurrente.
- Post-visita con solicitud de reseña o recompra.

## 5. Segmentos útiles

### Clientes inactivos
- Derivar desde `lastVisit` y ausencia de upcoming.

### Cumpleaños
- Requiere almacenar `birth_date`.

### Clientes frecuentes
- Contar citas confirmadas/completadas por ventana de tiempo.

### Clientes con reserva cancelada
- Filtrar historial con `status = canceled`.

### Clientes sin volver hace 30/60/90 días
- Derivar desde `lastVisit.start_at`.

## 6. Cómo conectarlo con n8n

1. Crear endpoint interno o acción server-side que emita `bulkPayload`.
2. Enviar a n8n:
   - `tenant_id`
   - `tenant_slug`
   - canal
   - asunto/mensaje
   - recipients
   - metadata del segmento
3. En n8n:
   - validar secreto
   - dividir por canal
   - usar Resend o proveedor WhatsApp
   - registrar resultado por cliente
4. Persistir en DB un log de campaña con estado por destinatario.

## 7. Qué habría que implementar después

- Endpoint real para campañas masivas.
- Tabla de campañas y tabla de entregas por cliente.
- Consentimientos por canal.
- Segmentación dinámica en backend, no solo en frontend.
- Jobs o webhooks n8n para actualizar métricas de entrega.
- Historial cronológico unificado cliente + campañas + citas + pagos.
