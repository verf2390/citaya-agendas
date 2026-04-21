import { SectionHeading } from "./section-heading";

const steps = [
  {
    number: "01",
    title: "Solicitas el servicio",
    description:
      "El cliente completa una solicitud simple desde el celular o computador, con datos claros del requerimiento.",
  },
  {
    number: "02",
    title: "Agendamos o cotizamos",
    description:
      "La información queda ordenada para priorizar contacto, definir visita técnica o enviar cotización según el tipo de servicio.",
  },
  {
    number: "03",
    title: "Recibes confirmación automática",
    description:
      "El sistema comunica recepción y seguimiento para que cada solicitud avance con trazabilidad y atención profesional.",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section className="bg-slate-50/70 px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Cómo funciona"
          title="Un flujo comercial claro para convertir visitas en oportunidades"
          description="Diseñado para transmitir rapidez, orden y confianza desde el primer contacto con tu empresa."
        />

        <div className="mt-7 grid gap-4 sm:mt-9 md:grid-cols-3">
          {steps.map((step) => (
            <article
              key={step.number}
              className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.6)] sm:p-6"
            >
              <div className="inline-flex rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold tracking-[0.2em] text-cyan-700">
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
