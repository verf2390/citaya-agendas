import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeRut, validateRut } from "@/lib/dte/rut";
import { settlementAppointmentPeriod, settlementToday } from "@/lib/settlements/appointment-period.mjs";
import { requireSettlementsDemoAdmin } from "@/lib/settlements/demo-access";
import { MAX_DEMO_SETTLEMENT_AMOUNT, type DemoSettlementAppointment } from "@/lib/settlements/demo-types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const headers = { "Cache-Control": "private, no-store" };
const settlementColumns =
  "id,appointment_id,professional_name,service_name,start_at,simulated_amount,percentage_bps,professional_amount,business_amount";
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("professional"),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    rut: z.string().trim().max(24).refine(validateRut),
    role: z.enum(["professional", "assistant"]),
  }),
  z.object({
    action: z.literal("settlement"),
    appointmentId: z.string().uuid(),
    simulatedAmount: z.number().int().min(1).max(MAX_DEMO_SETTLEMENT_AMOUNT),
    percentageBps: z.number().int().min(0).max(10_000),
  }),
]);

function json(value: object, status = 200) {
  return NextResponse.json(value, { status, headers });
}

function denied(status: number) {
  return json({ error: "No se pudo acceder a Liquidaciones de demo." }, status);
}

export async function HEAD(req: Request) {
  const access = await requireSettlementsDemoAdmin(req);
  return new Response(null, { status: access.ok ? 200 : access.status, headers });
}

async function appointmentsInPeriod(tenantId: string, start: string, end: string) {
  const appointments: DemoSettlementAppointment[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin.rpc("list_demo_settlement_appointments", {
      p_tenant_id: tenantId,
      p_appointment_id: null,
      p_start_at: start,
      p_end_at: end,
    }).order("start_at", { ascending: false }).order("id").range(offset, offset + pageSize - 1);

    if (error) return { data: null, error };
    appointments.push(...data);
    if (data.length < pageSize) return { data: appointments, error: null };
  }
}

export async function GET(req: Request) {
  const access = await requireSettlementsDemoAdmin(req);
  if (!access.ok) return denied(access.status);

  const params = new URL(req.url).searchParams;
  const period = settlementAppointmentPeriod(params.get("date") ?? settlementToday(), params.get("period") ?? "month");
  if (!period) return json({ error: "El periodo de citas no es válido." }, 400);

  const [appointments, professionals, settlements] = await Promise.all([
    appointmentsInPeriod(access.tenantId, period.start, period.end),
    supabaseAdmin.from("demo_professional_profiles")
      .select("professional_id,email,rut,role,professionals!inner(name)")
      .eq("tenant_id", access.tenantId)
      .order("professionals(name)"),
    supabaseAdmin.from("demo_professional_settlements")
      .select(settlementColumns)
      .eq("tenant_id", access.tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
  ]);

  if (appointments.error || professionals.error || settlements.error) {
    console.error("[demo-liquidaciones] list failed", {
      appointments: appointments.error?.code,
      professionals: professionals.error?.code,
      settlements: settlements.error?.code,
    });
    return json({ error: "No se pudieron cargar las liquidaciones de demo." }, 503);
  }

  return json({ appointments: appointments.data, professionals: professionals.data, settlements: settlements.data });
}

export async function POST(req: Request) {
  const access = await requireSettlementsDemoAdmin(req);
  if (!access.ok) return denied(access.status);

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error = field === "rut" ? "Ingresa un RUT válido." : "Revisa los datos del formulario.";
    return json({ error }, 400);
  }

  const input = parsed.data;
  if (input.action === "professional") {
    const { data, error } = await supabaseAdmin.rpc("create_demo_settlement_professional", {
      p_tenant_id: access.tenantId,
      p_name: input.name,
      p_email: input.email,
      p_rut: normalizeRut(input.rut),
      p_role: input.role,
    });

    if (error?.code === "23505") return json({ error: "Ya existe un registro con esos datos." }, 409);
    if (error) {
      console.error("[demo-liquidaciones] professional creation failed", { code: error.code });
      return json({ error: "No se pudo agregar a la persona." }, 503);
    }
    if (!data) return denied(404);
    return json({ professionalId: data }, 201);
  }

  const { data, error } = await supabaseAdmin.rpc("create_demo_professional_settlement", {
    p_tenant_id: access.tenantId,
    p_appointment_id: input.appointmentId,
    p_actor_id: access.userId,
    p_simulated_amount: input.simulatedAmount,
    p_percentage_bps: input.percentageBps,
  }).select(settlementColumns).maybeSingle();

  if (error) {
    console.error("[demo-liquidaciones] settlement creation failed", { code: error.code });
    return json({ error: "No se pudo guardar el cierre de demo." }, 503);
  }
  if (!data) return json({ error: "La cita ya tiene un cierre o dejó de estar disponible." }, 409);
  return json({ settlement: data }, 201);
}
