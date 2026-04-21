import Link from "next/link";

export function FinalCtaSection() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
      <div className="mx-auto max-w-5xl rounded-3xl bg-[linear-gradient(145deg,#0f172a,#0c4a6e)] px-6 py-9 text-white shadow-[0_30px_80px_-45px_rgba(2,132,199,0.7)] sm:px-10 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Cierre comercial</p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          Una web que no solo se ve bien: te ayuda a generar clientes
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50 sm:text-base">
          Convierte visitas en oportunidades reales con un flujo claro de contacto, agenda y
          seguimiento. Tu negocio de climatización se proyecta serio, moderno y listo para escalar.
        </p>

        <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
          <Link
            href="https://wa.me/56912345678"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-emerald-950 transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-300"
          >
            Hablar por WhatsApp
          </Link>
          <Link
            href="#solicitar-demo"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-cyan-200/40 bg-white/10 px-6 py-3 text-sm font-semibold text-cyan-50 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20"
          >
            Solicitar demo
          </Link>
        </div>
      </div>
    </section>
  );
}
