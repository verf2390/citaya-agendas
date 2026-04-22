import { SectionHeading } from "./section-heading";

const steps = [
  {
    number: "01",
    title: "Cliente completa el formulario",
    description:
      "La solicitud entra con datos clave para decidir rápido: tipo de servicio, comuna, fecha tentativa y contexto.",
  },
  {
    number: "02",
    title: "Tu equipo prioriza y contacta",
    description:
      "El lead llega ordenado para responder antes, agendar visita técnica o enviar cotización según urgencia.",
  },
  {
    number: "03",
    title: "Se confirma y se ejecuta",
    description:
      "El cliente recibe confirmación automática y tu operación continúa con seguimiento claro hasta el cierre.",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section className="bg-slate-50 px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Cómo funciona"
          title="Un embudo simple: captar, ordenar y convertir"
          description="El recorrido está pensado para negocios de servicios locales que necesitan velocidad comercial y control operativo."
        />

        <div className="mt-7 grid gap-4 sm:mt-9 md:grid-cols-3">
          {steps.map((step) => (
            <article
              key={step.number}
              className="relative rounded-2xl border border-slate-300 bg-white p-5 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] transition-all duration-500 hover:-translate-y-1 hover:border-indigo-500 hover:shadow-[0_52px_110px_-20px_rgba(8,145,178,0.7)] sm:p-6"
            >
              <div className="inline-flex rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold tracking-[0.2em] text-indigo-600">
                {step.number}
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
