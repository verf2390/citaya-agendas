import { SectionHeading } from "./section-heading";

const workflow = [
  "Cliente envía solicitud",
  "Lead entra al sistema",
  "Se confirma automáticamente",
  "Se agenda visita",
  "Se hace seguimiento",
] as const;

export function AutomationFlowSection() {
  return (
    <section className="px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-[linear-gradient(160deg,#f8fafc,#f0f9ff_45%,#ecfeff)] p-6 shadow-[0_24px_65px_-45px_rgba(8,145,178,0.7)] sm:p-9">
        <SectionHeading
          eyebrow="Automatización comercial"
          title="Esto no es solo una página web"
          description="Cada solicitud puede convertirse en un lead organizado, con seguimiento, confirmación y gestión más rápida."
        />

        <div className="mt-7 grid gap-3 sm:mt-9 sm:grid-cols-2 lg:grid-cols-5">
          {workflow.map((step, index) => (
            <div key={step} className="rounded-2xl border border-cyan-100 bg-white/90 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Paso {index + 1}</p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-700">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
