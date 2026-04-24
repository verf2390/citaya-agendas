import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

const PaymentModeSchema = z.enum(["none", "optional", "required"]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = String(searchParams.get("tenantId") ?? "").trim();

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido o inválido" },
        { status: 400 },
      );
    }

    const config = await getTenantPaymentConfig(tenantId);

    return NextResponse.json({
      ok: true,
      settings: {
        tenantId,
        enabled: config.enabled,
        paymentMode: config.mode,
        depositType: config.depositType ?? null,
        depositValue: config.depositValue ?? null,
      },
    });
  } catch (error: any) {
    console.error("[admin/payment-settings] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Error cargando configuración" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const tenantId = String(body?.tenantId ?? "").trim();
    const parsedMode = PaymentModeSchema.safeParse(body?.paymentMode);

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido o inválido" },
        { status: 400 },
      );
    }

    if (!parsedMode.success) {
      return NextResponse.json(
        { ok: false, error: "paymentMode inválido" },
        { status: 400 },
      );
    }

    const paymentMode = parsedMode.data;
    const active = paymentMode !== "none";

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("tenant_payment_settings")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingError) {
      console.error(
        "[admin/payment-settings] error leyendo configuración actual:",
        existingError,
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo leer la configuración actual" },
        { status: 500 },
      );
    }

    if (existing?.tenant_id) {
      const { error: updateError } = await supabaseAdmin
        .from("tenant_payment_settings")
        .update({
          active,
          payment_mode: paymentMode,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (updateError) {
        console.error(
          "[admin/payment-settings] error actualizando configuración:",
          updateError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo actualizar la configuración" },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("tenant_payment_settings")
        .insert({
          tenant_id: tenantId,
          active,
          payment_mode: paymentMode,
        });

      if (insertError) {
        console.error(
          "[admin/payment-settings] error creando configuración:",
          insertError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo crear la configuración" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      settings: {
        tenantId,
        enabled: active,
        paymentMode,
      },
    });
  } catch (error: any) {
    console.error("[admin/payment-settings] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Error guardando configuración" },
      { status: 500 },
    );
  }
}
