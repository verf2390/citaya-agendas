import { RevealOnScroll } from "./reveal-on-scroll";

const capabilities = [
  {
    title: "Agenda organizada",
    description: "Revisa reservas, servicios y disponibilidad desde un mismo panel.",
  },
  {
    title: "Reservas online",
    description: "Ofrece a tus clientes un enlace para elegir un horario disponible.",
  },
  {
    title: "Presencia digital conectada",
    description: "Presenta tus servicios y dirige las consultas al canal adecuado.",
  },
] as const;

const indicators = [
  "Horarios configurables",
  "Enlaces de reserva",
  "Servicios y clientes organizados",
] as const;

export function SocialProofSection() {
  return (
    <section className="bg-slate-950 px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-12 lg:px-10 lg:pb-24 lg:pt-14">
      <div className="mx-auto w-full max-w-6xl">
        <RevealOnScroll className="max-w-3xl">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
            Herramientas para ordenar tu atención
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">
            Conoce las funciones que puedes implementar para organizar reservas, comunicar tus servicios y gestionar
            la atención a tus clientes.
          </p>
        </RevealOnScroll>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:mt-14 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-7">
          {capabilities.map((capability, index) => (
            <RevealOnScroll key={capability.title} delayMs={index * 90}>
              <article className="rounded-3xl border border-cyan-400/30 bg-white/95 p-5 shadow-[0_28px_65px_-32px_rgba(6,182,212,0.55)] transition-all duration-300 hover:-translate-y-2 hover:border-cyan-300 hover:shadow-[0_48px_98px_-20px_rgba(34,211,238,0.68)] sm:p-6">
                <h3 className="text-base font-semibold text-slate-900">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 sm:text-base">{capability.description}</p>
              </article>
            </RevealOnScroll>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-4">
          {indicators.map((indicator, index) => (
            <RevealOnScroll key={indicator} delayMs={index * 60}>
              <div className="flex items-center gap-3 rounded-2xl border border-cyan-300/45 bg-cyan-400/10 px-4 py-3 backdrop-blur-sm">
                <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300" aria-hidden />
                <p className="text-sm font-medium leading-relaxed text-cyan-50">{indicator}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
