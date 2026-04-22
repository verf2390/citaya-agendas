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
    <section className="px-4 pb-20 pt-6 sm:px-6 sm:pb-24 sm:pt-8 lg:px-10 lg:pb-28 lg:pt-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="relative grid gap-8 overflow-hidden rounded-3xl border border-cyan-200/80 bg-gradient-to-br from-slate-950/15 via-cyan-200/75 to-white p-6 shadow-[0_40px_110px_-45px_rgba(15,23,42,0.62)] sm:p-8 lg:grid-cols-2 lg:items-center lg:gap-12 lg:p-12">
          <div
            aria-hidden
            className="animate-gradient-shift pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(14,116,144,0.24),transparent_46%),radial-gradient(circle_at_86%_20%,rgba(34,211,238,0.26),transparent_44%),linear-gradient(120deg,rgba(255,255,255,0.62),rgba(207,250,254,0.68),rgba(224,242,254,0.6),rgba(255,255,255,0.62))]"
          />
          <div
            aria-hidden
            className="animate-glow-drift pointer-events-none absolute -top-24 right-2 h-96 w-96 rounded-full bg-cyan-400/65 blur-[110px]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-20 h-72 w-72 rounded-full bg-sky-300/55 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-[18%] top-[58%] h-16 w-16 rounded-full border border-cyan-300/45 bg-white/35 blur-sm sm:h-20 sm:w-20"
          />
          <div className="relative z-10">
            <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-800 sm:text-xs">
              Para negocios locales que viven de su agenda
            </span>

            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:mt-5 sm:text-5xl lg:text-6xl">
              Deja de perder clientes por un WhatsApp desordenado
            </h1>

            <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
              Si hoy agendas respondiendo mensajes uno a uno, estás perdiendo tiempo y clientes.
            </p>
            <p className="mt-2 text-base leading-relaxed text-slate-600 sm:text-lg">
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
                className="animate-soft-pulse group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 via-sky-500 to-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_24px_56px_-16px_rgba(8,145,178,0.6)] transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.015] hover:shadow-[0_38px_84px_-18px_rgba(14,165,233,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 active:scale-[0.985] sm:w-auto"
              >
                <span>Ver cómo funcionaría en mi negocio</span>
                <span className="text-base transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <a
                href="/demos"
                className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-6 py-3 text-sm font-medium text-slate-600 transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 active:scale-[0.99] sm:w-auto"
              >
                <span>Ver demos</span>
                <span className="text-base text-cyan-700 transition-transform duration-300 group-hover:translate-x-1">→</span>
              </a>
            </div>

            <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 sm:text-sm">
              Sin compromiso · Explicado en simple · Enfocado en resultados reales
            </p>
          </div>

          <div className="relative z-10 rounded-[1.9rem] border border-cyan-200/70 bg-slate-900/[0.035] p-3 backdrop-blur-sm sm:p-4">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.2rem] bg-[radial-gradient(circle,rgba(34,211,238,0.45),rgba(34,211,238,0)_65%)] blur-2xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-2 top-1 h-40 rounded-full bg-cyan-400/75 blur-3xl sm:inset-x-7"
            />
            <div className="animate-floating-card relative scale-[1.02] rounded-3xl border border-cyan-100 bg-white/90 p-4 shadow-[0_62px_150px_-28px_rgba(15,23,42,0.86)] ring-1 ring-cyan-100/70 backdrop-blur-[3px] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_72px_170px_-26px_rgba(14,165,233,0.58)] sm:p-5 motion-safe:lg:translate-y-1">
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
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-3 py-3 shadow-[0_14px_26px_-20px_rgba(6,182,212,0.8)]">
                  <p className="text-[11px] text-slate-500">Reservas</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">+12</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 shadow-[0_14px_26px_-20px_rgba(16,185,129,0.8)]">
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
