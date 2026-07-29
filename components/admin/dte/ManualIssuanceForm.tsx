"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileCheck2, Plus, Save, Trash2 } from "lucide-react";

import { adminFetch } from "@/lib/api/adminFetch";
import { calculateInvoiceTotals } from "@/lib/dte/invoice-drafts";

type TaxProfile = {
  rut_normalized: string;
  legal_name: string;
  business_activity: string;
  tax_address: string;
  tax_commune: string;
  tax_city: string;
  tax_email: string;
};
type Customer = {
  id: string;
  full_name: string;
  rut_normalized: string | null;
  tax_profile: TaxProfile | null;
};
type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  priceIncludesVat: boolean;
  tax_treatment?: string | null;
};
type Appointment = {
  id: string;
  customer_id: string | null;
  service_name: string | null;
  start_at: string;
  payment_status: string | null;
  payment_paid_amount: number | null;
};
type Payment = {
  id: string;
  appointment_id: string;
  amount: number;
  currency: string;
  provider: string;
  processed_at: string;
};
type EditorLine = {
  key: string;
  serviceId: string | null;
  appointmentId: string | null;
  description: string;
  quantity: number;
  unitNetAmount: number;
  discountPercent: number;
  pricingMode: "manual_net" | "catalog_gross";
  catalogUnitGrossAmount: number | null;
};
type SavedDraft = {
  id: string;
  status: string;
  version: number;
  review_reason?: string | null;
};
type DraftRecord = SavedDraft & {
  customer_id: string;
  appointment_id: string | null;
  payment_intent_id: string | null;
  source: "manual" | "appointment" | "payment" | "automatic_payment";
  operational_reason?: string | null;
  lines: Array<{
    id: string;
    service_id: string | null;
    appointment_id: string | null;
    description: string;
    quantity: number;
    unit_net_amount: number;
    discount_basis_points: number;
    pricing_mode?: "manual_net" | "catalog_gross";
    catalog_unit_gross_amount?: number | null;
  }>;
};

function clp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function roundDiv(numerator: bigint, denominator: bigint) {
  return Number(
    (numerator + denominator / BigInt(2)) / denominator,
  );
}

function totals(lines: EditorLine[]) {
  try {
    return calculateInvoiceTotals(
      lines.map((line) => ({
        ...line,
        discountBasisPoints: Math.round(line.discountPercent * 100),
      })),
    );
  } catch {
    return { netAmount: 0, taxAmount: 0, totalAmount: 0, lines: [] };
  }
}

function grossCatalogPriceToNet(gross: number) {
  const approximate = roundDiv(
    BigInt(gross) * BigInt(100),
    BigInt(119),
  );
  for (
    let candidate = Math.max(1, approximate - 2);
    candidate <= approximate + 2;
    candidate += 1
  ) {
    if (
      candidate +
        roundDiv(BigInt(candidate) * BigInt(19), BigInt(100)) ===
      gross
    ) {
      return candidate;
    }
  }
  return approximate;
}

function newLine(): EditorLine {
  return {
    key: crypto.randomUUID(),
    serviceId: null,
    appointmentId: null,
    description: "",
    quantity: 1,
    unitNetAmount: 0,
    discountPercent: 0,
    pricingMode: "manual_net",
    catalogUnitGrossAmount: null,
  };
}

export default function ManualIssuanceForm({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [issuer, setIssuer] = useState<Record<string, string> | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [source, setSource] = useState<"manual" | "appointment" | "payment">(
    "manual",
  );
  const [appointmentId, setAppointmentId] = useState("");
  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [operationalReason, setOperationalReason] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([newLine()]);
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null);
  const [availableDrafts, setAvailableDrafts] = useState<DraftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let active = true;
    void adminFetch("/api/admin/dte-intents/reference-data", {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error("No se pudieron cargar los datos del documento.");
        }
        if (!active) return;
        setCustomers(payload.customers ?? []);
        setServices(payload.services ?? []);
        setAppointments(payload.appointments ?? []);
        setPayments(payload.payments ?? []);
        setIssuer(payload.issuer ?? null);
        const draftsResponse = await adminFetch("/api/admin/invoice-drafts", {
          cache: "no-store",
        });
        const draftsPayload = await draftsResponse.json().catch(() => null);
        if (draftsResponse.ok && draftsPayload?.ok && active) {
          setAvailableDrafts(
            (draftsPayload.drafts as DraftRecord[]).filter((draft) =>
              ["DRAFT", "REVIEW_REQUIRED", "VALIDATED"].includes(draft.status),
            ),
          );
        }
        const params = new URLSearchParams(window.location.search);
        const requestedCustomerId = params.get("customerId") ?? "";
        if ((payload.customers as Customer[]).some((item) => item.id === requestedCustomerId)) {
          setCustomerId(requestedCustomerId);
        }
      })
      .catch((error) => {
        if (active) setFeedback(error instanceof Error ? error.message : "Carga fallida.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentTotals = useMemo(() => totals(lines), [lines]);
  const selectedCustomer = customers.find((item) => item.id === customerId);
  const customerAppointments = appointments.filter(
    (item) => item.customer_id === customerId,
  );
  const appointmentIds = new Set(customerAppointments.map((item) => item.id));
  const customerPayments = payments.filter((item) =>
    appointmentIds.has(item.appointment_id),
  );
  const selectedPayment = payments.find((item) => item.id === paymentIntentId);
  const paymentMatches =
    !selectedPayment || Number(selectedPayment.amount) === currentTotals.totalAmount;
  const canSave =
    Boolean(customerId) &&
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.description.trim() &&
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0 &&
        Number.isSafeInteger(line.unitNetAmount) &&
        line.unitNetAmount > 0 &&
        line.discountPercent >= 0 &&
        line.discountPercent <= 100,
    ) &&
    (source !== "manual" || operationalReason.trim().length >= 10);

  const markChanged = () => {
    setFeedback("");
    if (savedDraft) setSavedDraft({ ...savedDraft, status: "DRAFT" });
  };

  const openDraft = (draftId: string) => {
    const draft = availableDrafts.find((item) => item.id === draftId);
    if (!draft) {
      setSavedDraft(null);
      setLines([newLine()]);
      return;
    }
    setSavedDraft({
      id: draft.id,
      status: draft.status,
      version: Number(draft.version),
      review_reason: draft.review_reason,
    });
    setCustomerId(draft.customer_id);
    setSource(draft.source === "automatic_payment" ? "payment" : draft.source);
    setAppointmentId(draft.appointment_id ?? "");
    setPaymentIntentId(draft.payment_intent_id ?? "");
    setOperationalReason(draft.operational_reason ?? "");
    setLines(
      draft.lines.map((line) => ({
        key: line.id,
        serviceId: line.service_id,
        appointmentId: line.appointment_id,
        description: line.description,
        quantity: Number(line.quantity),
        unitNetAmount: Number(line.unit_net_amount),
        discountPercent: Number(line.discount_basis_points) / 100,
        pricingMode: line.pricing_mode ?? "manual_net",
        catalogUnitGrossAmount:
          line.catalog_unit_gross_amount === null ||
          line.catalog_unit_gross_amount === undefined
            ? null
            : Number(line.catalog_unit_gross_amount),
      })),
    );
    setFeedback(
      draft.review_reason
        ? `Borrador abierto. ${draft.review_reason}`
        : "Borrador abierto para edición.",
    );
  };

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
    markChanged();
  };

  const addService = (serviceId: string) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) return;
    const net = service.priceIncludesVat
      ? grossCatalogPriceToNet(Number(service.price))
      : Number(service.price);
    setLines((current) => [
      ...current.filter(
        (line) =>
          line.description.trim() ||
          line.unitNetAmount > 0 ||
          line.serviceId,
      ),
      {
        key: crypto.randomUUID(),
        serviceId: service.id,
        appointmentId: null,
        description: service.name,
        quantity: 1,
        unitNetAmount: net,
        discountPercent: 0,
        pricingMode: service.priceIncludesVat
          ? "catalog_gross"
          : "manual_net",
        catalogUnitGrossAmount: service.priceIncludesVat
          ? Number(service.price)
          : null,
      },
    ]);
    markChanged();
  };

  const selectAppointment = (id: string) => {
    setAppointmentId(id);
    const appointment = appointments.find((item) => item.id === id);
    if (!appointment || lines.some((line) => line.appointmentId === id)) return;
    const gross = Number(appointment.payment_paid_amount ?? 0);
    if (gross > 0) {
      setLines((current) => [
        ...current.filter((line) => line.description.trim() || line.unitNetAmount > 0),
        {
          key: crypto.randomUUID(),
          serviceId: null,
          appointmentId: id,
          description: appointment.service_name || "Servicio reservado",
          quantity: 1,
          unitNetAmount: grossCatalogPriceToNet(gross),
          discountPercent: 0,
          pricingMode: "catalog_gross",
          catalogUnitGrossAmount: gross,
        },
      ]);
    }
    markChanged();
  };

  const saveDraft = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setFeedback("");
    const bodyLines = lines.map((line) => ({
      serviceId: line.serviceId,
      appointmentId: line.appointmentId,
      description: line.description,
      quantity: line.quantity,
      unitNetAmount: line.unitNetAmount,
      discountBasisPoints: Math.round(line.discountPercent * 100),
      pricingMode: line.pricingMode,
      catalogUnitGrossAmount: line.catalogUnitGrossAmount,
    }));
    const response = savedDraft
      ? await adminFetch(`/api/admin/invoice-drafts/${savedDraft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: savedDraft.version, lines: bodyLines }),
        })
      : await adminFetch("/api/admin/invoice-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId,
            source,
            appointmentId: appointmentId || null,
            paymentIntentId: paymentIntentId || null,
            operationalReason,
            lines: bodyLines,
          }),
        });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setFeedback(payload?.error ?? "No se pudo guardar el borrador.");
      return;
    }
    const nextDraft = savedDraft
      ? { ...savedDraft, ...payload.draft }
      : payload.draft;
    setSavedDraft(nextDraft);
    setAvailableDrafts((current) => {
      const existing = current.find((item) => item.id === nextDraft.id);
      if (!existing && payload.draft?.lines) {
        return [payload.draft as DraftRecord, ...current];
      }
      return current.map((item) =>
        item.id === nextDraft.id ? { ...item, ...nextDraft } : item,
      );
    });
    setFeedback(
      nextDraft.review_reason
        ? `Borrador guardado. ${nextDraft.review_reason}`
        : "Borrador guardado. No se reservó ningún folio.",
    );
    onCreated();
  };

  const issue = async () => {
    if (!savedDraft || issuing) return;
    const confirmed = window.confirm(
      `Se bloquearán ${lines.length} líneas por ${clp(currentTotals.totalAmount)} y se encolará una emisión real. ¿Continuar?`,
    );
    if (!confirmed) return;
    setIssuing(true);
    setFeedback("");
    const response = await adminFetch(
      `/api/admin/invoice-drafts/${savedDraft.id}/issue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: `EMITIR ${savedDraft.id}`,
          version: savedDraft.version,
        }),
      },
    );
    const payload = await response.json().catch(() => null);
    setIssuing(false);
    if (!response.ok || !payload?.ok) {
      setFeedback(payload?.error ?? "No se pudo encolar la factura.");
      return;
    }
    setSavedDraft({ ...savedDraft, status: "QUEUED" });
    setFeedback("Factura validada y encolada. Las líneas y datos tributarios quedaron bloqueados.");
    onCreated();
  };

  if (loading) {
    return <p className="text-sm font-bold text-slate-600">Cargando editor…</p>;
  }

  return (
    <div className="grid gap-5">
      {availableDrafts.length ? (
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Continuar un borrador existente
          <select
            value={savedDraft?.id ?? ""}
            onChange={(event) => openDraft(event.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3"
          >
            <option value="">Crear uno nuevo</option>
            {availableDrafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.status === "REVIEW_REQUIRED" ? "Requiere revisión" : "Borrador"} ·{" "}
                {draft.lines.length} ítem{draft.lines.length === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Cliente receptor
          <select
            value={customerId}
            disabled={Boolean(savedDraft)}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setAppointmentId("");
              setPaymentIntentId("");
              markChanged();
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3"
          >
            <option value="">Seleccionar cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.full_name} · {customer.rut_normalized || "RUT pendiente"}
              </option>
            ))}
          </select>
          {selectedCustomer && !selectedCustomer.tax_profile ? (
            <Link
              href={`/admin/customers?edit=${selectedCustomer.id}&returnTo=/admin/facturacion`}
              className="text-xs font-black text-amber-700 underline"
            >
              Completar datos tributarios
            </Link>
          ) : null}
        </label>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Origen
          <select
            value={source}
            disabled={Boolean(savedDraft)}
            onChange={(event) => {
              setSource(event.target.value as typeof source);
              setAppointmentId("");
              setPaymentIntentId("");
              markChanged();
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3"
          >
            <option value="manual">Venta manual</option>
            <option value="appointment">Reserva pagada</option>
            <option value="payment">Pago confirmado</option>
          </select>
        </label>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <p className="text-xs font-bold uppercase text-slate-500">Emisor vigente</p>
          <p className="mt-1 font-black">{issuer?.issuer_legal_name || "Pendiente"}</p>
          <p className="text-slate-600">{issuer?.issuer_rut || "RUT pendiente"}</p>
        </div>
      </div>

      {source === "appointment" ? (
        <label className="grid gap-1.5 text-sm font-bold">
          Reserva relacionada
          <select
            value={appointmentId}
            disabled={Boolean(savedDraft)}
            onChange={(event) => selectAppointment(event.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3"
          >
            <option value="">Seleccionar reserva</option>
            {customerAppointments.map((appointment) => (
              <option key={appointment.id} value={appointment.id}>
                {new Date(appointment.start_at).toLocaleDateString("es-CL")} ·{" "}
                {appointment.service_name || "Servicio"} ·{" "}
                {appointment.payment_status || "sin pago"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {source === "payment" ? (
        <label className="grid gap-1.5 text-sm font-bold">
          Pago confirmado
          <select
            value={paymentIntentId}
            disabled={Boolean(savedDraft)}
            onChange={(event) => {
              const payment = payments.find((item) => item.id === event.target.value);
              setPaymentIntentId(event.target.value);
              if (payment) selectAppointment(payment.appointment_id);
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3"
          >
            <option value="">Seleccionar pago</option>
            {customerPayments.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {payment.provider} · {clp(payment.amount)} ·{" "}
                {new Date(payment.processed_at).toLocaleDateString("es-CL")}
              </option>
            ))}
          </select>
          {!paymentMatches ? (
            <span className="text-xs font-bold text-red-700">
              El pago es {clp(Number(selectedPayment?.amount))}; debe coincidir con el total.
            </span>
          ) : null}
        </label>
      ) : null}

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="font-black text-slate-950">Líneas de detalle</h4>
            <p className="text-xs text-slate-600">
              El precio del editor es neto. El IVA 19% se agrega al total.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              defaultValue=""
              disabled={savedDraft?.status === "QUEUED"}
              onChange={(event) => {
                addService(event.target.value);
                event.currentTarget.value = "";
              }}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
            >
              <option value="">Agregar servicio del catálogo</option>
              {services.filter((service) => service.tax_treatment !== "exempt").map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {clp(service.price)} total catálogo
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={savedDraft?.status === "QUEUED"}
              onClick={() => {
                setLines((current) => [...current, newLine()]);
                markChanged();
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-black"
            >
              <Plus className="h-4 w-4" /> Concepto manual
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3">
          {lines.map((line, index) => {
            const lineNet = totals([line]).netAmount;
            return (
              <div
                key={line.key}
                className="grid gap-3 rounded-2xl border border-slate-200 p-3 lg:grid-cols-[2fr_0.55fr_1fr_0.7fr_1fr_auto]"
              >
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  Descripción tributaria
                  <input
                    value={line.description}
                    disabled={savedDraft?.status === "QUEUED"}
                    onChange={(event) =>
                      updateLine(line.key, { description: event.target.value })
                    }
                    className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                    placeholder={`Ítem ${index + 1}`}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  Cantidad
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    disabled={savedDraft?.status === "QUEUED"}
                    onChange={(event) =>
                      updateLine(line.key, { quantity: Number(event.target.value) })
                    }
                    className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  Precio neto unitario
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={line.unitNetAmount}
                    disabled={savedDraft?.status === "QUEUED"}
                    onChange={(event) =>
                      updateLine(line.key, {
                        unitNetAmount: Number(event.target.value),
                        pricingMode: "manual_net",
                        catalogUnitGrossAmount: null,
                      })
                    }
                    className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  Descuento %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={line.discountPercent}
                    disabled={savedDraft?.status === "QUEUED"}
                    onChange={(event) =>
                      updateLine(line.key, {
                        discountPercent: Number(event.target.value),
                      })
                    }
                    className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                  />
                </label>
                <div className="grid content-end pb-1">
                  <span className="text-xs font-bold text-slate-500">Neto línea</span>
                  <span className="text-sm font-black">{clp(lineNet)}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Eliminar línea ${index + 1}`}
                  disabled={lines.length === 1 || savedDraft?.status === "QUEUED"}
                  onClick={() => {
                    setLines((current) =>
                      current.filter((candidate) => candidate.key !== line.key),
                    );
                    markChanged();
                  }}
                  className="self-end rounded-lg p-2 text-red-600 disabled:text-slate-300"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {source === "manual" ? (
        <label className="grid gap-1.5 text-sm font-bold">
          Motivo operacional
          <textarea
            value={operationalReason}
            disabled={Boolean(savedDraft)}
            onChange={(event) => {
              setOperationalReason(event.target.value);
              markChanged();
            }}
            minLength={10}
            maxLength={500}
            className="min-h-20 rounded-xl border border-slate-200 p-3"
            placeholder="Describe el respaldo de esta venta manual."
          />
        </label>
      ) : null}

      <div className="grid gap-4 rounded-2xl bg-slate-950 p-5 text-white md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm font-black">Factura electrónica tipo 33</p>
          <p className="mt-1 text-xs text-slate-300">
            {savedDraft
              ? `Estado: ${savedDraft.status}.`
              : "Al guardar seguirá siendo borrador y no consumirá folio."}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-5 text-right">
          <div>
            <dt className="text-xs text-slate-400">Neto</dt>
            <dd className="font-black">{clp(currentTotals.netAmount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">IVA 19%</dt>
            <dd className="font-black">{clp(currentTotals.taxAmount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Total</dt>
            <dd className="text-lg font-black">{clp(currentTotals.totalAmount)}</dd>
          </div>
        </dl>
      </div>

      {feedback ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-950"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {feedback}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={!canSave || saving || savedDraft?.status === "QUEUED"}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black disabled:opacity-40"
        >
          <Save className="h-4 w-4" />
          {saving ? "Guardando…" : savedDraft ? "Guardar cambios" : "Guardar borrador"}
        </button>
        {savedDraft && savedDraft.status !== "QUEUED" ? (
          <button
            type="button"
            onClick={() => void issue()}
            disabled={issuing || !paymentMatches}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
          >
            <FileCheck2 className="h-4 w-4" />
            {issuing ? "Encolando…" : "Revisar y emitir"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
