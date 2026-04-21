import Link from "next/link";
import { SectionHeading } from "./section-heading";

const services = [
  {
    title: "Instalación",
    description:
      "Montaje de equipos split y multi split con evaluación previa, propuesta clara y entrega lista para operar.",
  },
  {
    title: "Mantención",
    description:
      "Planes preventivos para reducir fallas, proteger la inversión y mantener rendimiento estable todo el año.",
  },
  {
    title: "Reparación",
    description:
      "Diagnóstico técnico con prioridad operativa para recuperar confort y continuidad en hogar o negocio.",
  },
  {
    title: "Limpieza de equipos",
    description:
      "Limpieza interna y externa para mejorar calidad del aire, eficiencia energética y vida útil del sistema.",
  },
] as const;

export function ServicesSection() {
  return (
    <section className="bg-slate-50 px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Servicios"
          title="Oferta clara para convertir interés en ventas concretas"
          description="Cada bloque guía al cliente a cotizar o agendar de inmediato, con lenguaje directo y foco comercial."
        />

        <div className="mt-7 grid gap-4 sm:mt-9 sm:grid-cols-2">
          {services.map((service) => (
            <article
              key={service.title}
              className="flex h-full flex-col rounded-2xl border border-slate-300 bg-white p-6 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] transition-all duration-500 hover:-translate-y-3.5 hover:scale-[1.015] hover:border-cyan-500 hover:shadow-[0_52px_110px_-20px_rgba(8,145,178,0.7)]"
            >
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">{service.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{service.description}</p>
              <Link
                href="#solicitar-servicio"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-700"
              >
                Quiero este servicio
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
