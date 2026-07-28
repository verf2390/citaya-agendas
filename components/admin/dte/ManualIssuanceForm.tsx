"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { adminFetch } from "@/lib/api/adminFetch";

type TaxProfile = { rut_normalized: string; legal_name: string; business_activity: string; tax_address: string; tax_commune: string; tax_city: string; tax_email: string };
type Customer = { id: string; full_name: string; email: string | null; phone: string | null; rut_normalized: string | null; tax_profile: TaxProfile | null };
type Appointment = {
  id: string; customer_id: string | null; service_name: string | null; start_at: string;
  payment_status: string | null; payment_paid_amount: number | null; invoice_requested: boolean; tax_treatment_snapshot: string | null;
};
type Payment = {
  id: string; appointment_id: string; amount: number; currency: string; provider: string; processed_at: string;
};
type Source = "appointment" | "payment" | "standalone";

function clp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency", currency: "CLP", maximumFractionDigits: 0,
  }).format(value || 0);
}

export default function ManualIssuanceForm({ onCreated }: { onCreated: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [issuer, setIssuer] = useState<{ issuer_rut: string; issuer_legal_name: string } | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [source, setSource] = useState<Source>("appointment");
  const [customerId, setCustomerId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [dteType, setDteType] = useState<33 | 39>(33);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await adminFetch("/api/admin/dte-intents/reference-data", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error("No se pudieron cargar clientes, reservas y pagos.");
      setCustomers(payload.customers);
      setIssuer(payload.issuer ?? null);
      setAppointments(payload.appointments);
      setPayments(payload.payments);
      const params = new URLSearchParams(window.location.search);
      const requestedCustomerId = params.get("customerId") ?? "";
      const requestedCustomer = (payload.customers as Customer[]).find((item) => item.id === requestedCustomerId);
      if (requestedCustomer) setCustomerId(requestedCustomer.id);
      const requestedAppointmentId = params.get("appointmentId") ?? "";
      const requestedAppointment = (payload.appointments as Appointment[]).find((item) => item.id === requestedAppointmentId);
      if (requestedAppointment?.customer_id) {
        setSource("appointment");
        setCustomerId(requestedAppointment.customer_id);
        setAppointmentId(requestedAppointment.id);
        setDteType(params.get("dteType") === "39" ? 39 : 33);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Carga fallida.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const customerAppointments = useMemo(
    () => appointments.filter((item) => item.customer_id === customerId),
    [appointments, customerId],
  );
  const customerAppointmentIds = useMemo(
    () => new Set(customerAppointments.map((item) => item.id)),
    [customerAppointments],
  );
  const customerPayments = useMemo(
    () => payments.filter((item) => customerAppointmentIds.has(item.appointment_id)),
    [payments, customerAppointmentIds],
  );
  const selectedPayment = payments.find((item) => item.id === paymentId);
  const selectedAppointmentId = source === "payment"
    ? selectedPayment?.appointment_id ?? ""
    : appointmentId;
  const selectedAppointment = appointments.find((item) => item.id === selectedAppointmentId);
  const serverAmount = source === "payment"
    ? Number(selectedPayment?.amount ?? 0)
    : source === "appointment"
      ? Number(selectedAppointment?.payment_paid_amount ?? 0)
      : quantity * unitPrice;
  const selectedCustomer = customers.find((item) => item.id === customerId);
  const customerActionHref = selectedCustomer
    ? `/admin/customers?edit=${encodeURIComponent(selectedCustomer.id)}&returnTo=/admin/facturacion`
    : "/admin/customers?new=1&returnTo=/admin/facturacion";
  const customerActionLabel = selectedCustomer
    ? selectedCustomer.tax_profile
      ? "Editar cliente / perfil tributario"
      : "Completar datos"
    : "Crear cliente";
  const taxProfileReady = dteType !== 33 || Boolean(selectedCustomer?.tax_profile);
  const isExempt = selectedAppointment?.tax_treatment_snapshot === "exempt";
  const netAmount = isExempt ? 0 : Math.round(serverAmount / 1.19);
  const taxAmount = isExempt ? 0 : serverAmount - netAmount;
  const canReview = Boolean(
    customerId && taxProfileReady &&
    (source === "standalone"
      ? description.trim().length >= 2 && quantity > 0 && unitPrice >= 0 && reason.trim().length >= 10
      : source === "payment" ? paymentId : appointmentId && selectedAppointment?.payment_status === "paid"),
  );

  const requestReview = () => {
    if (!canReview) return;
    setIdempotencyKey(crypto.randomUUID());
    setFeedback("");
    setReviewing(true);
  };

  const submit = async () => {
    if (!reviewing || saving || !idempotencyKey) return;
    setSaving(true);
    setFeedback("");
    const response = await adminFetch("/api/admin/dte-intents/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        source,
        customerId,
        appointmentId: selectedAppointmentId || null,
        paymentIntentId: source === "payment" ? paymentId : null,
        dteType,
        operationalReason: source === "standalone" ? reason : null,
        lines: source === "standalone" ? [{ description, quantity, unitPrice }] : undefined,
        reviewAccepted: true,
      }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setFeedback(payload?.error ?? "No se pudo registrar la intención.");
      return;
    }
    setFeedback(payload.intent?.safe_blocking_reason === "BLOCKED_NOT_AUTHORIZED"
      ? "Intención guardada. El documento está bloqueado porque el tipo aún no está autorizado."
      : payload.intent?.safe_blocking_reason
        ? "Intención guardada y bloqueada hasta completar la activación legal."
        : "Intención guardada y lista para el worker.");
    setReviewing(false);
    onCreated();
  };

  if (loading) return <p role="status" className="text-sm font-bold text-slate-600">Cargando opciones…</p>;
  if (loadError) return (
    <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">
      {loadError} <button type="button" onClick={() => void load()} className="ml-2 underline">Reintentar</button>
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm font-bold">Origen
          <select value={source} onChange={(event) => { setSource(event.target.value as Source); setReviewing(false); }} className="h-11 rounded-xl border px-3">
            <option value="appointment">Reserva existente</option>
            <option value="payment">Pago verificado</option>
            <option value="standalone">Sin reserva ni pago</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">Cliente
          <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setAppointmentId(""); setPaymentId(""); setReviewing(false); }} className="h-11 rounded-xl border px-3">
            <option value="">Seleccionar cliente</option>
            {customers.map((item) => <option key={item.id} value={item.id}>{item.full_name} · {item.rut_normalized || "RUT pendiente"}</option>)}
          </select>
          <Link href={customerActionHref} className="w-fit text-xs font-black text-blue-700 underline">{customerActionLabel}</Link>
          {dteType === 33 && selectedCustomer && !selectedCustomer.tax_profile ? <span className="text-xs font-bold text-amber-700">La factura requiere completar el perfil tributario.</span> : null}
        </label>
        <label className="grid gap-1 text-sm font-bold">Documento
          <select value={dteType} onChange={(event) => { setDteType(Number(event.target.value) as 33 | 39); setReviewing(false); }} className="h-11 rounded-xl border px-3">
            <option value={33}>Factura electrónica 33</option>
            <option value={39}>Boleta electrónica 39 — bloqueada</option>
          </select>
        </label>
      </div>

      {source === "appointment" ? (
        <label className="grid gap-1 text-sm font-bold">Reserva
          <select value={appointmentId} onChange={(event) => { setAppointmentId(event.target.value); setReviewing(false); }} className="h-11 rounded-xl border px-3">
            <option value="">Seleccionar reserva</option>
            {customerAppointments.map((item) => <option key={item.id} value={item.id}>{new Date(item.start_at).toLocaleDateString("es-CL")} · {item.service_name || "Servicio"} · {item.payment_status || "sin pago"}</option>)}
          </select>
        </label>
      ) : null}
      {source === "payment" ? (
        <label className="grid gap-1 text-sm font-bold">Pago verificado
          <select value={paymentId} onChange={(event) => { setPaymentId(event.target.value); setReviewing(false); }} className="h-11 rounded-xl border px-3">
            <option value="">Seleccionar pago</option>
            {customerPayments.map((item) => <option key={item.id} value={item.id}>{item.provider} · {clp(item.amount)} · {new Date(item.processed_at).toLocaleDateString("es-CL")}</option>)}
          </select>
        </label>
      ) : null}
      {source === "standalone" ? (
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-sm font-bold md:col-span-2">Detalle<input value={description} onChange={(event) => { setDescription(event.target.value); setReviewing(false); }} className="h-11 rounded-xl border px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">Cantidad<input type="number" min={1} value={quantity} onChange={(event) => { setQuantity(Number(event.target.value)); setReviewing(false); }} className="h-11 rounded-xl border px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">Precio unitario<input type="number" min={0} value={unitPrice} onChange={(event) => { setUnitPrice(Number(event.target.value)); setReviewing(false); }} className="h-11 rounded-xl border px-3" /></label>
          <label className="grid gap-1 text-sm font-bold md:col-span-4">Motivo operacional
            <textarea value={reason} onChange={(event) => { setReason(event.target.value); setReviewing(false); }} minLength={10} maxLength={500} className="min-h-20 rounded-xl border p-3" placeholder="Explica por qué se emite sin pago ni reserva." />
          </label>
        </div>
      ) : null}

      {reviewing ? (
        <div className="rounded-2xl border-2 border-slate-900 bg-slate-50 p-4">
          <h4 className="font-black">Revisión final explícita</h4>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="font-bold text-slate-500">Emisor</dt><dd>{issuer?.issuer_legal_name || "Pendiente"} · {issuer?.issuer_rut || "RUT pendiente"}</dd></div>
            <div><dt className="font-bold text-slate-500">Receptor</dt><dd>{dteType === 33 ? selectedCustomer?.tax_profile?.legal_name : selectedCustomer?.full_name} · {dteType === 33 ? selectedCustomer?.tax_profile?.rut_normalized : selectedCustomer?.rut_normalized}</dd></div>
            <div><dt className="font-bold text-slate-500">Documento</dt><dd>{dteType === 33 ? "Factura 33" : "Boleta 39 bloqueada"}</dd></div>
            <div><dt className="font-bold text-slate-500">Detalle</dt><dd>{source === "standalone" ? description : selectedAppointment?.service_name}</dd></div>
            <div><dt className="font-bold text-slate-500">Cantidad × precio</dt><dd>{source === "standalone" ? `${quantity} × ${clp(unitPrice)}` : `1 × ${clp(serverAmount)}`}</dd></div>
            <div><dt className="font-bold text-slate-500">Neto / exento</dt><dd>{clp(isExempt ? serverAmount : netAmount)}</dd></div>
            <div><dt className="font-bold text-slate-500">IVA</dt><dd>{clp(taxAmount)}</dd></div>
            <div><dt className="font-bold text-slate-500">Total server-side</dt><dd className="font-black">{clp(serverAmount)}</dd></div>
            {source === "standalone" ? <div><dt className="font-bold text-slate-500">Motivo</dt><dd>{reason}</dd></div> : null}
          </dl>
          <p className="mt-3 text-xs text-slate-600">El servidor volverá a validar tenant, cliente, reserva, pago, monto, impuestos e idempotencia.</p>
          <button type="button" onClick={() => void submit()} disabled={saving} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{saving ? "Registrando…" : "Confirmar intención de emisión"}</button>
        </div>
      ) : (
        <button type="button" onClick={requestReview} disabled={!canReview} className="w-fit rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">Revisar emisión</button>
      )}
      {feedback ? <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-900">{feedback}</p> : null}
    </div>
  );
}
