"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type PaymentFilter = "all" | "paid" | "pending" | "failed";
type TenantPaymentMode = "none" | "optional" | "required";
type TenantDepositType = "fixed" | "percentage" | null;
type TenantChargeType = "none" | "full" | "fixed" | "percentage";
type TenantChargeUiType = "none" | "full" | "deposit";
type TenantDepositUiType = "fixed" | "percentage";
type PaymentProviderId = "mercadopago" | "webpay" | "khipu" | "manual";

const PAYMENT_PROVIDER_LABELS: Record<PaymentProviderId, string> = {
  mercadopago: "Mercado Pago",
  webpay: "Webpay Plus",
  khipu: "Khipu",
  manual: "Transferencia/manual",
};

const PAYMENT_METHODS: PaymentProviderId[] = [
  "mercadopago",
  "webpay",
  "khipu",
  "manual",
];

type AppointmentPayment = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  service_name: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string | null;
  booking_status: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  payment_required: boolean | null;
  payment_required_amount: number | null;
  payment_paid_amount: number | null;
  payment_remaining_amount: number | null;
  payment_reference: string | null;
  payment_url: string | null;
  manage_token: string | null;
};

function formatCLP(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  return amount.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

function formatDateTime(value: string | null) {
  if (!value) return "No disponible";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No disponible";
  return d.toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

function moneyNumber(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizedStatus(value: string | null | undefined) {
  return String(value ?? "").toLowerCase();
}

function hasPaymentInfo(row: AppointmentPayment) {
  return (
    row.payment_required === true ||
    Boolean(row.payment_status) ||
    moneyNumber(row.payment_required_amount) > 0 ||
    moneyNumber(row.payment_paid_amount) > 0 ||
    moneyNumber(row.payment_remaining_amount) > 0 ||
    Boolean(row.payment_url)
  );
}

function isPendingPayment(row: AppointmentPayment) {
  const paymentStatus = normalizedStatus(row.payment_status);
  const bookingStatus = normalizedStatus(row.booking_status);
  const status = normalizedStatus(row.status);

  return (
    paymentStatus === "pending" ||
    paymentStatus === "failed" ||
    bookingStatus === "pending_payment" ||
    status === "pending_payment"
  );
}

function paymentBadge(
  status: string | null | undefined,
): "slate" | "green" | "amber" | "red" | "blue" {
  const normalized = normalizedStatus(status);
  if (normalized === "paid") return "green";
  if (normalized === "failed") return "red";
  if (normalized === "pending" || normalized === "pending_payment") return "amber";
  if (normalized === "not_required" || normalized === "pay_later") return "blue";
  return "slate";
}

function paymentLabel(status: string | null | undefined) {
  const normalized = normalizedStatus(status);
  if (normalized === "paid") return "Pagado";
  if (normalized === "failed") return "Fallido";
  if (normalized === "pending" || normalized === "pending_payment") return "Pendiente";
  if (normalized === "not_required" || normalized === "pay_later") return "No requerido";
  return "Sin estado";
}

export default function AdminPagosPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AppointmentPayment[]>([]);
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<{
    type: "success" | "placeholder" | "error";
    text: string;
  } | null>(null);
  const [loadingPaymentSettings, setLoadingPaymentSettings] = useState(true);
  const [tenantPaymentMode, setTenantPaymentMode] =
    useState<TenantPaymentMode>("none");
  const [tenantChargeType, setTenantChargeType] =
    useState<TenantChargeType>("none");
  const [tenantDepositValue, setTenantDepositValue] = useState("");
  const [paymentMethodsEnabled, setPaymentMethodsEnabled] = useState<
    PaymentProviderId[]
  >(["mercadopago"]);
  const [webpayCommerceCode, setWebpayCommerceCode] = useState("");
  const [webpayApiKey, setWebpayApiKey] = useState("");
  const [webpayApiKeyPreview, setWebpayApiKeyPreview] = useState("");
  const [webpayEnvironment, setWebpayEnvironment] = useState<
    "integration" | "production"
  >("integration");
  const [khipuReceiverId, setKhipuReceiverId] = useState("");
  const [khipuSecret, setKhipuSecret] = useState("");
  const [khipuSecretPreview, setKhipuSecretPreview] = useState("");
  const [khipuEnvironment, setKhipuEnvironment] = useState<
    "development" | "production"
  >("development");
  const [bankName, setBankName] = useState("");
  const [bankAccountType, setBankAccountType] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankRut, setBankRut] = useState("");
  const [bankEmail, setBankEmail] = useState("");
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        setLoading(false);
        return;
      }
      setTenantSlug(slug);

      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();

      if (error || !data?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        setLoading(false);
        return;
      }

      setTenantId(data.id);
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!tenantId || tenantError) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/pagos")}`);
        return;
      }
      setAuthChecked(true);
    };

    void run();
  }, [router, tenantId, tenantError]);

  const tenantChargeUiType: TenantChargeUiType =
    tenantChargeType === "fixed" || tenantChargeType === "percentage"
      ? "deposit"
      : tenantChargeType;
  const tenantDepositUiType: TenantDepositUiType =
    tenantChargeType === "percentage" ? "percentage" : "fixed";

  const loadPaymentSettings = async () => {
    if (!tenantId) return;
    setLoadingPaymentSettings(true);

    try {
      const res = await fetch(
        `/api/admin/payment-settings?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "No se pudo cargar la configuración de cobros");
      }

      const paymentMode =
        (json.settings?.paymentMode as TenantPaymentMode | undefined) ?? "none";
      const depositType =
        (json.settings?.depositType as TenantDepositType | undefined) ?? null;
      const depositValue = json.settings?.depositValue;

      setTenantPaymentMode(paymentMode);
      setTenantChargeType(
        paymentMode === "none"
          ? "none"
          : depositType === "fixed"
            ? "fixed"
            : depositType === "percentage"
              ? "percentage"
              : "full",
      );
      setTenantDepositValue(
        depositValue !== null && depositValue !== undefined
          ? String(depositValue)
          : "",
      );

      const methods = Array.isArray(json.settings?.paymentMethodsEnabled)
        ? json.settings.paymentMethodsEnabled.filter(
            (method: unknown): method is PaymentProviderId =>
              method === "mercadopago" ||
              method === "webpay" ||
              method === "khipu" ||
              method === "manual",
          )
        : [];
      setPaymentMethodsEnabled(methods.length > 0 ? methods : ["mercadopago"]);
      setWebpayCommerceCode(json.settings?.webpayCommerceCode ?? "");
      setWebpayApiKey("");
      setWebpayApiKeyPreview(json.settings?.webpayApiKeyPreview ?? "");
      setWebpayEnvironment(
        json.settings?.webpayEnvironment === "production"
          ? "production"
          : "integration",
      );
      setKhipuReceiverId(json.settings?.khipuReceiverId ?? "");
      setKhipuSecret("");
      setKhipuSecretPreview(json.settings?.khipuSecretPreview ?? "");
      setKhipuEnvironment(
        json.settings?.khipuEnvironment === "production"
          ? "production"
          : "development",
      );
      setBankName(json.settings?.bankName ?? "");
      setBankAccountType(json.settings?.bankAccountType ?? "");
      setBankAccountNumber(json.settings?.bankAccountNumber ?? "");
      setBankAccountHolder(json.settings?.bankAccountHolder ?? "");
      setBankRut(json.settings?.bankRut ?? "");
      setBankEmail(json.settings?.bankEmail ?? "");
    } catch (error: unknown) {
      console.error("[admin/pagos] payment settings error:", error);
      toast({
        title: "No se pudo cargar la configuración",
        description:
          error instanceof Error ? error.message : "Intenta nuevamente en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setLoadingPaymentSettings(false);
    }
  };

  const loadRows = async () => {
    if (!tenantId) return;
    setLoading(true);

    const params = new URLSearchParams({
      tenantId,
      start: "2000-01-01T00:00:00.000Z",
      end: "2100-01-01T00:00:00.000Z",
    });

    const res = await fetch(`/api/admin/appointments/range?${params.toString()}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !Array.isArray(json?.items)) {
      console.error("[admin/pagos] fetch appointments/range failed:", {
        status: res.status,
        body: json,
      });
      setRows([]);
    } else {
      const paymentRows = (json.items as AppointmentPayment[])
        .filter(hasPaymentInfo)
        .sort((a, b) => {
          const bTime = b.start_at ? new Date(b.start_at).getTime() : 0;
          const aTime = a.start_at ? new Date(a.start_at).getTime() : 0;
          return bTime - aTime;
        });
      setRows(paymentRows);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked || !tenantId) return;
    void loadPaymentSettings();
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => {
      const paymentStatus = normalizedStatus(row.payment_status);
      const bookingStatus = normalizedStatus(row.booking_status);
      const status = normalizedStatus(row.status);

      if (filter === "paid") return paymentStatus === "paid";
      if (filter === "failed") return paymentStatus === "failed";
      return (
        paymentStatus === "pending" ||
        bookingStatus === "pending_payment" ||
        status === "pending_payment"
      );
    });
  }, [rows, filter]);

  const kpis = useMemo(() => {
    const now = new Date();
    const todayKey = now.toLocaleDateString("en-CA", {
      timeZone: "America/Santiago",
    });
    const monthKey = todayKey.slice(0, 7);

    return rows.reduce(
      (acc, row) => {
        const paid = moneyNumber(row.payment_paid_amount);
        const remaining = moneyNumber(row.payment_remaining_amount);
        const status = normalizedStatus(row.payment_status);

        if (status === "paid") {
          acc.total += paid;
          const rowDate = row.start_at
            ? new Date(row.start_at).toLocaleDateString("en-CA", {
                timeZone: "America/Santiago",
              })
            : "";
          if (rowDate === todayKey) acc.today += paid;
          if (rowDate.slice(0, 7) === monthKey) acc.month += paid;
        }

        if (isPendingPayment(row)) {
          acc.pending += remaining;
        }

        return acc;
      },
      { today: 0, month: 0, total: 0, pending: 0 },
    );
  }, [rows]);

  const paymentSummary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const status = normalizedStatus(row.payment_status);
        if (status === "paid") acc.confirmed += 1;
        else if (status === "failed") acc.failed += 1;
        else if (isPendingPayment(row)) acc.pending += 1;
        return acc;
      },
      { confirmed: 0, pending: 0, failed: 0 },
    );
  }, [rows]);

  const activeMethodsCount = paymentMethodsEnabled.length;

  const maxPaymentState = Math.max(
    paymentSummary.confirmed,
    paymentSummary.pending,
    paymentSummary.failed,
    1,
  );

  const savePaymentSettings = async () => {
    if (!tenantId || savingPaymentSettings) return;

    const nextPaymentMode: TenantPaymentMode =
      tenantChargeType === "none"
        ? "none"
        : tenantPaymentMode === "none"
          ? "required"
          : tenantPaymentMode;
    const nextDepositType: TenantDepositType =
      tenantChargeType === "fixed"
        ? "fixed"
        : tenantChargeType === "percentage"
          ? "percentage"
          : null;
    const rawDepositValue = tenantDepositValue.trim();
    const nextDepositValue =
      nextDepositType && rawDepositValue ? Number(rawDepositValue) : null;
    const paymentCollectionMode =
      tenantChargeType === "none"
        ? "none"
        : tenantChargeType === "full"
          ? "full"
          : "deposit";

    if (paymentMethodsEnabled.length === 0) {
      toast({
        title: "Método de pago requerido",
        description: "Selecciona al menos un método de pago.",
        variant: "destructive",
      });
      return;
    }

    if (nextDepositType) {
      const numericDepositValue = Number(nextDepositValue);

      if (!Number.isFinite(numericDepositValue) || numericDepositValue <= 0) {
        toast({
          title: "Monto inválido",
          description:
            nextDepositType === "fixed"
              ? "Ingresa un abono fijo mayor a 0."
              : "Ingresa un porcentaje mayor a 0.",
          variant: "destructive",
        });
        return;
      }

      if (nextDepositType === "percentage" && numericDepositValue > 100) {
        toast({
          title: "Porcentaje inválido",
          description: "El abono por porcentaje no puede ser mayor a 100%.",
          variant: "destructive",
        });
        return;
      }
    }

    setSavingPaymentSettings(true);

    try {
      const res = await fetch("/api/admin/payment-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          paymentMode: nextPaymentMode,
          depositType: nextDepositType,
          depositValue: nextDepositValue,
          paymentMethodsEnabled,
          paymentCollectionMode,
          webpayCommerceCode,
          webpayApiKey,
          webpayEnvironment,
          khipuReceiverId,
          khipuSecret,
          khipuEnvironment,
          bankName,
          bankAccountType,
          bankAccountNumber,
          bankAccountHolder,
          bankRut,
          bankEmail,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "No se pudo guardar la configuración");
      }

      setTenantPaymentMode(nextPaymentMode);
      setWebpayApiKey("");
      setKhipuSecret("");
      await loadPaymentSettings();
      toast({ title: "Configuración guardada correctamente" });
    } catch (error: unknown) {
      console.error("[admin/pagos] save payment settings error:", error);
      toast({
        title: "No se pudo guardar la configuración",
        description:
          error instanceof Error ? error.message : "Intenta nuevamente en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setSavingPaymentSettings(false);
    }
  };

  const markAsPaid = async (appointmentId: string) => {
    setMarkingId(appointmentId);
    try {
      const res = await fetch("/api/admin/appointments/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId, paymentProvider: "manual" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast({
          title: "No se pudo marcar como pagado",
          description: json?.error ?? "Intenta nuevamente en unos segundos.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Pago marcado correctamente" });
      await loadRows();
    } finally {
      setMarkingId(null);
    }
  };

  const copyPaymentLink = async (url: string | null) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast({ title: "Link de pago copiado" });
  };

  const resendPayment = async (row: AppointmentPayment) => {
    if (!row.payment_url || !row.customer_email) return;

    setResendMessage(null);
    setResendingId(row.id);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const res = await fetch("/api/admin/payments/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          appointmentId: row.id,
          customerEmail: row.customer_email,
          customerName: row.customer_name,
          paymentLink: row.payment_url,
          amount: moneyNumber(row.payment_remaining_amount) || moneyNumber(row.payment_required_amount),
          tenantSlug,
        }),
      });

      const json = await res.json().catch(() => null);

      if (json?.placeholder) {
        const text = "Webhook n8n pendiente de configurar";
        setResendMessage({ type: "placeholder", text });
        toast({ title: text, description: json?.message });
        return;
      }

      if (!res.ok || !json?.ok) {
        const text = json?.error ?? "No se pudo reenviar el correo de pago";
        setResendMessage({ type: "error", text });
        toast({ title: "Error reenviando pago", description: text, variant: "destructive" });
        return;
      }

      const text = "Correo de pago reenviado correctamente";
      setResendMessage({ type: "success", text });
      toast({ title: text });
    } catch (e: any) {
      const text = e?.message ?? "No se pudo conectar con el endpoint de reenvio";
      setResendMessage({ type: "error", text });
      toast({ title: "Error reenviando pago", description: text, variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <AdminPageShell width="wide">
        <AdminNav />
        <AdminPageHeader
          eyebrow="Pagos Pro"
          title="Pagos"
          description="Configura cobros, revisa pagos pendientes y prepara tus métodos de pago."
          actions={
          <Link className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold" href="/admin/agenda">
            Volver a agenda
          </Link>
          }
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminKpiCard label="Pagos pendientes" value={paymentSummary.pending} tone="amber" />
          <AdminKpiCard label="Pagos confirmados" value={paymentSummary.confirmed} tone="green" />
          <AdminKpiCard label="Monto pendiente" value={formatCLP(kpis.pending)} tone="blue" />
          <AdminKpiCard label="Métodos activos" value={activeMethodsCount} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <AdminSectionCard
            title="Configuración de cobro"
            description="Define cuándo se cobra online y qué monto se solicitará al reservar."
          >
            {loadingPaymentSettings || !authChecked ? (
              <div className="text-sm font-medium text-slate-500">Cargando configuración de cobros...</div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    Tipo de cobro
                    <select
                      value={tenantChargeUiType}
                      onChange={(e) => {
                        const value = e.target.value as TenantChargeUiType;
                        const nextChargeType: TenantChargeType =
                          value === "deposit"
                            ? tenantChargeType === "percentage"
                              ? "percentage"
                              : "fixed"
                            : value;

                        setTenantChargeType(nextChargeType);

                        if (value === "none") {
                          setTenantPaymentMode("none");
                          setTenantDepositValue("");
                        } else if (tenantPaymentMode === "none") {
                          setTenantPaymentMode("required");
                        }
                      }}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-medium outline-none focus:border-slate-400"
                    >
                      <option value="none">Sin pago</option>
                      <option value="full">Pago completo</option>
                      <option value="deposit">Abono</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    Modo de pago
                    <select
                      value={tenantPaymentMode}
                      onChange={(e) =>
                        setTenantPaymentMode(e.target.value as TenantPaymentMode)
                      }
                      disabled={tenantChargeType === "none"}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-medium outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="none">Sin pago online</option>
                      <option value="optional">Pago opcional</option>
                      <option value="required">Pago obligatorio</option>
                    </select>
                  </label>
                </div>

                {tenantChargeUiType === "deposit" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-bold text-slate-700">
                      Tipo de abono
                      <select
                        value={tenantDepositUiType}
                        onChange={(e) =>
                          setTenantChargeType(e.target.value as TenantDepositUiType)
                        }
                        className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-medium outline-none focus:border-slate-400"
                      >
                        <option value="fixed">Monto fijo</option>
                        <option value="percentage">Porcentaje</option>
                      </select>
                    </label>

                    <label className="grid gap-1 text-sm font-bold text-slate-700">
                      {tenantChargeType === "percentage"
                        ? "Porcentaje del abono"
                        : "Monto del abono"}
                      <input
                        type="number"
                        min={1}
                        max={tenantChargeType === "percentage" ? 100 : undefined}
                        step={1}
                        value={tenantDepositValue}
                        onChange={(e) => setTenantDepositValue(e.target.value)}
                        placeholder={tenantChargeType === "percentage" ? "Ej: 50" : "Ej: 5000"}
                        className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-medium outline-none focus:border-slate-400"
                      />
                    </label>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void savePaymentSettings()}
                  disabled={savingPaymentSettings || !tenantId}
                  className="w-fit rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingPaymentSettings ? "Guardando..." : "Guardar configuración"}
                </button>
              </div>
            )}
          </AdminSectionCard>

          <AdminSectionCard
            title="Resumen visual"
            description="Una vista rápida del estado de cobros y métodos disponibles."
          >
            {rows.length === 0 ? (
              <EmptyState
                title="Todavía no hay pagos registrados."
                description="Cuando existan reservas con cobro, verás aquí un resumen visual."
              />
            ) : (
              <div className="grid gap-5">
                <div>
                  <div className="mb-3 text-sm font-black text-slate-800">Estado de pagos</div>
                  {[
                    ["Confirmados", paymentSummary.confirmed, "bg-emerald-500"],
                    ["Pendientes", paymentSummary.pending, "bg-amber-500"],
                    ["Fallidos", paymentSummary.failed, "bg-red-500"],
                  ].map(([label, value, color]) => (
                    <div key={String(label)} className="mb-3">
                      <div className="mb-1 flex justify-between text-xs font-black text-slate-500">
                        <span>{label}</span>
                        <span>{value}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${color}`}
                          style={{ width: `${(Number(value) / maxPaymentState) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="mb-3 text-sm font-black text-slate-800">Métodos activos</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PAYMENT_METHODS.map((method) => {
                      const active = paymentMethodsEnabled.includes(method);
                      return (
                        <div
                          key={method}
                          className={`rounded-2xl border p-3 text-sm font-bold ${
                            active
                              ? "border-sky-200 bg-sky-50 text-sky-900"
                              : "border-slate-200 bg-slate-50 text-slate-400"
                          }`}
                        >
                          {PAYMENT_PROVIDER_LABELS[method]}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </AdminSectionCard>
        </div>

        <AdminSectionCard
          className="mt-4"
          title="Métodos de pago"
          description="Activa los métodos disponibles para tus clientes. Puedes guardar aunque algunos datos opcionales estén vacíos."
        >
          {loadingPaymentSettings || !authChecked ? (
            <div className="text-sm font-medium text-slate-500">Cargando métodos de pago...</div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {PAYMENT_METHODS.map((method) => {
                  const active = paymentMethodsEnabled.includes(method);
                  return (
                    <label
                      key={method}
                      className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-2xl border p-4 shadow-sm transition ${
                        active
                          ? "border-sky-300 bg-sky-50 text-sky-950"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => {
                          setPaymentMethodsEnabled((prev) => {
                            if (e.target.checked) {
                              return prev.includes(method) ? prev : [...prev, method];
                            }
                            return prev.filter((item) => item !== method);
                          });
                        }}
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                      />
                      <span>
                        <span className="block font-black">{PAYMENT_PROVIDER_LABELS[method]}</span>
                        <span className="mt-1 block text-xs font-bold text-slate-500">
                          {active ? "Activo para cobros" : "Desactivado"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div
                  className={`rounded-2xl border p-4 ${
                    paymentMethodsEnabled.includes("webpay")
                      ? "border-sky-200 bg-sky-50/60"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">Webpay Plus</div>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        Configura los datos entregados por Transbank.
                      </p>
                    </div>
                    <StatusBadge tone={paymentMethodsEnabled.includes("webpay") ? "blue" : "slate"}>
                      {paymentMethodsEnabled.includes("webpay") ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input
                      value={webpayCommerceCode}
                      onChange={(e) => setWebpayCommerceCode(e.target.value)}
                      placeholder="Código comercio"
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                    />
                    <select
                      value={webpayEnvironment}
                      onChange={(e) =>
                        setWebpayEnvironment(
                          e.target.value === "production" ? "production" : "integration",
                        )
                      }
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                    >
                      <option value="integration">Integración</option>
                      <option value="production">Producción</option>
                    </select>
                    <input
                      value={webpayApiKey}
                      onChange={(e) => setWebpayApiKey(e.target.value)}
                      placeholder={
                        webpayApiKeyPreview
                          ? `API key (${webpayApiKeyPreview})`
                          : "API key"
                      }
                      type="password"
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400 sm:col-span-2"
                    />
                  </div>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${
                    paymentMethodsEnabled.includes("khipu")
                      ? "border-sky-200 bg-sky-50/60"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">Khipu</div>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        Configura cobros por transferencia asistida.
                      </p>
                    </div>
                    <StatusBadge tone={paymentMethodsEnabled.includes("khipu") ? "blue" : "slate"}>
                      {paymentMethodsEnabled.includes("khipu") ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input
                      value={khipuReceiverId}
                      onChange={(e) => setKhipuReceiverId(e.target.value)}
                      placeholder="Receiver ID"
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                    />
                    <select
                      value={khipuEnvironment}
                      onChange={(e) =>
                        setKhipuEnvironment(
                          e.target.value === "production" ? "production" : "development",
                        )
                      }
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                    >
                      <option value="development">Desarrollo</option>
                      <option value="production">Producción</option>
                    </select>
                    <input
                      value={khipuSecret}
                      onChange={(e) => setKhipuSecret(e.target.value)}
                      placeholder={
                        khipuSecretPreview
                          ? `Secret (${khipuSecretPreview})`
                          : "Secret"
                      }
                      type="password"
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400 sm:col-span-2"
                    />
                  </div>
                </div>

                <div
                  className={`rounded-2xl border p-4 lg:col-span-2 ${
                    paymentMethodsEnabled.includes("manual")
                      ? "border-sky-200 bg-sky-50/60"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">Transferencia/manual</div>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        Puedes guardar aunque falten datos; complétalos antes de pedir transferencias.
                      </p>
                    </div>
                    <StatusBadge tone={paymentMethodsEnabled.includes("manual") ? "blue" : "slate"}>
                      {paymentMethodsEnabled.includes("manual") ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <select value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400">
                      <option value="">Banco</option>
                      <option value="BancoEstado">BancoEstado</option>
                      <option value="Banco de Chile">Banco de Chile</option>
                      <option value="Santander">Santander</option>
                      <option value="BCI">BCI</option>
                      <option value="Scotiabank">Scotiabank</option>
                      <option value="Itaú">Itaú</option>
                      <option value="Banco Falabella">Banco Falabella</option>
                      <option value="Banco Ripley">Banco Ripley</option>
                      <option value="Banco Security">Banco Security</option>
                      <option value="Consorcio">Consorcio</option>
                      <option value="BICE">BICE</option>
                      <option value="Coopeuch">Coopeuch</option>
                      <option value="Tenpo">Tenpo</option>
                      <option value="Mercado Pago">Mercado Pago</option>
                      <option value="MACH">MACH</option>
                      <option value="Otro banco">Otro banco</option>
                    </select>
                    <select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400">
                      <option value="">Tipo de cuenta</option>
                      <option value="Cuenta Corriente">Cuenta Corriente</option>
                      <option value="Cuenta Vista">Cuenta Vista</option>
                      <option value="Cuenta RUT">Cuenta RUT</option>
                      <option value="Cuenta de Ahorro">Cuenta de Ahorro</option>
                      <option value="Chequera Electrónica">Chequera Electrónica</option>
                      <option value="Otro">Otro</option>
                    </select>
                    <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="Número de cuenta" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400" />
                    <input value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} placeholder="Titular" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400" />
                    <input value={bankRut} onChange={(e) => setBankRut(e.target.value)} placeholder="RUT" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400" />
                    <input value={bankEmail} onChange={(e) => setBankEmail(e.target.value)} placeholder="Email" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void savePaymentSettings()}
                disabled={savingPaymentSettings || !tenantId}
                className="w-fit rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingPaymentSettings ? "Guardando..." : "Guardar configuración"}
              </button>
            </div>
          )}
        </AdminSectionCard>

        <AdminSectionCard className="mt-4" title="Pagos recientes / pendientes">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "Todos"],
            ["paid", "Pagados"],
            ["pending", "Pendientes"],
            ["failed", "Fallidos"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id as PaymentFilter)}
              className={`rounded-full border px-3 py-2 text-sm font-bold ${
                filter === id ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-700"
              }`}
              type="button"
            >
              {label}
            </button>
          ))}
          <button className="rounded-full border bg-white px-3 py-2 text-sm font-bold" onClick={() => void loadRows()} type="button">
            Recargar
          </button>
        </div>

        {resendMessage ? (
          <div
            className={`mt-4 rounded-2xl border p-3 text-sm font-bold ${
              resendMessage.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : resendMessage.type === "placeholder"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {resendMessage.text}
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[1.4fr_1.2fr_1.2fr_1fr_1fr_1fr_1.6fr] gap-3 bg-slate-50 p-3 text-xs font-black text-slate-500">
                <div>Cliente</div>
                <div>Servicio</div>
                <div>Fecha/hora</div>
                <div>Pago</div>
                <div>Monto</div>
                <div>Reserva</div>
                <div>Acciones</div>
              </div>
              {loading ? (
                <div className="p-4 text-sm text-slate-500">Cargando pagos...</div>
              ) : filteredRows.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="Todavía no hay pagos registrados"
                    description="Cuando tus clientes paguen una reserva o tengan pagos pendientes, aparecerán aquí."
                    actionLabel="Configurar pagos"
                    actionHref="/admin/pagos"
                  />
                </div>
              ) : (
                filteredRows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[1.4fr_1.2fr_1.2fr_1fr_1fr_1fr_1.6fr] gap-3 border-t p-3 text-sm">
                    <div>
                      <div className="font-bold text-slate-900">{row.customer_name || "Cliente"}</div>
                      <div className="text-xs text-slate-500">{row.customer_email || "Sin email"}</div>
                    </div>
                    <div>{row.service_name || "Servicio"}</div>
                    <div>{formatDateTime(row.start_at)}</div>
                    <div>
                      <StatusBadge status={row.payment_status} />
                      <div className="mt-1 text-xs text-slate-500">{row.payment_provider || "Sin proveedor"}</div>
                    </div>
                    <div>
                      <div className="font-bold">{formatCLP(row.payment_required_amount)}</div>
                      <div className="text-xs text-slate-500">Pagado {formatCLP(row.payment_paid_amount)}</div>
                      <div className="text-xs text-slate-500">Saldo {formatCLP(row.payment_remaining_amount)}</div>
                    </div>
                    <div>
                      <div>{row.booking_status || row.status || "Sin estado"}</div>
                      {row.status && row.status !== row.booking_status ? (
                        <div className="text-xs text-slate-500">{row.status}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={markingId === row.id || normalizedStatus(row.payment_status) === "paid"}
                        onClick={() => void markAsPaid(row.id)}
                        className="rounded-xl border bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {markingId === row.id ? "Marcando..." : "Marcar como pagado"}
                      </button>
                      <button
                        type="button"
                        disabled={!row.payment_url}
                        onClick={() => {
                          if (row.payment_url) window.open(row.payment_url, "_blank", "noopener,noreferrer");
                        }}
                        className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        Abrir link de pago
                      </button>
                      <button
                        type="button"
                        disabled={!row.payment_url}
                        onClick={() => void copyPaymentLink(row.payment_url)}
                        className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        Copiar link
                      </button>
                      <button
                        type="button"
                        disabled={!row.payment_url || !row.customer_email || resendingId === row.id}
                        onClick={() => void resendPayment(row)}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        title={!row.payment_url || !row.customer_email ? "Requiere link de pago y email del cliente" : "Reenviar correo de pago"}
                      >
                        {resendingId === row.id ? "Reenviando..." : "Reenviar pago"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        </AdminSectionCard>

    </AdminPageShell>
  );
}
