import Link from "next/link";

const highlights = [
  "Organiza tu agenda y evita clientes perdidos.",
  "Automatiza recordatorios sin sumar carga operativa.",
  "Convierte tu web en una máquina de reservas.",
] as const;

const particles = [
  "left-[8%] top-[14%]",
  "left-[20%] top-[68%]",
  "left-[36%] top-[24%]",
  "left-[48%] top-[80%]",
  "left-[64%] top-[18%]",
  "left-[78%] top-[62%]",
  "left-[88%] top-[28%]",
] as const;

const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

export function BrandHeroSection() {
  return (
    <section className="relative overflow-hidden bg-slate-950 px-4 pb-18 pt-8 sm:px-6 sm:pb-22 sm:pt-10 lg:px-10 lg:pb-24 lg:pt-12">
      <div aria-hidden className="hero-animated-bg absolute inset-0" />
      <div aria-hidden className="tech-grid animate-grid-pan absolute inset-0 opacity-45" />
      <div aria-hidden className="hero-wave absolute inset-0" />
      <div aria-hidden className="animate-orbit-slow absolute -right-28 top-0 h-[24rem] w-[24rem] rounded-full border border-cyan-300/25 sm:h-[32rem] sm:w-[32rem]" />
      {particles.map((pos, idx) => (
        <span key={pos} aria-hidden className={`hero-particle ${pos}`} style={{ animationDelay: `${idx * 1.2}s` }} />
      ))}

      <div className="relative mx-auto w-full max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[1.07fr_0.93fr] lg:gap-12">
          <div className="relative z-10">
            <span className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100 sm:text-xs">
              Menos desorden · Más reservas
            </span>

            <h1 className="mt-5 text-4xl font-semibold leading-[1.03] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Tu negocio no necesita más chats.
              <span className="block bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-400 bg-clip-text text-transparent">
                Necesita un sistema que convierta y ordene.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              En Citaya unimos web, agenda y automatización para que dejes de perder oportunidades por mensajes sueltos y
              empieces a gestionar reservas con control, velocidad y una imagen digital premium.
            </p>

            <ul className="mt-6 space-y-2.5 text-sm text-slate-200 sm:text-base">
              {highlights.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_0_6px_rgba(34,211,238,0.16)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
              <Link href={whatsappHref} target="_blank" rel="noopener noreferrer" className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_24px_60px_-18px_rgba(34,211,238,0.82)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_34px_84px_-16px_rgba(34,211,238,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:w-auto">
                Ver cómo funcionaría en mi negocio
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <a href="/demos" className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/30 bg-slate-900/85 px-6 py-3 text-sm font-medium text-slate-100 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-200/50 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:w-auto">
                Ver demos
                <span className="text-cyan-300 transition-transform duration-300 group-hover:translate-x-1">→</span>
              </a>
            </div>
          </div>

          <div className="relative z-10">
            <div className="relative overflow-hidden rounded-3xl border border-cyan-300/25 bg-slate-900/70 p-4 shadow-[0_42px_130px_-44px_rgba(8,145,178,0.9)] backdrop-blur-xl sm:p-5">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_78%_0%,rgba(34,211,238,0.24),transparent_42%)]" />
              <svg viewBox="0 0 500 500" className="animate-fibonacci-spin absolute -right-20 -top-18 h-[360px] w-[360px] text-cyan-300/50 sm:h-[440px] sm:w-[440px]" fill="none" aria-hidden>
                <path d="M250 250m-24 0a24 24 0 1 0 48 0a24 24 0 1 0-48 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-39 0a39 39 0 1 0 78 0a39 39 0 1 0-78 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-63 0a63 63 0 1 0 126 0a63 63 0 1 0-126 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-102 0a102 102 0 1 0 204 0a102 102 0 1 0-204 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M250 250m-165 0a165 165 0 1 0 330 0a165 165 0 1 0-330 0" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <div className="relative rounded-2xl border border-slate-700/85 bg-slate-950/80 p-4 sm:p-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sistema Citaya</p>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">En vivo</span>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/8 px-3 py-2">
                    <p className="text-[11px] text-slate-400">Captación automática</p>
                    <p className="text-sm font-medium text-cyan-200">+18 nuevos contactos esta semana</p>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
                    <p className="text-[11px] text-slate-400">Agenda de hoy</p>
                    <p className="text-sm text-slate-200">12 reservas confirmadas · 0 clientes perdidos</p>
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
