import { AIError } from "@/lib/ai/errors";
import type { AITool } from "@/lib/ai/types";

export type AppointmentStatusRow = {
  id: string;
  status: string | null;
  booking_status: string | null;
};

export type CustomerReadRow = {
  id: string;
  full_name: string | null;
};

export type CustomerAppointmentRow = {
  customer_id: string | null;
  start_at: string | null;
  service_name: string | null;
  status: string | null;
  booking_status: string | null;
};

export type ReceivableRow = CustomerAppointmentRow & {
  id: string;
  customer_name: string | null;
  payment_status: string | null;
  payment_required_amount: number | string | null;
  payment_paid_amount: number | string | null;
  payment_remaining_amount: number | string | null;
};

export interface CitayaAppReadRepository {
  listAppointmentsForRange(input: {
    tenantId: string;
    startIso: string;
    endIso: string;
    signal?: AbortSignal;
  }): Promise<AppointmentStatusRow[]>;
  listCustomers(input: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<CustomerReadRow[]>;
  listPastCustomerAppointments(input: {
    tenantId: string;
    customerIds: string[];
    throughIso: string;
    signal?: AbortSignal;
  }): Promise<CustomerAppointmentRow[]>;
  listPendingReceivables(input: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<ReceivableRow[]>;
}

const CANCELED_STATUSES = new Set(["canceled", "cancelled", "cancelada"]);
const NON_VISIT_STATUSES = new Set([
  ...CANCELED_STATUSES,
  "no_show",
  "expired",
]);
const NON_RECEIVABLE_STATUSES = new Set([
  ...CANCELED_STATUSES,
  "expired",
]);

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function hasStatus(
  row: { status: string | null; booking_status: string | null },
  statuses: Set<string>,
) {
  return (
    statuses.has(normalized(row.status)) ||
    statuses.has(normalized(row.booking_status))
  );
}

function isCanceled(row: { status: string | null; booking_status: string | null }) {
  return hasStatus(row, CANCELED_STATUSES);
}

function isNonVisit(row: { status: string | null; booking_status: string | null }) {
  return hasStatus(row, NON_VISIT_STATUSES);
}

function isNonReceivable(
  row: { status: string | null; booking_status: string | null },
) {
  return hasStatus(row, NON_RECEIVABLE_STATUSES);
}

function exactObject(value: unknown, allowedKeys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AIError("AI_TOOL_INVALID_ARGUMENTS", "Argumentos inválidos");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new AIError("AI_TOOL_INVALID_ARGUMENTS", "Argumentos no permitidos");
  }
  return record;
}

function integerArgument(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AIError("AI_TOOL_INVALID_ARGUMENTS", "Número fuera de rango");
  }
  return parsed;
}

function parseDateKey(value: unknown) {
  const dateKey = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new AIError("AI_TOOL_INVALID_ARGUMENTS", "Fecha inválida");
  }
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw new AIError("AI_TOOL_INVALID_ARGUMENTS", "Fecha inválida");
  }
  return dateKey;
}

function zonedDateTimeParts(instantMs: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

function localMidnightToUtc(dateKey: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = targetAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const local = zonedDateTimeParts(guess, timezone);
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    guess = targetAsUtc - (representedAsUtc - guess);
  }
  return new Date(guess);
}

function nextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizedPrompt(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function wantsGenerativeResponse(message: string) {
  return /\b(redact|mensaje|campan|analiz|explic|suger|recomiend|resum|compara|estrateg)\w*/.test(
    normalizedPrompt(message),
  );
}

function dateLabel(value: unknown, timezone: string) {
  const raw = String(value ?? "");
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function clp(value: unknown) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function receivableAmount(row: ReceivableRow) {
  const remaining = money(row.payment_remaining_amount);
  if (remaining > 0) return remaining;
  return Math.max(
    money(row.payment_required_amount) - money(row.payment_paid_amount),
    0,
  );
}

function countAppointmentsTool(repository: CitayaAppReadRepository): AITool {
  return {
    definition: {
      name: "count_appointments",
      description:
        "Cuenta las reservas de una fecha local del tenant actual. Úsala para preguntas como hoy o mañana.",
      inputSchema: {
        type: "object",
        properties: {
          date: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Fecha local YYYY-MM-DD en America/Santiago.",
          },
        },
        required: ["date"],
        additionalProperties: false,
      },
    },
    async execute(argumentsValue, context) {
      const args = exactObject(argumentsValue, ["date"]);
      const date = parseDateKey(args.date);
      const start = localMidnightToUtc(date, context.timezone);
      const end = localMidnightToUtc(nextDateKey(date), context.timezone);
      const rows = await repository.listAppointmentsForRange({
        tenantId: context.tenantId,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        signal: context.signal,
      });
      const canceled = rows.filter(isCanceled).length;
      return {
        date,
        timezone: context.timezone,
        active: rows.length - canceled,
        canceled,
        total: rows.length,
      };
    },
    directResponse({ message, output }) {
      const prompt = normalizedPrompt(message);
      if (
        wantsGenerativeResponse(message) ||
        (!prompt.includes("reserva") && !prompt.includes("cita"))
      ) {
        return null;
      }
      const result = output as {
        date?: unknown;
        active?: unknown;
        canceled?: unknown;
        total?: unknown;
      };
      const active = Number(result.active);
      const canceled = Number(result.canceled);
      const total = Number(result.total);
      if (![active, canceled, total].every(Number.isFinite)) return null;
      const when = prompt.includes("manana")
        ? "Mañana"
        : prompt.includes("hoy")
          ? "Hoy"
          : `El ${String(result.date ?? "")}`;
      return `${when} tienes ${active} ${active === 1 ? "reserva activa" : "reservas activas"} y ${canceled} ${canceled === 1 ? "cancelada" : "canceladas"}. Total: ${total}.`;
    },
  };
}

function inactiveCustomersTool(repository: CitayaAppReadRepository): AITool {
  return {
    definition: {
      name: "list_inactive_customers",
      description:
        "Lista clientes cuya última visita no cancelada fue hace más de cierta cantidad de días.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer", minimum: 1, maximum: 3650 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["days", "limit"],
        additionalProperties: false,
      },
    },
    async execute(argumentsValue, context) {
      const args = exactObject(argumentsValue, ["days", "limit"]);
      const days = integerArgument(args.days, 1, 3650);
      const limit = integerArgument(args.limit, 1, 50);
      const customers = await repository.listCustomers({
        tenantId: context.tenantId,
        signal: context.signal,
      });
      const appointments = await repository.listPastCustomerAppointments({
        tenantId: context.tenantId,
        customerIds: customers.map((customer) => customer.id),
        throughIso: context.now.toISOString(),
        signal: context.signal,
      });
      const latestByCustomer = new Map<string, CustomerAppointmentRow>();
      for (const appointment of appointments) {
        if (!appointment.customer_id || !appointment.start_at || isNonVisit(appointment)) {
          continue;
        }
        const previous = latestByCustomer.get(appointment.customer_id);
        if (
          !previous?.start_at ||
          new Date(appointment.start_at).getTime() >
            new Date(previous.start_at).getTime()
        ) {
          latestByCustomer.set(appointment.customer_id, appointment);
        }
      }
      const cutoffMs = context.now.getTime() - days * 24 * 60 * 60 * 1000;
      const inactive = customers
        .map((customer) => ({
          customer,
          last: latestByCustomer.get(customer.id),
        }))
        .filter(({ last }) => {
          if (!last?.start_at) return false;
          return new Date(last.start_at).getTime() < cutoffMs;
        })
        .sort(
          (left, right) =>
            new Date(left.last?.start_at ?? 0).getTime() -
            new Date(right.last?.start_at ?? 0).getTime(),
        );

      return {
        days,
        totalMatched: inactive.length,
        returned: Math.min(inactive.length, limit),
        customers: inactive.slice(0, limit).map(({ customer, last }) => ({
          customerId: customer.id,
          name: customer.full_name?.trim() || "Cliente",
          lastVisitAt: last?.start_at,
          lastService: last?.service_name,
          daysSinceLastVisit: Math.floor(
            (context.now.getTime() - new Date(last?.start_at ?? 0).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        })),
      };
    },
    directResponse({ message, output, context }) {
      const prompt = normalizedPrompt(message);
      if (
        wantsGenerativeResponse(message) ||
        (!prompt.includes("inactiv") &&
          !prompt.includes("sin venir") &&
          !prompt.includes("sin asistir"))
      ) {
        return null;
      }
      const result = output as {
        days?: unknown;
        totalMatched?: unknown;
        returned?: unknown;
        customers?: Array<{
          name?: unknown;
          lastVisitAt?: unknown;
          lastService?: unknown;
          daysSinceLastVisit?: unknown;
        }>;
      };
      const totalMatched = Number(result.totalMatched);
      const returned = Number(result.returned);
      if (
        !Number.isFinite(totalMatched) ||
        !Number.isFinite(returned) ||
        !Array.isArray(result.customers)
      ) {
        return null;
      }
      if (totalMatched === 0) {
        return `No encontré clientes con más de ${Number(result.days) || 0} días sin una visita válida.`;
      }
      const lines = result.customers.map((customer) => {
        const name = String(customer.name ?? "Cliente");
        const days = Number(customer.daysSinceLastVisit);
        const service = String(customer.lastService ?? "").trim();
        const visit = dateLabel(customer.lastVisitAt, context.timezone);
        const detail = [
          visit ? `última visita ${visit}` : "",
          service || "",
          Number.isFinite(days) ? `hace ${days} días` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `- ${name}${detail ? `: ${detail}` : ""}`;
      });
      const intro =
        returned < totalMatched
          ? `Encontré ${totalMatched} clientes. Muestro ${returned}:`
          : `Encontré ${totalMatched} ${totalMatched === 1 ? "cliente" : "clientes"}:`;
      return `${intro}\n${lines.join("\n")}`;
    },
  };
}

function pendingReceivablesTool(repository: CitayaAppReadRepository): AITool {
  return {
    definition: {
      name: "get_pending_receivables",
      description:
        "Resume saldos pendientes por cobrar de reservas del tenant actual. No ejecuta cobros.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["limit"],
        additionalProperties: false,
      },
    },
    async execute(argumentsValue, context) {
      const args = exactObject(argumentsValue, ["limit"]);
      const limit = integerArgument(args.limit, 1, 50);
      const rows = await repository.listPendingReceivables({
        tenantId: context.tenantId,
        signal: context.signal,
      });
      const pending = rows
        .filter((row) => !isNonReceivable(row))
        .map((row) => ({ row, amount: receivableAmount(row) }))
        .filter(
          ({ row, amount }) =>
            amount > 0 && normalized(row.payment_status) !== "paid",
        )
        .sort((left, right) => right.amount - left.amount);

      return {
        currency: "CLP",
        count: pending.length,
        total: pending.reduce((sum, item) => sum + item.amount, 0),
        returned: Math.min(pending.length, limit),
        items: pending.slice(0, limit).map(({ row, amount }) => ({
          appointmentId: row.id,
          customerName: row.customer_name?.trim() || "Cliente",
          serviceName: row.service_name,
          appointmentAt: row.start_at,
          amount,
        })),
      };
    },
    directResponse({ message, output }) {
      const prompt = normalizedPrompt(message);
      if (
        wantsGenerativeResponse(message) ||
        !prompt.includes("pendiente") ||
        (!prompt.includes("cobrar") &&
          !prompt.includes("cobro") &&
          !prompt.includes("saldo") &&
          !prompt.includes("pago"))
      ) {
        return null;
      }
      const result = output as {
        count?: unknown;
        total?: unknown;
      };
      const count = Number(result.count);
      const total = clp(result.total);
      if (!Number.isFinite(count) || total === null) return null;
      if (count === 0) return "No tienes saldos pendientes por cobrar.";
      return `Tienes ${count} ${count === 1 ? "saldo pendiente" : "saldos pendientes"} por un total de ${total}.`;
    },
  };
}

export function createCitayaAppReadTools(
  repository: CitayaAppReadRepository,
): AITool[] {
  return [
    countAppointmentsTool(repository),
    inactiveCustomersTool(repository),
    pendingReceivablesTool(repository),
  ];
}

export const citayaAppToolInternals = {
  localMidnightToUtc,
  nextDateKey,
};
