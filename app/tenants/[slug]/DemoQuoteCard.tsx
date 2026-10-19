"use client";

import { useMemo, useState } from "react";
import { BOOKING_DEMO_TERMS, BOOKING_EXCLUSIONS, BOOKING_PRICES_CLP } from "@/lib/commercial/booking-prices";

const BUSINESS_OPTIONS = [
  "Barbería",
  "Peluquería",
  "Estética",
  "Uñas y pestañas",
  "Odontología",
  "Kinesiología",
  "Psicología",
  "Centro médico",
  "Veterinaria",
  "Masajes / terapias",
  "Entrenamiento personal",
  "Control de plagas",
  "Asesorías",
  "Clases particulares",
  "Tattoo / piercing",
  "Spa",
  "Podología",
  "Otro",
] as const;


function formatClp(value: number) {
  return new Intl.NumberFormat("es-CL").format(value);
}

export default function DemoQuoteCard() {
  const [businessType, setBusinessType] = useState<string>(BUSINESS_OPTIONS[0]);
  const [selectedPlan, setSelectedPlan] = useState<"inicio" | "profesional">("inicio");
  const [professionalsInput, setProfessionalsInput] = useState<string>("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const professionals = useMemo(() => {
    const parsed = Number(professionalsInput);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return Math.floor(parsed);
  }, [professionalsInput]);

  // El número de profesionales sirve para orientar una propuesta, no para cobrar
  // automáticamente recargos no aprobados en el tarifario vigente.
  const monthlyPrice = selectedPlan === "inicio"
    ? BOOKING_PRICES_CLP.inicioMonthlyNet
    : BOOKING_PRICES_CLP.profesionalMonthlyNet;
  const needsLeadForm = Boolean(professionals && professionals > 10);
  const hasValidQuote = Boolean(professionals);

  const whatsappHref = useMemo(() => {
    const lines = [
      "Hola! 👋",
      "Estuve viendo la agenda y se ve súper buena.",
      "",
      `Tengo un negocio de ${businessType}${professionals ? ` con ${professionals} ${professionals === 1 ? "persona" : "personas"}` : ""} y quiero ordenar mejor mis reservas.`,
      "",
      "¿Me puedes contar cómo funciona y qué tendría que hacer para usarla?",
    ];

    if (hasValidQuote) {
      lines.push("");
      lines.push(`Plan seleccionado: ${selectedPlan === "inicio" ? "Inicio" : "Profesional"}`);
      lines.push(`Implementación: ${formatClp(BOOKING_PRICES_CLP.implementationNet)} CLP + IVA`);
      lines.push(`Mensualidad: ${formatClp(monthlyPrice)} CLP + IVA`);
      lines.push("Demo gratuita sin compromiso; duración a convenir.");
    }

    if (name.trim() || phone.trim() || email.trim()) {
      lines.push("");
      lines.push("Mis datos:");
      if (name.trim()) lines.push(`Nombre: ${name.trim()}`);
      if (phone.trim()) lines.push(`WhatsApp: ${phone.trim()}`);
      if (email.trim()) lines.push(`Correo: ${email.trim()}`);
    }

    const text = encodeURIComponent(lines.join("\n"));
    return `https://wa.me/56961425029?text=${text}`;
  }, [businessType, professionals, selectedPlan, hasValidQuote, monthlyPrice, name, phone, email]);

  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            Cotizador · Citaya
          </div>

          <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            Calcula cuánto te saldría implementarlo
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Elige tu plan, rubro y cantidad de profesionales. Mostramos los precios
            netos aprobados; el alcance se confirma antes de contratar.
          </p>

          <label className="mt-6 block text-sm font-semibold text-slate-700" htmlFor="citaya-demo-plan">
            Plan de CITAYA Agendas
          </label>
          <select
            id="citaya-demo-plan"
            value={selectedPlan}
            onChange={(event) => setSelectedPlan(event.target.value as "inicio" | "profesional")}
            className="mt-2 h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900"
          >
            <option value="inicio">Inicio · $14.990 + IVA / mes</option>
            <option value="profesional">Profesional · $29.990 + IVA / mes</option>
          </select>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block min-h-[48px] text-sm font-semibold text-slate-700">
                ¿Qué tipo de negocio quieres agendar con Citaya?
              </label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="mt-2 h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none"
              >
                {BUSINESS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block min-h-[48px] text-sm font-semibold text-slate-700">
                Cantidad de profesionales
              </label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="Ej: 3"
                value={professionalsInput}
                onChange={(e) => setProfessionalsInput(e.target.value)}
                className="mt-2 h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none"
              />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600">
            <b>Tarifas de agenda:</b> Inicio <b>$14.990 + IVA/mes</b>, Profesional <b>$29.990 + IVA/mes</b>.
            Implementación <b>$30.990 + IVA</b>, pago único. El Profesional contempla lista de espera y
            DTE según habilitación y configuración. No se suman recargos automáticos por profesional sin cotización.
          </div>
        </div>

        <div className="w-full lg:w-[360px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-slate-600">
              Resumen de cotización
            </div>

            {!hasValidQuote ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                Ingresa la cantidad de profesionales para calcular tu plan.
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs font-semibold text-slate-500">
                      Implementación
                    </div>
                    <div className="mt-1 text-2xl font-extrabold text-slate-900">
                      ${formatClp(BOOKING_PRICES_CLP.implementationNet)} + IVA
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs font-semibold text-slate-500">
                      Mensualidad
                    </div>
                    <div className="mt-1 text-2xl font-extrabold text-slate-900">
                      ${formatClp(monthlyPrice)} + IVA
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  {needsLeadForm ? (
                    <span>
                      Para equipos con varios profesionales confirmamos el alcance de la
                      implementación antes de contratar, sin aplicar recargos no acordados.
                    </span>
                  ) : (
                    <span>
                      Ideal para negocios que quieren partir rápido con reservas
                      online y una atención más profesional.
                    </span>
                  )}
                </div>

                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-4 text-sm font-extrabold text-white shadow-sm hover:opacity-90 active:scale-[0.99]"
                >
                  {needsLeadForm
                    ? "Consultar alcance por WhatsApp"
                    : "Consultar este plan por WhatsApp"}
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-600">
        {BOOKING_DEMO_TERMS} {BOOKING_EXCLUSIONS}
      </p>

      {needsLeadForm && (
        <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="text-sm font-extrabold text-slate-900">
            Déjanos tus datos
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Para equipos grandes podemos orientarte mejor según tu operación.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              type="text"
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />

            <input
              type="tel"
              placeholder="Tu WhatsApp"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />

            <input
              type="email"
              placeholder="Tu correo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </div>
        </div>
      )}
    </section>
  );
}