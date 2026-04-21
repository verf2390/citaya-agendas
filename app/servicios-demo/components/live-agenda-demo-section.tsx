import Link from "next/link";

export function LiveAgendaDemoSection() {
  return (
    <section className="bg-slate-50/60 px-4 py-10 sm:px-6 sm:py-12 lg:px-10">
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_55px_-42px_rgba(15,23,42,0.7)] sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Demo en vivo</p>
        <p className="mt-3 max-w-3xl text-sm font-medium leading-relaxed text-slate-700 sm:text-base">
          Mira cómo se ve la agenda online funcionando de verdad, con reservas activas y confirmación automática.
        </p>

        <div className="mt-5">
          <Link
            href="https://demo.citaya.online/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-5 py-3 text-sm font-semibold text-cyan-800 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-cyan-300 hover:bg-cyan-100 active:scale-[0.99]"
          >
            Ver agenda funcionando en vivo
            <span aria-hidden className="text-base leading-none">↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
