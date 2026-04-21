"use client";

import { FormEvent, useState } from "react";
import { SectionHeading } from "./section-heading";

type FormData = {
  nombre: string;
  telefono: string;
  comuna: string;
  tipoServicio: string;
  fechaTentativa: string;
  mensaje: string;
};

const initialFormData: FormData = {
  nombre: "",
  telefono: "",
  comuna: "",
  tipoServicio: "",
  fechaTentativa: "",
  mensaje: "",
};

const continuitySteps = [
  "Clientes pueden reservar 24/7",
  "Confirmación automática (WhatsApp o email)",
  "Evita perder horas respondiendo mensajes",
] as const;

export function LeadCaptureSection() {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormData(initialFormData);
  };

  return (
    <section id="solicitar-servicio" className="bg-slate-50 px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
      <span id="agendar-visita" className="block -translate-y-24" aria-hidden="true" />
      <span id="solicitar-cotizacion" className="block -translate-y-24" aria-hidden="true" />
      <span id="solicitar-demo" className="block -translate-y-24" aria-hidden="true" />

      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold text-slate-600">Esto es opcional. Primero prueba la agenda 👆</p>
            <SectionHeading
              eyebrow="Micro cotizador"
              title="¿Cuánto cuesta implementar esto?"
              description="Hazte una idea rápida según tu negocio"
            />
            <p className="mt-3 text-sm font-semibold text-cyan-700">Primero mira cómo funciona 👇</p>
            <p className="mt-4 rounded-2xl border border-cyan-100 bg-white p-4 text-sm leading-relaxed text-slate-600">
              Planes desde $29.000 mensual según tamaño del negocio
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Este valor es referencial. La configuración final puede variar según servicios, volumen y nivel de
              automatización.
            </p>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_30px_-30px_rgba(15,23,42,0.8)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Qué incluye</p>
              <ul className="mt-3 space-y-2">
                {continuitySteps.map((step) => (
                  <li key={step} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-500" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-300 bg-white p-5 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] sm:p-7">
            {submitted ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
                <div className="inline-flex rounded-full bg-emerald-100 p-2 text-emerald-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8.5 12 2.3 2.3 4.7-4.8" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-emerald-900">Lead recibido y en proceso</h3>
                <p className="mt-2 text-sm leading-relaxed text-emerald-800">
                  Tu solicitud quedó registrada con confirmación automática. El equipo comercial la priorizará para
                  coordinar visita técnica o cotización.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-emerald-800">
                  Próximo paso: contacto inicial para definir fecha y asegurar continuidad del servicio.
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  Registrar otra solicitud
                </button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <InputField
                  id="nombre"
                  label="Nombre y apellido"
                  value={formData.nombre}
                  onChange={(value) => setFormData((prev) => ({ ...prev, nombre: value }))}
                />
                <InputField
                  id="telefono"
                  label="WhatsApp o teléfono"
                  type="tel"
                  value={formData.telefono}
                  onChange={(value) => setFormData((prev) => ({ ...prev, telefono: value }))}
                />
                <InputField
                  id="comuna"
                  label="Comuna"
                  value={formData.comuna}
                  onChange={(value) => setFormData((prev) => ({ ...prev, comuna: value }))}
                />
                <InputField
                  id="tipoServicio"
                  label="Servicio que necesitas"
                  value={formData.tipoServicio}
                  onChange={(value) => setFormData((prev) => ({ ...prev, tipoServicio: value }))}
                />
                <InputField
                  id="fechaTentativa"
                  label="Fecha tentativa"
                  type="date"
                  value={formData.fechaTentativa}
                  onChange={(value) => setFormData((prev) => ({ ...prev, fechaTentativa: value }))}
                />
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Detalle adicional</span>
                  <textarea
                    name="mensaje"
                    rows={4}
                    value={formData.mensaje}
                    onChange={(event) => setFormData((prev) => ({ ...prev, mensaje: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    placeholder="Ej: tipo de espacio, metraje aproximado o urgencia del servicio."
                  />
                </label>

                <button
                  type="submit"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_30px_66px_-10px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-2 hover:scale-[1.015] hover:from-cyan-600 hover:to-cyan-500 hover:shadow-[0_46px_92px_-12px_rgba(8,145,178,1)]"
                >
                  Quiero coordinar mi servicio
                </button>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Resumen de cotización</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Completa los campos para visualizar una propuesta estimada con recomendaciones para tu operación.
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type InputFieldProps = {
  id: string;
  label: string;
  type?: "text" | "tel" | "date";
  value: string;
  onChange: (value: string) => void;
};

function InputField({ id, label, type = "text", value, onChange }: InputFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
    </label>
  );
}
