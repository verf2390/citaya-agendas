export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "";

    const auth = await requireTenantAdmin(req, { tenantId });
    if (!auth.ok) return auth.response;

    // ✅ Listar customers por tenant (service role)
    const { data: customers, error } = await supabaseAdmin
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, notes, created_at")
      .eq("tenant_id", auth.tenantId)
      .order("full_name", { ascending: true })
      .limit(1000);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const customerIds = (customers ?? []).map((c) => c.id);
    const statsByCustomer = new Map<
      string,
      {
        appointment_count: number;
        last_appointment_at: string | null;
        total_paid: number;
        pending_payments: number;
      }
    >();

    customerIds.forEach((id) => {
      statsByCustomer.set(id, {
        appointment_count: 0,
        last_appointment_at: null,
        total_paid: 0,
        pending_payments: 0,
      });
    });

    if (customerIds.length > 0) {
      const { data: appointments, error: apptError } = await supabaseAdmin
        .from("appointments")
        .select(
          "customer_id, start_at, payment_status, payment_paid_amount, payment_required_amount",
        )
        .eq("tenant_id", auth.tenantId)
        .in("customer_id", customerIds);

      if (apptError) {
        return NextResponse.json(
          { ok: false, error: apptError.message },
          { status: 500 },
        );
      }

      for (const appt of appointments ?? []) {
        if (!appt.customer_id) continue;
        const current = statsByCustomer.get(appt.customer_id);
        if (!current) continue;

        current.appointment_count += 1;

        const startAt = appt.start_at ? String(appt.start_at) : null;
        if (
          startAt &&
          (!current.last_appointment_at ||
            new Date(startAt).getTime() >
              new Date(current.last_appointment_at).getTime())
        ) {
          current.last_appointment_at = startAt;
        }

        const paidAmount = Number(appt.payment_paid_amount ?? 0);
        if (Number.isFinite(paidAmount)) current.total_paid += paidAmount;

        const paymentStatus = String(appt.payment_status ?? "").toLowerCase();
        if (
          paymentStatus === "pending" ||
          paymentStatus === "pending_payment"
        ) {
          current.pending_payments += 1;
        }
      }
    }

    const enrichedCustomers = (customers ?? []).map((c) => ({
      ...c,
      stats: statsByCustomer.get(c.id) ?? {
        appointment_count: 0,
        last_appointment_at: null,
        total_paid: 0,
        pending_payments: 0,
      },
    }));

    return NextResponse.json({ ok: true, customers: enrichedCustomers });
  } catch (e: any) {
    console.error("[api/customers/list] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error listando customers" },
      { status: 500 },
    );
  }
}
