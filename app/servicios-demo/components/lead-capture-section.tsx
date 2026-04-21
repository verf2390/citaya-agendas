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

export function LeadCaptureSection() {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormData(initialFormData);
  };

  return (
    <section id="solicitar-servicio" className="bg-slate-50 px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <span id="agendar-visita" className="block -translate-y-24" aria-hidden="true" />
      <span id="solicitar-cotizacion" className="block -translate-y-24" aria-hidden="true" />
      <span id="solicitar-demo" className="block -translate-y-24" aria-hidden="true" />

      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <SectionHeading
              eyebrow="Captación de clientes"
              title="Solicita tu servicio en minutos"
              description="Este formulario simula un ingreso de lead real: datos ordenados, solicitud registrada y confirmación visual inmediata."
            />
            <p className="mt-4 rounded-2xl border border-cyan-100 bg-white p-4 text-sm leading-relaxed text-slate-600">
              Completa los datos y recibe una confirmación integrada en la misma experiencia. Sin fricción, sin recargas y con una percepción de sistema profesional.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.7)] sm:p-7">
            {submitted ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
                <div className="inline-flex rounded-full bg-emerald-100 p-2 text-emerald-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8.5 12 2.3 2.3 4.7-4.8" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-emerald-900">Solicitud recibida correctamente</h3>
                <p className="mt-2 text-sm leading-relaxed text-emerald-800">
                  Tu solicitud fue recibida. Te enviaremos confirmación automáticamente.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-emerald-800">
                  Te contactaremos para confirmar la visita o enviarte una cotización según el servicio solicitado.
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
                  label="Nombre"
                  value={formData.nombre}
                  onChange={(value) => setFormData((prev) => ({ ...prev, nombre: value }))}
                />
                <InputField
                  id="telefono"
                  label="Teléfono"
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
                  label="Tipo de servicio"
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
                  <span className="mb-2 block text-sm font-medium text-slate-700">Mensaje</span>
                  <textarea
                    name="mensaje"
                    rows={4}
                    value={formData.mensaje}
                    onChange={(event) => setFormData((prev) => ({ ...prev, mensaje: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    placeholder="Cuéntanos brevemente qué necesitas."
                  />
                </label>

                <button
                  type="submit"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-20px_rgba(8,145,178,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-cyan-500"
                >
                  Solicitar visita técnica
                </button>
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
