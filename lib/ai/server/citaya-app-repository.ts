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

export class SupabaseCitayaAppReadRepository
  implements CitayaAppReadRepository
{
  async listAppointmentsForRange(input: {
    tenantId: string;
    startIso: string;
    endIso: string;
  }) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select("id, status, booking_status")
      .eq("tenant_id", input.tenantId)
      .gte("start_at", input.startIso)
      .lt("start_at", input.endIso)
      .limit(2000);
    if (error) throw new Error("AI_APPOINTMENT_READ_FAILED");
    return (data ?? []) as AppointmentStatusRow[];
  }

  async listCustomers(tenantId: string) {
    const { data, error } = await supabaseAdmin
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true })
      .limit(500);
    if (error) throw new Error("AI_CUSTOMER_READ_FAILED");
    return (data ?? []) as CustomerReadRow[];
  }

  async listPastCustomerAppointments(input: {
    tenantId: string;
    customerIds: string[];
    throughIso: string;
  }) {
    if (input.customerIds.length === 0) return [];
    const rows: CustomerAppointmentRow[] = [];
    for (let offset = 0; offset < input.customerIds.length; offset += 100) {
      const ids = input.customerIds.slice(offset, offset + 100);
      const { data, error } = await supabaseAdmin
        .from("appointments")
        .select("customer_id, start_at, service_name, status, booking_status")
        .eq("tenant_id", input.tenantId)
        .in("customer_id", ids)
        .lte("start_at", input.throughIso)
        .order("start_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error("AI_CUSTOMER_APPOINTMENT_READ_FAILED");
      rows.push(...((data ?? []) as CustomerAppointmentRow[]));
    }
    return rows;
  }

  async listPendingReceivables(input: { tenantId: string; limit: number }) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select(
        "id, customer_id, customer_name, service_name, start_at, status, booking_status, payment_status, payment_required_amount, payment_paid_amount, payment_remaining_amount",
      )
      .eq("tenant_id", input.tenantId)
      .or("payment_remaining_amount.gt.0,payment_required_amount.gt.0")
      .order("start_at", { ascending: false })
      .limit(Math.min(Math.max(input.limit, 1), 500));
    if (error) throw new Error("AI_RECEIVABLE_READ_FAILED");
    return (data ?? []) as ReceivableRow[];
  }
}
