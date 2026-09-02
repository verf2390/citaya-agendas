"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const countdownTarget = new Date("2026-04-30T23:59:59-04:00").getTime();
const whatsappBase = "https://wa.me/56961425029";

type Plan = {
  title: string;
  price: string;
  subtitle?: string;
  description: string;
  benefits: string[];
  cta: string;
  message: string;
  footnote?: string;
  note?: string;
  highlighted: boolean;
};

const plans: Plan[] = [
  {
    title: "Empieza a ordenar",
    price: "$14.990 / mes",
    subtitle: "Implementación gratis por 1 mes",
    description:
      "Ideal para negocios que hoy agendan por WhatsApp y pierden clientes por desorden o demora en responder.",
    benefits: [
      "Agenda online 24/7",
      "Confirmación automática",
      "Link de reserva",
      "Configuración inicial",
      "Soporte base",
    ],
    cta: "Quiero esta promo",
    highlighted: true,
    note: "Oferta hasta el 30 de abril",
    message: "Hola Victor, quiero tomar la promo Empieza a ordenar de Citaya.",
  },
  {
    title: "Negocio profesional",
    price: "Desde $250.000 a $600.000 CLP",
    description:
      "Para negocios que necesitan una página clara, profesional y enfocada en generar más consultas.",
    benefits: [
      "Página web profesional",
      "WhatsApp integrado",
      "Formularios",
      "Diseño responsive",
      "Estructura para vender",
      "Opción de agenda online",
    ],
    cta: "Quiero esta opción",
    highlighted: false,
    footnote: "El valor depende del alcance y funcionalidades.",
    message: "Hola Victor, quiero la opción Negocio profesional de Citaya.",
  },
  {
    title: "Solución personalizada",
    price: "Desde $990.000 CLP",
    description:
      "Para negocios que necesitan una solución más completa, con mayor personalización y mejor estructura para escalar.",
    benefits: [
      "Web premium personalizada",
      "Automatizaciones básicas",
      "SEO base",
      "Integraciones según negocio",
      "Estructura comercial más robusta",
    ],
    cta: "Quiero una propuesta",
    highlighted: false,
    message: "Hola Victor, quiero una propuesta personalizada de Citaya.",
  },
];

const supportPills = ["Agenda online real", "Web para servicios", "Ejemplo premium personalizable"] as const;

function formatCountdown(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { days, hours, minutes };
}

export function PlansSection() {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(countdownTarget - Date.now(), 0));

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingMs(Math.max(countdownTarget - Date.now(), 0));
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  const countdown = useMemo(() => formatCountdown(remainingMs), [remainingMs]);
  const shouldShowCountdown = remainingMs > 0;

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

        <div className="mt-10 grid grid-cols-1 gap-5 lg:mt-12 lg:grid-cols-3 lg:items-stretch lg:gap-6">
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
                      {plan.note}
                    </span>
                  ) : null}

                  <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{plan.title}</h3>
                  <p className="mt-2 text-3xl font-extrabold leading-tight text-slate-950">{plan.price}</p>

                  {plan.subtitle ? <p className="mt-2 text-sm font-medium text-cyan-700">{plan.subtitle}</p> : null}

                  {plan.highlighted && shouldShowCountdown ? (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-white/90 px-3 py-2 text-xs font-medium text-slate-700">
                      <span className="font-semibold text-slate-900">Termina en</span>
                      <span>{countdown.days}d</span>
                      <span>{countdown.hours}h</span>
                      <span>{countdown.minutes}m</span>
                    </div>
                  ) : null}

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
