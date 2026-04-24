import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

const PaymentModeSchema = z.enum(["none", "optional", "required"]);
const DepositTypeSchema = z.enum(["fixed", "percentage"]).nullable();

function hasOwn(obj: unknown, key: string) {
  return typeof obj === "object" && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
}

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
    const hasDepositType = hasOwn(body, "depositType");
    const hasDepositValue = hasOwn(body, "depositValue");

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

    const rawDepositType =
      body?.depositType === "" || body?.depositType === undefined
        ? null
        : body?.depositType;
    const parsedDepositType = hasDepositType
      ? DepositTypeSchema.safeParse(rawDepositType)
      : null;

    if (hasDepositType && !parsedDepositType?.success) {
      return NextResponse.json(
        { ok: false, error: "depositType inválido" },
        { status: 400 },
      );
    }

    const paymentMode = parsedMode.data;
    const active = paymentMode !== "none";
    const depositType = hasDepositType ? parsedDepositType!.data : undefined;
    let depositValue: number | null | undefined = undefined;

    if (hasDepositValue) {
      const rawValue = body?.depositValue;
      depositValue =
        rawValue === null || rawValue === "" || rawValue === undefined
          ? null
          : Number(rawValue);
    }

    if (depositType === null) {
      depositValue = null;
    }

    if (depositType === "fixed" || depositType === "percentage") {
      if (!Number.isFinite(depositValue) || Number(depositValue) <= 0) {
        return NextResponse.json(
          { ok: false, error: "depositValue debe ser mayor a 0" },
          { status: 400 },
        );
      }

      if (depositType === "percentage" && Number(depositValue) > 100) {
        return NextResponse.json(
          { ok: false, error: "depositValue no puede ser mayor a 100%" },
          { status: 400 },
        );
      }
    }

    const paymentSettingsPayload: {
      active: boolean;
      payment_mode: typeof paymentMode;
      updated_at?: string;
      deposit_type?: "fixed" | "percentage" | null;
      deposit_value?: number | null;
    } = {
      active,
      payment_mode: paymentMode,
    };

    if (hasDepositType || hasDepositValue) {
      paymentSettingsPayload.deposit_type = depositType ?? null;
      paymentSettingsPayload.deposit_value = depositValue ?? null;
    }

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
          ...paymentSettingsPayload,
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
          ...paymentSettingsPayload,
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
        depositType: depositType ?? null,
        depositValue: depositValue ?? null,
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
