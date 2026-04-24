import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchMercadoPagoPayment,
  mapMercadoPagoStatus,
} from "@/services/payments/mercadopago";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

type MercadoPagoWebhookBody = {
  action?: string;
  type?: string;
  topic?: string;
  data?: {
    id?: string | number;
  };
};

function getPaymentId(body: MercadoPagoWebhookBody): string {
  const paymentId = body?.data?.id;
  return typeof paymentId === "string" || typeof paymentId === "number"
    ? String(paymentId).trim()
    : "";
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const appointmentId = String(url.searchParams.get("appointmentId") ?? "").trim();
    const body = (await req.json().catch(() => null)) as MercadoPagoWebhookBody | null;

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId inválido o ausente en webhook" },
        { status: 400 },
      );
    }

    if (!appointmentId || !isUuid(appointmentId)) {
      return NextResponse.json(
        { ok: false, error: "appointmentId inválido o ausente en webhook" },
        { status: 400 },
      );
    }

    const topic = String(body?.type ?? body?.topic ?? "").toLowerCase();
    const paymentId = getPaymentId(body ?? {});

    if (
      topic &&
      topic !== "payment" &&
      !String(body?.action ?? "").toLowerCase().startsWith("payment.")
    ) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `unsupported_topic:${topic}`,
      });
    }

    if (!paymentId) {
      console.info("[webhooks/mercadopago] webhook sin payment id", {
        tenantId,
        appointmentId,
        topic,
      });

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "missing_payment_id",
      });
    }

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select("id, tenant_id")
      .eq("id", appointmentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (appointmentError) {
      console.error(
        "[webhooks/mercadopago] error buscando cita:",
        appointmentError,
      );
      return NextResponse.json(
        { ok: false, error: "Error validando cita asociada al pago" },
        { status: 500 },
      );
    }

    if (!appointment) {
      return NextResponse.json(
        { ok: false, error: "Appointment no encontrada para webhook" },
        { status: 404 },
      );
    }

    const paymentConfig = await getTenantPaymentConfig(tenantId);
    if (!paymentConfig.accessToken) {
      return NextResponse.json(
        { ok: false, error: "Access token de Mercado Pago no configurado" },
        { status: 400 },
      );
    }

    const mpPayment = await fetchMercadoPagoPayment({
      accessToken: paymentConfig.accessToken,
      paymentId,
    });

    if (String(mpPayment.external_reference ?? "").trim() !== appointmentId) {
      console.warn("[webhooks/mercadopago] external_reference mismatch", {
        appointmentId,
        paymentId,
        externalReference: mpPayment.external_reference,
      });

      return NextResponse.json(
        { ok: false, error: "external_reference no coincide con la cita" },
        { status: 409 },
      );
    }

    const normalizedStatus = mapMercadoPagoStatus(mpPayment.status);
    const { data: existingPayments, error: existingPaymentsError } =
      await supabaseAdmin
        .from("payments")
        .select("id, status, mp_preference_id")
        .eq("tenant_id", tenantId)
        .eq("appointment_id", appointmentId);

    if (existingPaymentsError) {
      console.error(
        "[webhooks/mercadopago] error leyendo payments:",
        existingPaymentsError,
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo leer el registro de pagos" },
        { status: 500 },
      );
    }

    const currentPayment = (existingPayments ?? [])[0] ?? null;
    const currentStatus = String(currentPayment?.status ?? "").toLowerCase();
    const isDuplicateApproval =
      currentStatus === normalizedStatus &&
      normalizedStatus === "paid";

    if (isDuplicateApproval) {
      console.info("[webhooks/mercadopago] webhook duplicado omitido", {
        appointmentId,
        paymentId,
        status: normalizedStatus,
      });

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_processed",
        status: normalizedStatus,
      });
    }

    const payload = {
      status: normalizedStatus,
      external_reference: appointmentId,
      mp_preference_id:
        String(currentPayment?.mp_preference_id ?? "").trim() || undefined,
    };

    if (currentPayment?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("payments")
        .update(payload)
        .eq("id", currentPayment.id)
        .eq("tenant_id", tenantId);

      if (updateError) {
        console.error(
          "[webhooks/mercadopago] error actualizando payment:",
          updateError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo actualizar el estado del pago" },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabaseAdmin.from("payments").insert({
        tenant_id: tenantId,
        appointment_id: appointmentId,
        external_reference: appointmentId,
        amount: mpPayment.transaction_amount ?? 0,
        status: normalizedStatus,
      });

      if (insertError) {
        console.error(
          "[webhooks/mercadopago] error insertando payment:",
          insertError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo crear el registro de pago del webhook" },
          { status: 500 },
        );
      }
    }

    const { error: appointmentUpdateError } = await supabaseAdmin
      .from("appointments")
      .update({
        payment_status: normalizedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenantId);

    if (appointmentUpdateError) {
      console.error(
        "[webhooks/mercadopago] error actualizando appointment payment_status:",
        appointmentUpdateError,
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo actualizar payment_status de la cita" },
        { status: 500 },
      );
    }

    console.info("[webhooks/mercadopago] pago procesado", {
      topic,
      appointmentId,
      tenantId,
      paymentId,
      status: normalizedStatus,
      rawStatus: mpPayment.status,
    });

    return NextResponse.json({
      ok: true,
      appointmentId,
      paymentId,
      status: normalizedStatus,
    });
  } catch (error) {
    console.error("[webhooks/mercadopago] unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: "Error procesando webhook de Mercado Pago" },
      { status: 500 },
    );
  }
}
