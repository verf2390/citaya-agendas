import Image from "next/image";
import Link from "next/link";

const painPoints = [
  "Mensajes sin responder a tiempo",
  "Clientes que preguntan y no vuelven",
  "Agenda desordenada y difícil de controlar",
] as const;

const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

export function BrandHeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pb-14 pt-6 sm:px-6 sm:pb-18 sm:pt-8 lg:px-10 lg:pb-24 lg:pt-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-white via-slate-50/90 to-cyan-50/45 sm:h-[560px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-24 h-56 w-56 -translate-x-1/2 rounded-full bg-cyan-200/30 blur-3xl sm:h-72 sm:w-72"
      />

      <div className="relative mx-auto w-full max-w-6xl">
        <header className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-2.5 backdrop-blur sm:mb-5 sm:px-5">
          <Image
            src="/citaya-logo.svg"
            alt="Logo Citaya"
            width={176}
            height={50}
            priority
            className="h-9 w-auto sm:h-10"
          />
          <a
            href="#demos"
            className="text-xs font-semibold tracking-wide text-slate-600 transition-colors hover:text-cyan-700 sm:text-sm"
          >
            Ver demos
          </a>
        </header>

        <div className="grid gap-8 rounded-3xl border border-cyan-100/90 bg-gradient-to-br from-white via-slate-50/95 to-cyan-50/70 p-6 shadow-[0_35px_90px_-55px_rgba(15,23,42,0.4)] sm:p-8 lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-12">
          <div className="motion-safe:animate-fade-up-soft">
            <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-800 sm:text-xs">
              Para negocios locales que viven de su agenda
            </span>

            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:mt-5 sm:text-4xl lg:text-5xl">
              Deja de perder clientes por un WhatsApp desordenado
            </h1>

            <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
              Si hoy agendas respondiendo mensajes uno a uno, estás perdiendo tiempo y clientes.
            </p>
            <p className="mt-2 text-base leading-relaxed text-slate-600 sm:text-lg">
              En Citaya te ayudamos a ordenar tu captación con una web clara, agenda online y automatizaciones simples
              que sí se usan.
            </p>

            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 sm:text-base">
              Tus clientes quieren agendar rápido. Si no pueden, se van.
            </p>

            <ul className="mt-5 space-y-2.5 text-sm text-slate-600 sm:text-base">
              {painPoints.map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-600 shadow-[0_0_0_4px_rgba(8,145,178,0.15)]" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
              <Link
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_22px_44px_-24px_rgba(8,145,178,0.95)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-500 hover:shadow-[0_24px_48px_-22px_rgba(8,145,178,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 active:translate-y-0 active:bg-cyan-700 sm:w-auto"
              >
                Ver cómo funcionaría en mi negocio
              </Link>
              <a
                href="#demos"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white/95 px-6 py-3 text-sm font-semibold text-slate-600 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50/70 hover:text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 active:translate-y-0 sm:w-auto"
              >
                Ver demos reales
              </a>
            </div>

            <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 sm:text-sm">
              Sin compromiso · Explicado en simple · Enfocado en resultados reales
            </p>
          </div>

          <div className="motion-safe:animate-fade-up-soft motion-safe:[animation-delay:80ms]">
            <div className="relative rounded-2xl border border-cyan-100 bg-white p-4 shadow-[0_28px_70px_-44px_rgba(15,23,42,0.65)] sm:p-5">
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-cyan-300/20 blur-3xl"
              />

              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vista previa</p>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  En línea
                </span>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700">Agenda de hoy</p>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-cyan-100 bg-white px-3 py-2">
                    <span className="text-xs text-slate-700">10:30 · Corte + barba</span>
                    <span className="text-[11px] font-semibold text-cyan-700">Confirmado</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-xs text-slate-700">11:15 · Manicure</span>
                    <span className="text-[11px] font-semibold text-slate-500">Pendiente</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-3">
                  <p className="text-[11px] text-slate-500">Reservas</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">+12</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
                  <p className="text-[11px] text-slate-500">Tasa de respuesta</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">94%</p>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-500">Mockup de una experiencia de reserva clara y rápida.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
