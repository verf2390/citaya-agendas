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
    <section className="px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-8 lg:px-10 lg:pb-24 lg:pt-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/75 px-4 py-2.5 backdrop-blur sm:mb-5 sm:px-5">
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

        <div className="relative grid gap-8 overflow-hidden rounded-3xl border border-cyan-100/80 bg-gradient-to-br from-slate-950/[0.03] via-cyan-100/50 to-white p-6 shadow-[0_38px_95px_-48px_rgba(15,23,42,0.5)] sm:p-8 lg:grid-cols-2 lg:items-center lg:gap-12 lg:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-28 right-10 h-72 w-72 rounded-full bg-cyan-300/40 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-20 h-64 w-64 rounded-full bg-sky-200/45 blur-3xl"
          />
          <div>
            <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-800 sm:text-xs">
              Para negocios locales que viven de su agenda
            </span>

            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:mt-5 sm:text-5xl lg:text-6xl">
              Deja de perder clientes por un WhatsApp desordenado
            </h1>

            <p className="mt-5 text-base leading-relaxed text-slate-700 sm:text-lg">
              Si hoy agendas respondiendo mensajes uno a uno, estás perdiendo tiempo y clientes.
            </p>
            <p className="mt-2 text-base leading-relaxed text-slate-700 sm:text-lg">
              En Citaya te ayudamos a ordenar tu captación con una web clara, agenda online y automatizaciones simples
              que sí se usan.
            </p>

            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 sm:text-base">
              Tus clientes quieren agendar rápido. Si no pueden, se van.
            </p>

            <ul className="mt-5 space-y-2.5 text-sm text-slate-700 sm:text-base">
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
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-700 px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-14px_rgba(8,145,178,0.95)] transition-all duration-300 hover:-translate-y-1 hover:bg-cyan-600 hover:shadow-[0_28px_55px_-18px_rgba(8,145,178,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 active:translate-y-0 active:bg-cyan-800 sm:w-auto"
              >
                Ver cómo funcionaría en mi negocio
              </Link>
              <a
                href="#demos"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50/50 hover:text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 active:translate-y-0 sm:w-auto"
              >
                Ver demos reales
              </a>
            </div>

            <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 sm:text-sm">
              Sin compromiso · Explicado en simple · Enfocado en resultados reales
            </p>
          </div>

          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 top-5 h-32 rounded-full bg-cyan-300/45 blur-3xl sm:inset-x-8"
            />
            <div className="relative rounded-2xl border border-cyan-100/90 bg-white/85 p-4 shadow-[0_36px_90px_-40px_rgba(15,23,42,0.65)] backdrop-blur-[2px] sm:p-5">
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

              <p className="mt-4 text-sm text-slate-600">Mockup de una experiencia de reserva clara y rápida.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
