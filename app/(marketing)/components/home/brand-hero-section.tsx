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
    <section className="px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-10 lg:px-10 lg:pt-14">
      <div className="mx-auto grid w-full max-w-6xl gap-8 rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-cyan-50/40 p-6 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.35)] sm:p-8 lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-12">
        <div>
          <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-800 sm:text-xs">
            Para negocios locales que viven de su agenda
          </span>

          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:mt-5 sm:text-4xl lg:text-5xl">
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

          <ul className="mt-5 space-y-2.5 text-sm text-slate-700 sm:text-base">
            {painPoints.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-600" />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
            <Link
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_35px_-20px_rgba(8,145,178,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-cyan-500 active:translate-y-0 active:bg-cyan-700 sm:w-auto"
            >
              Ver cómo funcionaría en mi negocio
            </Link>
            <a
              href="#demos"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 active:translate-y-0 sm:w-auto"
            >
              Ver demos reales
            </a>
          </div>

          <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 sm:text-sm">
            Sin compromiso · Explicado en simple · Enfocado en resultados reales
          </p>
        </div>

        <div className="hidden lg:block">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_55px_-40px_rgba(15,23,42,0.55)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vista previa</p>
            <div className="mt-4 space-y-3">
              <div className="h-8 w-3/4 rounded-lg bg-slate-100" />
              <div className="h-3 w-full rounded bg-slate-100" />
              <div className="h-3 w-5/6 rounded bg-slate-100" />
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="h-10 rounded-xl bg-cyan-100" />
                <div className="h-10 rounded-xl bg-slate-100" />
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-600">Mockup de una experiencia de reserva clara y rápida.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
