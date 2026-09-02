import { RevealOnScroll } from "./reveal-on-scroll";
import { SectionHeading } from "./section-heading";

const benefits = [
  {
    title: "Menos chats, más trabajo productivo",
    description: "Deja de responder lo mismo cada día y recupera horas de foco.",
    icon: "calendar",
  },
  {
    title: "Más reservas sin perseguir clientes",
    description: "Tu página convierte visitas en citas confirmadas de forma automática.",
    icon: "check",
  },
  {
    title: "Operación ordenada y predecible",
    description: "Toda la información entra estructurada para atender mejor y crecer.",
    icon: "shield",
  },
] as const;

function BenefitIcon({ type }: { type: (typeof benefits)[number]["icon"] }) {
  const baseClass = "h-5 w-5 text-indigo-600";

  switch (type) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={baseClass}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={baseClass}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.3 2.3 4.7-4.8" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={baseClass}>
          <path d="M12 3 5 6v6c0 4.6 3 7.8 7 9 4-1.2 7-4.4 7-9V6l-7-3Z" />
          <path d="m9.5 12 1.8 1.8 3.4-3.6" />
        </svg>
      );
  }
}

export function BenefitsSection() {
  return (
    <section className="bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll>
          <SectionHeading
            eyebrow="Beneficios reales"
            title="Resultados que tu cliente nota desde la primera reserva"
            description="No son funciones sueltas: es una experiencia que acelera tus ventas y reduce carga operativa."
          />
        </RevealOnScroll>

        <div className="mt-8 grid gap-4 sm:mt-10 lg:grid-cols-3">
          {benefits.map((benefit, index) => (
            <RevealOnScroll
              key={benefit.title}
              delayMs={index * 80}
              className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <div className="inline-flex rounded-xl bg-indigo-50 p-2.5">
                <BenefitIcon type={benefit.icon} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{benefit.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{benefit.description}</p>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
