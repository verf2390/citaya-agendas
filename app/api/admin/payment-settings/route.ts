import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

const PaymentModeSchema = z.enum(["none", "optional", "required"]);
const DepositTypeSchema = z.enum(["fixed", "percentage"]).nullable();
const PaymentProviderSchema = z.enum(["mercadopago", "webpay", "khipu", "manual"]);
const PaymentMethodsSchema = z.array(PaymentProviderSchema).min(1);
const PaymentCollectionModeSchema = z.enum(["none", "full", "deposit"]);

function hasOwn(obj: unknown, key: string) {
  return (
    typeof obj === "object" &&
    obj !== null &&
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type SupabaseErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function formatSupabaseError(
  error: SupabaseErrorLike,
  fallback: string,
) {
  const message = error.message || fallback;
  const details = error.details ? ` Detalle: ${error.details}` : "";
  const hint = error.hint ? ` Hint: ${error.hint}` : "";
  const code = error.code ? ` Código: ${error.code}` : "";

  return `${message}${details}${hint}${code}`;
}

function schemaHintForPaymentSettings(error: SupabaseErrorLike) {
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;

  if (
    text.includes("payment_methods_enabled") ||
    text.includes("payment_collection_mode") ||
    text.includes("webpay_") ||
    text.includes("khipu_") ||
    text.includes("bank_")
  ) {
    return "Faltan columnas de pagos flexibles en tenant_payment_settings. Ejecuta docs/FLEXIBLE_PAYMENTS_SCHEMA.sql en Supabase.";
  }

  return null;
}

function maskSecret(value: string | null | undefined) {
  const secret = String(value ?? "").trim();
  if (!secret) return null;
  if (secret.length <= 6) return "******";
  return `${secret.slice(0, 3)}***${secret.slice(-3)}`;
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
        paymentMethodsEnabled: config.paymentMethodsEnabled,
        paymentCollectionMode: config.collectionMode,
        webpayCommerceCode: config.webpayCommerceCode ?? null,
        webpayApiKeyConfigured: !!config.webpayApiKey,
        webpayApiKeyPreview: maskSecret(config.webpayApiKey),
        webpayEnvironment: config.webpayEnvironment ?? "integration",
        khipuReceiverId: config.khipuReceiverId ?? null,
        khipuSecretConfigured: !!config.khipuSecret,
        khipuSecretPreview: maskSecret(config.khipuSecret),
        khipuEnvironment: config.khipuEnvironment ?? "development",
        bankName: config.bankName ?? null,
        bankAccountType: config.bankAccountType ?? null,
        bankAccountNumber: config.bankAccountNumber ?? null,
        bankAccountHolder: config.bankAccountHolder ?? null,
        bankRut: config.bankRut ?? null,
        bankEmail: config.bankEmail ?? null,
      },
    });
  } catch (error: unknown) {
    console.error("[admin/payment-settings] GET error:", error);
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Error cargando configuración") },
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
    const hasPaymentMethods = hasOwn(body, "paymentMethodsEnabled");
    const hasCollectionMode = hasOwn(body, "paymentCollectionMode");
    const parsedPaymentMethods = hasPaymentMethods
      ? PaymentMethodsSchema.safeParse(body?.paymentMethodsEnabled)
      : null;
    const parsedCollectionMode = hasCollectionMode
      ? PaymentCollectionModeSchema.safeParse(body?.paymentCollectionMode)
      : null;

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

    if (hasPaymentMethods && !parsedPaymentMethods?.success) {
      return NextResponse.json(
        { ok: false, error: "paymentMethodsEnabled inválido" },
        { status: 400 },
      );
    }

    if (hasCollectionMode && !parsedCollectionMode?.success) {
      return NextResponse.json(
        { ok: false, error: "paymentCollectionMode inválido" },
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
      const numericDepositValue = Number(depositValue);

      if (!Number.isFinite(numericDepositValue) || numericDepositValue <= 0) {
        return NextResponse.json(
          { ok: false, error: "depositValue debe ser mayor a 0" },
          { status: 400 },
        );
      }

      if (depositType === "percentage" && numericDepositValue > 100) {
        return NextResponse.json(
          { ok: false, error: "depositValue no puede ser mayor a 100%" },
          { status: 400 },
        );
      }

      depositValue = numericDepositValue;
    }

    const paymentSettingsPayload: {
      active: boolean;
      payment_mode: typeof paymentMode;
      updated_at?: string;
      deposit_type?: "fixed" | "percentage" | null;
      deposit_value?: number | null;
      payment_methods_enabled?: string[];
      payment_collection_mode?: "none" | "full" | "deposit";
      webpay_commerce_code?: string | null;
      webpay_api_key?: string | null;
      webpay_environment?: string;
      khipu_receiver_id?: string | null;
      khipu_secret?: string | null;
      khipu_environment?: string;
      bank_name?: string | null;
      bank_account_type?: string | null;
      bank_account_number?: string | null;
      bank_account_holder?: string | null;
      bank_rut?: string | null;
      bank_email?: string | null;
    } = {
      active,
      payment_mode: paymentMode,
    };

    if (hasDepositType || hasDepositValue) {
      paymentSettingsPayload.deposit_type = depositType ?? null;
      paymentSettingsPayload.deposit_value = depositValue ?? null;
    }

    if (hasPaymentMethods) {
      paymentSettingsPayload.payment_methods_enabled = parsedPaymentMethods!.data;
    }

    if (hasCollectionMode) {
      paymentSettingsPayload.payment_collection_mode = parsedCollectionMode!.data;
    }

    if (hasOwn(body, "webpayCommerceCode")) {
      paymentSettingsPayload.webpay_commerce_code =
        String(body?.webpayCommerceCode ?? "").trim() || null;
    }

    if (hasOwn(body, "webpayApiKey")) {
      const nextSecret = String(body?.webpayApiKey ?? "").trim();
      if (nextSecret) paymentSettingsPayload.webpay_api_key = nextSecret;
    }

    if (hasOwn(body, "webpayEnvironment")) {
      paymentSettingsPayload.webpay_environment =
        String(body?.webpayEnvironment ?? "integration").trim() === "production"
          ? "production"
          : "integration";
    }

    if (hasOwn(body, "khipuReceiverId")) {
      paymentSettingsPayload.khipu_receiver_id =
        String(body?.khipuReceiverId ?? "").trim() || null;
    }

    if (hasOwn(body, "khipuSecret")) {
      const nextSecret = String(body?.khipuSecret ?? "").trim();
      if (nextSecret) paymentSettingsPayload.khipu_secret = nextSecret;
    }

    if (hasOwn(body, "khipuEnvironment")) {
      paymentSettingsPayload.khipu_environment =
        String(body?.khipuEnvironment ?? "development").trim() === "production"
          ? "production"
          : "development";
    }

    if (hasOwn(body, "bankName")) {
      paymentSettingsPayload.bank_name =
        String(body?.bankName ?? "").trim() || null;
    }

    if (hasOwn(body, "bankAccountType")) {
      paymentSettingsPayload.bank_account_type =
        String(body?.bankAccountType ?? "").trim() || null;
    }

    if (hasOwn(body, "bankAccountNumber")) {
      paymentSettingsPayload.bank_account_number =
        String(body?.bankAccountNumber ?? "").trim() || null;
    }

    if (hasOwn(body, "bankAccountHolder")) {
      paymentSettingsPayload.bank_account_holder =
        String(body?.bankAccountHolder ?? "").trim() || null;
    }

    if (hasOwn(body, "bankRut")) {
      paymentSettingsPayload.bank_rut =
        String(body?.bankRut ?? "").trim() || null;
    }

    if (hasOwn(body, "bankEmail")) {
      paymentSettingsPayload.bank_email =
        String(body?.bankEmail ?? "").trim() || null;
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
        const schemaHint = schemaHintForPaymentSettings(updateError);
        return NextResponse.json(
          {
            ok: false,
            error: formatSupabaseError(
              updateError,
              "No se pudo actualizar la configuración",
            ),
            schemaHint,
          },
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
        const schemaHint = schemaHintForPaymentSettings(insertError);
        return NextResponse.json(
          {
            ok: false,
            error: formatSupabaseError(
              insertError,
              "No se pudo crear la configuración",
            ),
            schemaHint,
          },
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
        paymentMethodsEnabled:
          parsedPaymentMethods?.success ? parsedPaymentMethods.data : undefined,
        paymentCollectionMode:
          parsedCollectionMode?.success ? parsedCollectionMode.data : undefined,
      },
    });
  } catch (error: unknown) {
    console.error("[admin/payment-settings] POST error:", error);
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Error guardando configuración") },
      { status: 500 },
    );
  }
}
