import { RevealOnScroll } from "./reveal-on-scroll";

export function HomeSummarySection() {
  return (
    <section className="bg-white px-4 pb-10 pt-4 sm:px-6 sm:pb-12 lg:px-10">
      <RevealOnScroll className="mx-auto grid w-full max-w-6xl gap-5 rounded-3xl border border-slate-200 bg-slate-50/80 p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.48)] backdrop-blur-sm sm:p-8 lg:grid-cols-3 lg:gap-8">
        <div className="lg:col-span-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">¿Qué hace Citaya por tu negocio?</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Diseñamos una presencia digital que convierte mejor: una web clara, agenda online y automatizaciones
            simples para captar y ordenar clientes sin fricción.
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50/85 p-4 shadow-[0_24px_42px_-34px_rgba(6,182,212,0.9)] backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">Enfoque</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 sm:text-base">
            Menos mensajes manuales, más reservas claras y mejor experiencia para tus clientes.
          </p>
        </div>
      </RevealOnScroll>
    </section>
  );
}
