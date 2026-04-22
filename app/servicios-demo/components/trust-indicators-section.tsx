import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";

const indicators = [
  {
    title: "Respuesta comercial",
    value: "< 15 min hábiles",
    description: "Tu cliente siente atención inmediata y avanza más rápido.",
  },
  {
    title: "Confirmación",
    value: "Automática",
    description: "Cada reserva se confirma sola por WhatsApp o email.",
  },
  {
    title: "Cobertura",
    value: "La Serena + Coquimbo",
    description: "Operación local, horarios claros y comunicación ordenada.",
  },
] as const;

export function TrustIndicatorsSection() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
      <div className="mx-auto max-w-6xl space-y-6">
        <RevealOnScroll className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.6)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Problema → solución</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Si hoy todo depende de mensajes, estás perdiendo ventas sin notarlo
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Mientras respondes chats, nuevos clientes se enfrían. Con esta experiencia, ellos reservan solos y tú
            recibes cada solicitud lista para cerrar.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
              <p className="text-sm font-semibold text-rose-700">Antes</p>
              <p className="mt-1 text-sm text-rose-900">Respondes todo manualmente y llegas tarde.</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
              <p className="text-sm font-semibold text-amber-700">Durante</p>
              <p className="mt-1 text-sm text-amber-900">La agenda se desordena y se escapan oportunidades.</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
              <p className="text-sm font-semibold text-emerald-700">Después</p>
              <p className="mt-1 text-sm text-emerald-900">Tus clientes reservan solos mientras tú trabajas.</p>
            </div>
          </div>

          <Link
            href="https://instagram.com/fajaspaola"
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-300 hover:bg-slate-100"
          >
            Ver negocio real funcionando
          </Link>
        </RevealOnScroll>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indicators.map((indicator, index) => (
            <RevealOnScroll
              key={indicator.title}
              delayMs={index * 70}
              className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">{indicator.title}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{indicator.value}</p>
              <p className="mt-2 text-sm text-slate-600">{indicator.description}</p>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
