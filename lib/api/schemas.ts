import { z } from "zod";

const AppointmentPaymentStatusSchema = z.enum([
  "not_required",
  "pending",
  "paid",
  "failed",
  "cancelled",
]);

export const AppointmentCreateSchema = z.object({
  tenantId: z.string().uuid("tenantId inválido"),
  professionalId: z.string().uuid("professionalId inválido"),

  // ISO
  startAt: z
    .string()
    .min(1, "startAt requerido")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "startAt inválido"),
  endAt: z
    .string()
    .min(1, "endAt requerido")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "endAt inválido"),

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
  paymentRequired: z.boolean().optional(),
  paymentStatus: AppointmentPaymentStatusSchema.optional(),
});

export type AppointmentCreateInput = z.infer<typeof AppointmentCreateSchema>;
