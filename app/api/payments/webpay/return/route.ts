import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

function webpayBaseUrl(environment?: string | null) {
  return environment === "production"
    ? "https://webpay3g.transbank.cl"
    : "https://webpay3gint.transbank.cl";
}

function redirectResult(req: Request, status: "success" | "failure" | "pending") {
  const url = new URL("/reservar/resultado", new URL(req.url).origin);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  return handleWebpayReturn(req);
}

export async function POST(req: Request) {
  return handleWebpayReturn(req);
}

async function handleWebpayReturn(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const appointmentId = String(url.searchParams.get("appointmentId") ?? "").trim();
    let token = String(url.searchParams.get("token_ws") ?? "").trim();

    if (req.method === "POST" && !token) {
      const form = await req.formData().catch(() => null);
      token = String(form?.get("token_ws") ?? "").trim();
    }

    if (!tenantId || !isUuid(tenantId) || !appointmentId || !isUuid(appointmentId)) {
      return redirectResult(req, "failure");
    }

    if (!token) {
      return redirectResult(req, "failure");
    }

    const config = await getTenantPaymentConfig(tenantId);
    const commerceCode = String(config.webpayCommerceCode ?? "").trim();
    const apiKey = String(config.webpayApiKey ?? "").trim();

    if (!commerceCode || !apiKey) {
      return redirectResult(req, "failure");
    }

    const res = await fetch(
      `${webpayBaseUrl(config.webpayEnvironment)}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "Tbk-Api-Key-Id": commerceCode,
          "Tbk-Api-Key-Secret": apiKey,
        },
      },
    );

    const json = await res.json().catch(() => null);
    const approved =
      res.ok &&
      String(json?.status ?? "").toUpperCase() === "AUTHORIZED" &&
      Number(json?.response_code ?? -1) === 0;
    const status = approved ? "paid" : "failed";
    const appointmentStatus = approved ? "confirmed" : "pending_payment";

    await supabaseAdmin
      .from("payments")
      .update({ status })
      .eq("tenant_id", tenantId)
      .eq("appointment_id", appointmentId);

    await supabaseAdmin
      .from("appointments")
      .update({
        payment_status: status,
        status: appointmentStatus,
        booking_status: appointmentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenantId);

    await supabaseAdmin
      .from("appointments")
      .update({
        payment_paid_amount: approved ? Number(json?.amount ?? 0) : 0,
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenantId);

    return redirectResult(req, approved ? "success" : "failure");
  } catch (error) {
    console.error("[payments/webpay/return] error:", error);
    return redirectResult(req, "failure");
  }
}
