import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";

export function LiveAgendaDemoSection() {
  return (
    <section className="px-4 py-14 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.55)] sm:p-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Demo en vivo</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Mira cómo se vería en tu negocio</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
              Visualiza una experiencia real tipo agenda/celular con reservas activas, confirmación automática y flujo
              listo para vender.
            </p>

            <Link
              href="https://demo.citaya.online/"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_20px_55px_-20px_rgba(79,70,229,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02]"
            >
              Quiero esto para mi negocio
            </Link>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-900 to-slate-800 p-4 shadow-inner">
            <div className="mx-auto w-full max-w-[280px] rounded-[2rem] border border-white/20 bg-slate-950 p-3">
              <div className="rounded-[1.35rem] bg-white p-3">
                <div className="h-2.5 w-16 rounded-full bg-slate-200" />
                <div className="mt-3 space-y-2">
                  <div className="h-8 rounded-lg bg-indigo-100" />
                  <div className="h-8 rounded-lg bg-slate-100" />
                  <div className="h-8 rounded-lg bg-slate-100" />
                  <div className="h-10 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600" />
                </div>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
