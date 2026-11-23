"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FlaskConical, UsersRound, WalletCards } from "lucide-react";

import { AdminKpiCard, AdminSectionCard, StatusBadge } from "@/components/admin/admin-ui";
import { adminFetch } from "@/lib/api/adminFetch";
import { formatRutWithDots } from "@/lib/dte/rut";
import {
  SETTLEMENT_TIME_ZONE,
  settlementAppointmentPeriod,
  settlementToday,
  type SettlementPeriodUnit,
} from "@/lib/settlements/appointment-period.mjs";
import {
  MAX_DEMO_SETTLEMENT_AMOUNT,
  type DemoSettlementData,
} from "@/lib/settlements/demo-types";
import { splitSettlementAmount } from "@/lib/settlements/percentage.mjs";

const endpoint = "/api/admin/demo-liquidaciones";
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });
const dateTime = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "medium", timeStyle: "short", timeZone: SETTLEMENT_TIME_ZONE, hourCycle: "h23",
});
const percent = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });
const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";
const buttonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
const linkClass = "inline-flex items-center gap-1 text-sm font-bold text-sky-700 underline underline-offset-4";

function readBasisPoints(value: string) {
  if (!/^\d{1,3}(?:[,.]\d{1,2})?$/.test(value.trim())) return null;
  const basisPoints = Math.round(Number(value.trim().replace(",", ".")) * 100);
  return basisPoints <= 10_000 ? basisPoints : null;
}

export default function SettlementsDemo() {
  const [view, setView] = useState<"settlements" | "professionals">("settlements");
  const [data, setData] = useState<DemoSettlementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [periodUnit, setPeriodUnit] = useState<SettlementPeriodUnit>("month");
  const [periodDate, setPeriodDate] = useState(settlementToday);
  const [serviceName, setServiceName] = useState("");
  const [amountText, setAmountText] = useState("");
  const [percentage, setPercentage] = useState("");

  const period = settlementAppointmentPeriod(periodDate, periodUnit);
  const appointments = data?.appointments ?? [];
  const services = [...new Set(appointments.map((row) => row.service_name))]
    .sort((left, right) => left.localeCompare(right, "es-CL"));
  const serviceFilter = services.includes(serviceName) ? serviceName : "";
  const visibleAppointments = serviceFilter ? appointments.filter((row) => row.service_name === serviceFilter) : appointments;
  const selected = visibleAppointments.find((row) => row.id === appointmentId);
  const amount = /^\d+$/.test(amountText.trim()) ? Number(amountText) : 0;
  const basisPoints = readBasisPoints(percentage);
  const validAmount = Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_DEMO_SETTLEMENT_AMOUNT;
  const split = validAmount && basisPoints !== null ? splitSettlementAmount(amount, basisPoints) : null;

  const load = useCallback((signal?: AbortSignal) => {
    const params = new URLSearchParams({ date: periodDate, period: periodUnit });
    return adminFetch(`${endpoint}?${params}`, { signal, cache: "no-store" }).then(async (response) => {
      const result = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (response.ok && result) {
        setLoadError("");
        setData(result);
      } else {
        setLoadError(result?.error ?? "No se pudo cargar la demo.");
      }
      setLoading(false);
    });
  }, [periodDate, periodUnit]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function retryLoad() {
    setLoading(true);
    setLoadError("");
    void load();
  }

  function changePeriod(unit: SettlementPeriodUnit, date: string) {
    if ((periodUnit === unit && periodDate === date) || !settlementAppointmentPeriod(date, unit)) return;
    setLoading(true);
    setLoadError("");
    setFormError("");
    setAppointmentId("");
    setServiceName("");
    setPeriodUnit(unit);
    setPeriodDate(date);
  }

  async function submitProfessional(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setPending(true);
    setNotice("");
    setFormError("");
    const response = await adminFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, action: "professional" }),
    });
    if (response.ok) {
      form.reset();
      setNotice("Persona registrada. Ya está disponible en Agenda.");
      await load();
    } else {
      const result = await response.json().catch(() => null);
      setFormError(result?.error ?? "No se pudo agregar a la persona.");
    }
    setPending(false);
  }

  async function submitSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading || loadError || !selected || !validAmount || basisPoints === null) return;
    setPending(true);
    setNotice("");
    setFormError("");
    const response = await adminFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "settlement", appointmentId: selected.id, simulatedAmount: amount, percentageBps: basisPoints,
      }),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.settlement) {
      setAppointmentId("");
      setAmountText("");
      setPercentage("");
      setNotice("Cierre simulado guardado.");
      await load();
    } else {
      setFormError(result?.error ?? "No se pudo guardar el cierre.");
      if (response.status === 409) await load();
    }
    setPending(false);
  }

  function selectView(next: typeof view) {
    setView(next);
    setNotice("");
    setFormError("");
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          <button type="button" aria-pressed={view === "settlements"} disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 aria-pressed:bg-white aria-pressed:text-slate-950 aria-pressed:shadow-sm"
            onClick={() => selectView("settlements")}>
            <WalletCards aria-hidden="true" size={16} /> Cierres
          </button>
          <button type="button" aria-pressed={view === "professionals"} disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 aria-pressed:bg-white aria-pressed:text-slate-950 aria-pressed:shadow-sm"
            onClick={() => selectView("professionals")}>
            <UsersRound aria-hidden="true" size={16} /> Profesionales
          </button>
        </div>
        <StatusBadge tone="amber">
          <FlaskConical className="mr-1 inline" aria-hidden="true" size={13} /> Cobros simulados
        </StatusBadge>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{loadError}</span>
          <button type="button" onClick={retryLoad} className="font-bold underline">Reintentar</button>
        </div>
      )}
      {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

      {!data && loading && <p role="status" className="text-sm text-slate-600">Cargando datos de la demo…</p>}
      {data && view === "professionals" && (
        <>
          <AdminSectionCard title="Agregar persona" description="Correo y RUT de uso privado. El alta habilita su selección en Agenda y no crea una cuenta de acceso.">
            <form onSubmit={submitProfessional} className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">Nombre completo
                <input name="name" className={inputClass} required maxLength={120} />
              </label>
              <label className="text-sm font-semibold">Rol
                <select name="role" className={inputClass}>
                  <option value="professional">Profesional</option>
                  <option value="assistant">Asistente</option>
                </select>
              </label>
              <label className="text-sm font-semibold">Correo
                <input name="email" type="email" className={inputClass} required maxLength={254} />
              </label>
              <label className="text-sm font-semibold">RUT
                <input name="rut" className={inputClass} required maxLength={24} autoCapitalize="characters" />
              </label>
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                <button type="submit" disabled={pending || loading} className={buttonClass}>
                  {pending ? "Guardando…" : "Agregar a Agenda"}
                </button>
                <Link href="/admin/agenda" className={linkClass}>Ir a Agenda <ChevronRight aria-hidden="true" size={15} /></Link>
              </div>
            </form>
          </AdminSectionCard>
          <AdminSectionCard title="Personas agregadas desde esta demo">
            {data.professionals.length === 0 ? (
              <p className="text-sm text-slate-600">Aún no hay personas registradas desde esta pestaña.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.professionals.map((row) => (
                  <li key={row.professional_id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <p className="font-bold">{row.professionals.name}</p>
                      <p className="break-all text-slate-600">{row.email} · {formatRutWithDots(row.rut)}</p>
                    </div>
                    <StatusBadge>{row.role === "assistant" ? "Asistente" : "Profesional"}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </AdminSectionCard>
        </>
      )}
      {data && view === "settlements" && (
        <>
          <AdminSectionCard title="Nuevo cierre" actions={
            <Link href="/admin/agenda" className={linkClass}><CalendarDays aria-hidden="true" size={16} /> Ir a Agenda</Link>
          }>
            {period && (
              <fieldset disabled={loading || pending} className="mb-5 grid items-end gap-3 sm:grid-cols-[auto_1fr_1fr]">
                <div>
                  <label htmlFor="settlement-period" className="text-sm font-semibold">Periodo</label>
                  <select id="settlement-period" value={periodUnit} className={inputClass} onChange={(event) =>
                    changePeriod(event.target.value === "week" ? "week" : "month", periodDate)}>
                    <option value="month">Mes</option>
                    <option value="week">Semana</option>
                  </select>
                </div>
                <div className="flex h-11 items-center justify-between gap-1 rounded-xl border border-slate-300">
                  <button type="button" className="grid h-full shrink-0 place-items-center px-3 hover:bg-slate-100"
                    aria-label="Periodo anterior" onClick={() => changePeriod(periodUnit, period.previousDate)}>
                    <ChevronLeft aria-hidden="true" size={17} />
                  </button>
                  <span className="text-center text-sm font-semibold capitalize" aria-live="polite">{period.label}</span>
                  <button type="button" className="grid h-full shrink-0 place-items-center px-3 hover:bg-slate-100"
                    aria-label="Periodo siguiente" onClick={() => changePeriod(periodUnit, period.nextDate)}>
                    <ChevronRight aria-hidden="true" size={17} />
                  </button>
                </div>
                <div>
                  <label htmlFor="settlement-service" className="text-sm font-semibold">Servicio</label>
                  <select id="settlement-service" value={serviceFilter} className={inputClass} disabled={!services.length} onChange={(event) => {
                    setServiceName(event.target.value);
                    setAppointmentId("");
                  }}>
                    <option value="">Todos los servicios</option>
                    {services.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
              </fieldset>
            )}
            {loading ? (
              <p role="status" className="text-sm text-slate-600">Cargando citas del periodo…</p>
            ) : loadError ? null : visibleAppointments.length === 0 ? (
              <p className="text-sm text-slate-600">No hay citas disponibles en este periodo.</p>
            ) : (
              <form onSubmit={submitSettlement} className="space-y-5">
                <label className="block text-sm font-semibold">Cita de Agenda
                  <select value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)}
                    className={inputClass} required>
                    <option value="">Selecciona una cita</option>
                    {visibleAppointments.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.service_name} · {row.professional_name} · {dateTime.format(new Date(row.start_at))}
                      </option>
                    ))}
                  </select>
                </label>
                {selected && (
                  <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-slate-600">Servicio</dt><dd className="font-bold">{selected.service_name}</dd></div>
                    <div><dt className="text-slate-600">Profesional</dt><dd className="font-bold">{selected.professional_name}</dd></div>
                    <div><dt className="text-slate-600">Fecha y hora de Chile</dt><dd className="font-bold">{dateTime.format(new Date(selected.start_at))}</dd></div>
                  </dl>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Monto simulado en pesos
                    <input inputMode="numeric" value={amountText} onChange={(event) => setAmountText(event.target.value)}
                      placeholder="60000" required className={inputClass} maxLength={9} />
                  </label>
                  <label className="text-sm font-semibold">Porcentaje para la profesional
                    <input inputMode="decimal" value={percentage} onChange={(event) => setPercentage(event.target.value)}
                      placeholder="40" required className={inputClass} maxLength={6} />
                    <span className="mt-1 block text-xs font-normal text-slate-600">De 0 a 100, con hasta dos decimales.</span>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AdminKpiCard label={selected?.professional_name ?? "Para la profesional"}
                    value={selected && split ? currency.format(split.professionalAmount) : "—"} tone="blue" />
                  <AdminKpiCard label="Para el centro"
                    value={selected && split ? currency.format(split.businessAmount) : "—"} tone="green" />
                </div>
                <button type="submit" disabled={pending || loading || !selected || !split} className={buttonClass}>
                  {pending ? "Guardando…" : "Guardar cierre simulado"}
                </button>
              </form>
            )}
          </AdminSectionCard>
          <AdminSectionCard title="Cierres guardados">
            {data.settlements.length === 0 ? (
              <p className="text-sm text-slate-600">Aquí aparecerán los cierres simulados que guardes.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[38rem] text-left text-sm">
                  <thead className="border-b border-slate-200 text-slate-600">
                    <tr>
                      <th scope="col" className="py-2 pr-4">Cita</th>
                      <th scope="col" className="py-2 pr-4 text-right">Cobro simulado</th>
                      <th scope="col" className="py-2 pr-4 text-right">Profesional</th>
                      <th scope="col" className="py-2 text-right">Centro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.settlements.map((row) => (
                      <tr key={row.id}>
                        <td className="py-3 pr-4">
                          <p className="font-bold">{row.service_name}</p>
                          <p className="text-slate-600">{row.professional_name} · {dateTime.format(new Date(row.start_at))}</p>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-right">{currency.format(row.simulated_amount)}</td>
                        <td className="whitespace-nowrap py-3 pr-4 text-right">
                          <p className="font-bold">{currency.format(row.professional_amount)}</p>
                          <p className="text-xs text-slate-600">{percent.format(row.percentage_bps / 100)} %</p>
                        </td>
                        <td className="whitespace-nowrap py-3 text-right font-bold">{currency.format(row.business_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminSectionCard>
        </>
      )}
    </div>
  );
}
