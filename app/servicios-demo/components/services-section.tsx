import Link from "next/link";
import { SectionHeading } from "./section-heading";

const services = [
  {
    title: "Instalación",
    description:
      "Montaje profesional de equipos split y multi split con evaluación técnica previa y puesta en marcha segura.",
  },
  {
    title: "Mantención",
    description:
      "Planes preventivos para extender la vida útil de tus equipos, mejorar rendimiento y reducir fallas inesperadas.",
  },
  {
    title: "Reparación",
    description:
      "Diagnóstico y solución de averías con enfoque rápido para recuperar el confort en tu hogar o negocio.",
  },
  {
    title: "Limpieza de equipos",
    description:
      "Limpieza profunda de unidades internas y externas para optimizar eficiencia, calidad del aire y consumo.",
  },
] as const;

export function ServicesSection() {
  return (
    <section className="bg-slate-50 px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Servicios"
          title="Soluciones de climatización para cada etapa del cliente"
          description="Cada servicio está presentado para convertir interés en acciones concretas desde el sitio web."
        />

        <div className="mt-7 grid gap-4 sm:mt-9 sm:grid-cols-2">
          {services.map((service) => (
            <article
              key={service.title}
              className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_22px_40px_-35px_rgba(2,132,199,0.45)]"
            >
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">{service.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{service.description}</p>
              <Link
                href="#solicitar-servicio"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-700 transition-colors duration-200 hover:bg-cyan-100"
              >
                Solicitar servicio
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
