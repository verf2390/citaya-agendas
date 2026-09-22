import type {
  AppointmentStatusRow,
  CitayaAppReadRepository,
  CustomerAppointmentRow,
  CustomerReadRow,
  ReceivableRow,
} from "@/lib/ai/tools/citaya-app-read";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

if (typeof window !== "undefined") {
  throw new Error("Citaya App AI repository is server-only");
}

const READ_PAGE_SIZE = 500;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("AI_READ_ABORTED");
}

export class SupabaseCitayaAppReadRepository
  implements CitayaAppReadRepository
{
  async listAppointmentsForRange(input: {
    tenantId: string;
    startIso: string;
    endIso: string;
    signal?: AbortSignal;
  }) {
    const rows: AppointmentStatusRow[] = [];
    for (let from = 0; ; from += READ_PAGE_SIZE) {
      throwIfAborted(input.signal);
      const query = supabaseAdmin
        .from("appointments")
        .select("id, status, booking_status")
        .eq("tenant_id", input.tenantId)
        .gte("start_at", input.startIso)
        .lt("start_at", input.endIso)
        .order("id", { ascending: true })
        .range(from, from + READ_PAGE_SIZE - 1);
      if (input.signal) query.abortSignal(input.signal);
      const { data, error } = await query;
      if (error) throw new Error("AI_APPOINTMENT_READ_FAILED");
      const page = (data ?? []) as AppointmentStatusRow[];
      rows.push(...page);
      if (page.length < READ_PAGE_SIZE) return rows;
    }
  }

  async listCustomers(input: { tenantId: string; signal?: AbortSignal }) {
    const rows: CustomerReadRow[] = [];
    for (let from = 0; ; from += READ_PAGE_SIZE) {
      throwIfAborted(input.signal);
      const query = supabaseAdmin
        .from("customers")
        .select("id, full_name")
        .eq("tenant_id", input.tenantId)
        .order("full_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + READ_PAGE_SIZE - 1);
      if (input.signal) query.abortSignal(input.signal);
      const { data, error } = await query;
      if (error) throw new Error("AI_CUSTOMER_READ_FAILED");
      const page = (data ?? []) as CustomerReadRow[];
      rows.push(...page);
      if (page.length < READ_PAGE_SIZE) return rows;
    }
  }

  async listPastCustomerAppointments(input: {
    tenantId: string;
    customerIds: string[];
    throughIso: string;
    signal?: AbortSignal;
  }) {
    if (input.customerIds.length === 0) return [];
    const rows: CustomerAppointmentRow[] = [];
    for (let offset = 0; offset < input.customerIds.length; offset += 100) {
      const ids = input.customerIds.slice(offset, offset + 100);
      for (let from = 0; ; from += READ_PAGE_SIZE) {
        throwIfAborted(input.signal);
        const query = supabaseAdmin
          .from("appointments")
          .select("customer_id, start_at, service_name, status, booking_status")
          .eq("tenant_id", input.tenantId)
          .in("customer_id", ids)
          .lte("start_at", input.throughIso)
          .order("start_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + READ_PAGE_SIZE - 1);
        if (input.signal) query.abortSignal(input.signal);
        const { data, error } = await query;
        if (error) throw new Error("AI_CUSTOMER_APPOINTMENT_READ_FAILED");
        const page = (data ?? []) as CustomerAppointmentRow[];
        rows.push(...page);
        if (page.length < READ_PAGE_SIZE) break;
      }
    }
    return rows;
  }

  async listPendingReceivables(input: {
    tenantId: string;
    signal?: AbortSignal;
  }) {
    const rows: ReceivableRow[] = [];
    for (let from = 0; ; from += READ_PAGE_SIZE) {
      throwIfAborted(input.signal);
      const query = supabaseAdmin
        .from("appointments")
        .select(
          "id, customer_id, customer_name, service_name, start_at, status, booking_status, payment_status, payment_required_amount, payment_paid_amount, payment_remaining_amount",
        )
        .eq("tenant_id", input.tenantId)
        .or("payment_remaining_amount.gt.0,payment_required_amount.gt.0")
        .order("start_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + READ_PAGE_SIZE - 1);
      if (input.signal) query.abortSignal(input.signal);
      const { data, error } = await query;
      if (error) throw new Error("AI_RECEIVABLE_READ_FAILED");
      const page = (data ?? []) as ReceivableRow[];
      rows.push(...page);
      if (page.length < READ_PAGE_SIZE) return rows;
    }
  }
}
