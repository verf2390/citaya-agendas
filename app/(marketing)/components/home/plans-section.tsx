"use client";

import Link from "next/link";
import {
  BOOKING_DEMO_TERMS,
  BOOKING_EXCLUSIONS,
  BOOKING_PRICES_CLP,
  formatBookingPriceCLP,
} from "@/lib/commercial/booking-prices";

const whatsappBase = "https://wa.me/56996966059";

type Plan = {
  title: string;
  price: string;
  description: string;
  benefits: string[];
  cta: string;
  message: string;
  footnote?: string;
  highlighted: boolean;
};

const plans: Plan[] = [
  {
    title: "CITAYA Agendas · Inicio",
    price: `${formatBookingPriceCLP(BOOKING_PRICES_CLP.inicioMonthlyNet)} + IVA / mes`,
    description: "Para negocios que quieren recibir reservas por internet y ordenar su agenda.",
    benefits: [
      "Agenda y reservas online",
      "Configuración de servicios y horarios",
      "Enlace para recibir reservas",
      "Gestión de clientes y citas",
    ],
    cta: "Consultar Plan Inicio",
    highlighted: true,
    footnote: `Implementación: ${formatBookingPriceCLP(BOOKING_PRICES_CLP.implementationNet)} + IVA (pago único).`,
    message: "Hola, quisiera información sobre CITAYA Agendas Plan Inicio y coordinar una demo gratuita.",
  },
  {
    title: "CITAYA Agendas · Profesional",
    price: `${formatBookingPriceCLP(BOOKING_PRICES_CLP.profesionalMonthlyNet)} + IVA / mes`,
    description: "Para negocios que necesitan funciones adicionales de gestión.",
    benefits: [
      "Agenda online y gestión de reservas",
      "Lista de espera",
      "DTE según habilitación y configuración tributaria",
      "Funciones avanzadas según disponibilidad del negocio",
    ],
    cta: "Consultar Plan Profesional",
    highlighted: false,
    footnote: `Implementación: ${formatBookingPriceCLP(BOOKING_PRICES_CLP.implementationNet)} + IVA (pago único).`,
    message: "Hola, quisiera información sobre CITAYA Agendas Plan Profesional, DTE y lista de espera.",
  },

];

const supportPills = ["Agenda online real", "Web para servicios", "Ejemplo premium personalizable"] as const;

export function PlansSection() {
  return (
    <section className="bg-white px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-12 lg:px-10 lg:pb-24 lg:pt-14">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Planes claros para empezar con más orden
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Desde una agenda online simple hasta una solución más completa para captar, ordenar y convertir mejor en
            tu negocio.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 lg:mt-12 md:grid-cols-2 lg:items-stretch lg:gap-6">
          {plans.map((plan) => {
            const whatsappHref = `${whatsappBase}?text=${encodeURIComponent(plan.message)}`;
            const cardClasses = plan.highlighted
              ? "relative flex h-full flex-col rounded-3xl border-2 border-cyan-400 bg-gradient-to-b from-white via-cyan-50/35 to-white p-5 shadow-[0_32px_90px_-42px_rgba(8,145,178,0.8)] transition-all duration-300 hover:-translate-y-1 hover:scale-[1.01] sm:p-6"
              : "flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_24px_64px_-38px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 sm:p-6";

            return (
              <article key={plan.title} className={cardClasses}>
                <div>
                  {plan.highlighted ? (
                    <span className="inline-flex rounded-full border border-cyan-300 bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-800">
                      Plan de entrada
                    </span>
                  ) : null}

                  <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{plan.title}</h3>
                  <p className="mt-2 text-3xl font-extrabold leading-tight text-slate-950">{plan.price}</p>

                  <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">{plan.description}</p>
                </div>

                <ul className="mt-5 space-y-2.5">
                  {plan.benefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2.5 text-sm text-slate-700 sm:text-[15px]">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-cyan-500" aria-hidden />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 pt-1">
                  <Link
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_20px_50px_-12px_rgba(8,145,178,0.95)] transition-all duration-300 hover:from-cyan-600 hover:to-cyan-500 hover:shadow-[0_30px_72px_-16px_rgba(8,145,178,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2"
                  >
                    {plan.cta}
                  </Link>

                  {plan.footnote ? <p className="mt-2 text-xs text-slate-500">{plan.footnote}</p> : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mx-auto mt-6 max-w-3xl text-center">
          <p className="text-sm leading-relaxed text-slate-600">
            ¿Necesitas una página web, optimización o desarrollo a medida? Esos proyectos se cotizan de forma independiente.
          </p>
          <Link href="/servicios#planes-web" className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 px-5 py-3 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100">
            Conocer planes de desarrollo web
          </Link>
        </div>

        <p className="mx-auto mt-5 max-w-3xl text-center text-sm leading-relaxed text-slate-600">
          {BOOKING_DEMO_TERMS} {BOOKING_EXCLUSIONS} Los servicios web personalizados se cotizan por alcance.
        </p>

        <div className="mx-auto mt-8 max-w-3xl text-center sm:mt-10">
          <p className="text-base leading-relaxed text-slate-700 sm:text-lg">
            Esto no funciona con plantillas rígidas. Se adapta a cómo vendes, cómo atiendes y cómo quieres ordenar tu
            negocio.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 sm:mt-5 sm:gap-3">
            {supportPills.map((pill) => (
              <span
                key={pill}
                className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3.5 py-1.5 text-xs font-medium text-cyan-800 sm:text-sm"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
