import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";

const whatsappMessage = encodeURIComponent(
  "Hola, vi esta demo y quiero automatizar mi negocio esta semana.",
);

export function FinalCtaSection() {
  return (
    <section className="px-4 pb-20 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:px-10 lg:pt-24">
      <RevealOnScroll className="mx-auto max-w-5xl rounded-3xl bg-[linear-gradient(145deg,#312e81,#6d28d9_55%,#0f172a)] px-6 py-10 text-white shadow-[0_40px_90px_-45px_rgba(79,70,229,0.75)] sm:px-10 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">Listo para avanzar</p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-4xl">Empieza a automatizar tu negocio hoy</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-indigo-50 sm:text-base">
          En pocos días puedes tener esto funcionando y ver cómo tus clientes reservan sin fricción.
        </p>

        <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
          <Link
            href={`https://wa.me/56961425029?text=${whatsappMessage}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-[0_20px_45px_-20px_rgba(16,185,129,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-emerald-400"
          >
            Hablar por WhatsApp
          </Link>
          <Link
            href="https://demo.citaya.online/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-indigo-200/60 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-white/20"
          >
            Ver demo
          </Link>
        </div>
      </RevealOnScroll>
    </section>
  );
}
