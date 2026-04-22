import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";

const quickQuoteWhatsappMessage = encodeURIComponent(
  "Hola Victor, vi la demo y quiero una solución similar para mi negocio.",
);

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10 lg:px-10 lg:pb-28">
      <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-[420px] max-w-5xl rounded-full bg-gradient-to-r from-indigo-500/25 via-purple-500/25 to-cyan-400/20 blur-3xl" />

      <RevealOnScroll className="mx-auto grid max-w-6xl items-center gap-8 rounded-[2rem] border border-indigo-100/80 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-6 shadow-[0_40px_120px_-48px_rgba(79,70,229,0.5)] sm:p-10 lg:grid-cols-[1.1fr_0.9fr] lg:p-12">
        <div>
          <span className="inline-flex rounded-full border border-indigo-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-700 sm:text-xs">
            Agenda inteligente para negocios de servicios
          </span>

          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            Deja de perder clientes por WhatsApp
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Transformamos tu negocio en una experiencia online donde tus clientes reservan solos.
          </p>

          <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
            <Link
              href="https://demo.citaya.online/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_20px_55px_-20px_rgba(79,70,229,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:from-indigo-500 hover:to-purple-500 hover:shadow-[0_28px_70px_-18px_rgba(79,70,229,0.9)]"
            >
              Ver demo en vivo
            </Link>
            <Link
              href={`https://wa.me/56961425029?text=${quickQuoteWhatsappMessage}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-6 py-3 text-sm font-semibold text-emerald-700 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-emerald-100 hover:shadow-[0_20px_45px_-25px_rgba(16,185,129,0.8)]"
            >
              Hablar por WhatsApp
            </Link>
          </div>

          <p className="mt-4 text-sm text-slate-500">Sin compromiso · Demo real · Implementación guiada</p>
        </div>

        <div className="relative">
          <div className="absolute -inset-2 rounded-[2rem] bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 blur-xl" aria-hidden="true" />
          <div className="relative rounded-[1.75rem] border border-slate-200/80 bg-white/90 p-4 shadow-[0_24px_80px_-35px_rgba(15,23,42,0.45)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Vista cliente</p>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Reserva en 30 segundos</p>
              <p className="mt-1 text-sm text-slate-600">El cliente elige servicio, horario y confirma al instante.</p>
            </div>
            <div className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="h-3 w-2/3 rounded-full bg-slate-200" />
              <div className="h-3 w-full rounded-full bg-slate-100" />
              <div className="h-10 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600" />
            </div>
          </div>
        </div>
      </RevealOnScroll>
    </section>
  );
}
