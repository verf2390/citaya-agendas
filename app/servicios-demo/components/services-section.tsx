import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";
import { SectionHeading } from "./section-heading";

const services = [
  "Página de reserva personalizada",
  "Servicios con precio y duración",
  "Horarios disponibles por negocio",
  "Confirmación automática",
  "Botón directo a WhatsApp",
  "Vista clara de solicitudes y reservas",
  "Demo guiada para tu negocio",
] as const;

export function ServicesSection() {
  return (
    <section className="bg-slate-50/70 px-4 py-14 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll>
          <SectionHeading
            eyebrow="Qué incluye"
            title="Todo lo necesario para dejar de agendar manualmente"
            description="Sin vueltas: esto es lo que obtienes para captar y confirmar reservas de forma más ordenada."
          />
        </RevealOnScroll>

        <RevealOnScroll className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:mt-10 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map((service) => (
              <p key={service} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                ✓ {service}
              </p>
            ))}
          </div>

          <Link href="#solicitar-servicio" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition-all duration-300 hover:bg-slate-100">
            Quiero esto para mi negocio
          </Link>
        </RevealOnScroll>
      </div>
    </section>
  );
}
