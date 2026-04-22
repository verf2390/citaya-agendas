import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";
import { SectionHeading } from "./section-heading";

const services = [
  {
    title: "Agenda automática",
    description: "Tus clientes reservan solos sin esperarte en WhatsApp.",
    icon: "📅",
  },
  {
    title: "Confirmaciones instantáneas",
    description: "Cada reserva sale confirmada en segundos y genera confianza.",
    icon: "⚡",
  },
  {
    title: "Orden comercial",
    description: "Toda tu información ordenada sin esfuerzo para vender mejor.",
    icon: "🧠",
  },
  {
    title: "Seguimiento inteligente",
    description: "No pierdes leads: sabes quién pidió, cuándo y qué necesita.",
    icon: "🎯",
  },
] as const;

export function ServicesSection() {
  return (
    <section className="bg-slate-50/70 px-4 py-14 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll>
          <SectionHeading
            eyebrow="Qué incluye el servicio"
            title="Todo lo que necesitas para dejar de responder mensajes todo el día"
            description="Estructura pensada para convertir visitas en reservas confirmadas, con una experiencia clara y premium."
          />
        </RevealOnScroll>

        <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2">
          {services.map((service, index) => (
            <RevealOnScroll
              key={service.title}
              delayMs={index * 80}
              className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-md backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-lg">{service.icon}</div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{service.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{service.description}</p>
              <Link
                href="#solicitar-servicio"
                className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition-all duration-300 hover:bg-slate-100"
              >
                Quiero esto para mi negocio
              </Link>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
