import { SectionHeading } from "./section-heading";

const benefits = [
  {
    title: "Clientes pueden reservar 24/7",
    description: "Tu agenda sigue tomando reservas incluso fuera de horario, sin depender de llamadas o mensajes.",
    icon: "calendar",
  },
  {
    title: "Confirmación automática (WhatsApp o email)",
    description: "Cada reserva queda confirmada al instante para dar confianza y evitar pérdidas por falta de respuesta.",
    icon: "check",
  },
  {
    title: "Evita perder horas respondiendo mensajes",
    description: "Automatiza lo repetitivo y enfócate en atender clientes, cerrar ventas y ejecutar mejor tu servicio.",
    icon: "shield",
  },
] as const;

function BenefitIcon({ type }: { type: (typeof benefits)[number]["icon"] }) {
  const baseClass = "h-5 w-5 text-cyan-600";

  switch (type) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={baseClass}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      );
    case "pin":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={baseClass}>
          <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.5" />
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
    <section className="px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Beneficios de negocio"
          title="Qué incluye esta agenda online"
          description="Beneficios concretos para convertir más y operar con menos carga manual."
        />

        <div className="mt-7 grid gap-4 sm:mt-9 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit) => (
            <article
              key={benefit.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_35px_-30px_rgba(15,23,42,0.5)]"
            >
              <div className="inline-flex rounded-lg bg-cyan-50 p-2.5">
                <BenefitIcon type={benefit.icon} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{benefit.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{benefit.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
