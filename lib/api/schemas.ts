import { z } from "zod";

export const AppointmentCreateSchema = z.object({
  tenantId: z.string().uuid("tenantId inválido"),
  professionalId: z.string().uuid("professionalId inválido"),

  // ISO
  startAt: z.string().min(1, "startAt requerido"),
  endAt: z.string().min(1, "endAt requerido"),

  // cliente (snapshot)
  customerName: z.string().min(1, "customerName requerido"),
  customerPhone: z.string().min(1, "customerPhone requerido").nullable().optional(),
  customerEmail: z.string().email("customerEmail inválido").nullable().optional(),

  // relación opcional (si la tienes)
  customerId: z.string().uuid("customerId inválido").nullable().optional(),

  // servicio opcional: si viene, copiamos snapshot
  serviceId: z.string().uuid("serviceId inválido").nullable().optional(),

  // opcionales que sí existen en tu tabla
  status: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type AppointmentCreateInput = z.infer<typeof AppointmentCreateSchema>;
