import { z } from "zod";

const AppointmentPaymentStatusSchema = z.enum([
  "not_required", "pending", "paid", "failed", "cancelled", "pay_later",
]);

const optionalShortText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const AppointmentCreateSchema = z.object({
  tenantId: z.string().uuid("tenantId inválido"),
  professionalId: z.string().uuid("professionalId inválido"),
  serviceId: z.string().uuid("serviceId inválido"),
  startAt: z.string().min(1).max(64)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "startAt inválido"),
  // Accepted during the transition but ignored: duration is server-derived.
  endAt: z.string().max(64).optional(),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: optionalShortText(32),
  customerEmail: z.string().trim().email().max(254).nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  status: optionalShortText(32),
  currency: optionalShortText(3),
  notes: optionalShortText(1000),
  paymentRequired: z.boolean().optional(),
  paymentStatus: AppointmentPaymentStatusSchema.optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export type AppointmentCreateInput = z.infer<typeof AppointmentCreateSchema>;
