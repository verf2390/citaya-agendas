import Link from "next/link";

const highlights = [
  "Ordena reservas sin perseguir chats.",
  "Automatiza recordatorios y seguimiento.",
  "Muestra una imagen digital más profesional.",
] as const;

const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

export function BrandHeroSection() {
  return (
    <section className="relative overflow-hidden bg-slate-950 px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10 lg:px-10 lg:pb-24 lg:pt-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(6,182,212,0.18),transparent_42%),radial-gradient(circle_at_92%_8%,rgba(59,130,246,0.24),transparent_35%),linear-gradient(180deg,#020617_0%,#020617_45%,#031525_100%)]"
      />
      <div aria-hidden className="tech-grid absolute inset-0 opacity-50" />
      <div
        aria-hidden
        className="animate-orbit-slow absolute -right-24 top-8 h-[22rem] w-[22rem] rounded-full border border-cyan-400/35 blur-[1px] sm:h-[28rem] sm:w-[28rem]"
      />

      <div className="relative mx-auto w-full max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
          <div className="relative z-10">
            <span className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100 sm:text-xs">
              Citaya · Web + Agenda + Automatización
            </span>

            <h1 className="mt-5 text-4xl font-semibold leading-[1.03] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Menos caos en WhatsApp.
              <span className="block bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 bg-clip-text text-transparent">
                Más reservas, orden y control real.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Diseñamos una presencia digital que ayuda a negocios locales a captar mejor, agendar sin fricción y responder
              a tiempo con procesos simples que sí se sostienen.
            </p>

            <ul className="mt-6 space-y-2.5 text-sm text-slate-200 sm:text-base">
              {highlights.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_0_6px_rgba(34,211,238,0.14)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
              <Link
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_22px_58px_-16px_rgba(34,211,238,0.7)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_32px_78px_-18px_rgba(56,189,248,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:w-auto"
              >
                Ver cómo funcionaría en mi negocio
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <a
                href="/demos"
                className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/75 px-6 py-3 text-sm font-medium text-slate-100 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:w-auto"
              >
                Ver demos
                <span className="text-cyan-300 transition-transform duration-300 group-hover:translate-x-1">→</span>
              </a>
            </div>

            <p className="mt-4 text-xs font-medium tracking-wide text-slate-400 sm:text-sm">
              Implementación clara · Sin complejidad técnica para tu equipo
            </p>
          </div>

          <div className="relative z-10">
            <div className="relative overflow-hidden rounded-3xl border border-cyan-300/20 bg-slate-900/70 p-4 shadow-[0_40px_120px_-45px_rgba(8,145,178,0.8)] backdrop-blur-xl sm:p-5">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(34,211,238,0.22),transparent_46%)]" />
              <svg
                viewBox="0 0 500 500"
                className="animate-fibonacci-spin absolute -right-20 -top-16 h-[340px] w-[340px] text-cyan-300/55 sm:h-[420px] sm:w-[420px]"
                fill="none"
                aria-hidden
              >
                <path d="M250 250m-24 0a24 24 0 1 0 48 0a24 24 0 1 0-48 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-39 0a39 39 0 1 0 78 0a39 39 0 1 0-78 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-63 0a63 63 0 1 0 126 0a63 63 0 1 0-126 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-102 0a102 102 0 1 0 204 0a102 102 0 1 0-204 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-165 0a165 165 0 1 0 330 0a165 165 0 1 0-330 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M95 250C95 162 162 95 250 95" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M250 95C338 95 405 162 405 250" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>

              <div className="relative rounded-2xl border border-slate-700/80 bg-slate-950/80 p-4 sm:p-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Panel Citaya</p>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                    Activo
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2">
                    <p className="text-[11px] text-slate-400">Captación automática</p>
                    <p className="text-sm font-medium text-cyan-200">+18 nuevos contactos esta semana</p>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
                    <p className="text-[11px] text-slate-400">Agenda de hoy</p>
                    <p className="text-sm text-slate-200">12 reservas confirmadas · 0 clientes perdidos</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                    <p className="text-[11px] text-cyan-100/80">Conversión</p>
                    <p className="mt-1 text-xl font-semibold text-white">+34%</p>
                  </div>
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
                    <p className="text-[11px] text-blue-100/80">Respuestas</p>
                    <p className="mt-1 text-xl font-semibold text-white">en 5 min</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
