import { SectionHeading } from "./section-heading";

const workflow = [
  "Lead captado desde la web",
  "Confirmación automática al cliente",
  "Priorización comercial por servicio",
  "Agenda técnica coordinada",
  "Seguimiento hasta cierre",
] as const;

const leadStates = [
  { label: "Nuevo lead", client: "Carolina M. · Oficina", note: "Solicita mantención preventiva" },
  { label: "En contacto", client: "Ricardo P. · Hogar", note: "Confirmación por WhatsApp enviada" },
  { label: "Visita agendada", client: "Panadería Centro", note: "Mié 10:30 · Técnico asignado" },
  { label: "Cotización enviada", client: "Edificio Costanera", note: "Propuesta enviada hoy 09:15" },
] as const;

export function AutomationFlowSection() {
  return (
    <section className="px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-[linear-gradient(160deg,#f8fafc,#f0f9ff_45%,#ecfeff)] p-6 shadow-[0_24px_65px_-45px_rgba(8,145,178,0.7)] sm:p-9">
        <SectionHeading
          eyebrow="Automatización comercial"
          title="Tu web funciona como sistema de captación y operación"
          description="No solo recibes formularios: obtienes trazabilidad para responder rápido, ordenar prioridades y cerrar más servicios."
        />

        <div className="mt-7 grid gap-3 sm:mt-9 sm:grid-cols-2 lg:grid-cols-5">
          {workflow.map((step, index) => (
            <div key={step} className="rounded-2xl border border-cyan-100 bg-white/90 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Paso {index + 1}</p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-700">{step}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_20px_45px_-38px_rgba(15,23,42,0.75)] sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Bandeja operativa</p>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Actualización en tiempo real</span>
          </div>
          <div className="mt-3 space-y-2.5">
            {leadStates.map((lead) => (
              <article
                key={lead.client}
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{lead.client}</p>
                  <p className="mt-1 text-sm text-slate-600">{lead.note}</p>
                </div>
                <span className="mt-2 inline-flex rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-700 sm:mt-0">
                  {lead.label}
                </span>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
