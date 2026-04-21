import Link from "next/link";

const trustPills = [
  "Respuesta inicial en menos de 15 min hábiles",
  "Cobertura La Serena y Coquimbo",
  "Atención para hogar, oficina y local comercial",
] as const;

export function HeroSection() {
  return (
    <section className="px-4 pb-8 pt-8 sm:px-6 sm:pb-12 sm:pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl rounded-3xl border border-cyan-100 bg-[linear-gradient(140deg,#f8fcff,#ecf8ff_45%,#f8fafc)] p-6 shadow-[0_20px_60px_-45px_rgba(14,116,144,0.5)] sm:p-10 lg:p-14">
        <div className="max-w-3xl">
          <span className="inline-flex rounded-full border border-cyan-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 sm:text-xs">
            Climatización residencial y comercial
          </span>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Empieza a recibir reservas automáticas desde hoy
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:mt-5 sm:text-lg">
            Tus clientes eligen horario, tú solo atiendes. Agenda online activa 24/7 con confirmación automática.
          </p>
          <p className="mt-2 text-sm font-medium text-cyan-700/90">Respuestas en menos de 15 minutos</p>

          <div className="mt-6 flex flex-wrap gap-2.5 sm:mt-7">
            {trustPills.map((pill) => (
              <span
                key={pill}
                className="inline-flex min-h-9 items-center rounded-full border border-cyan-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700"
              >
                {pill}
              </span>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200/90 bg-white/85 p-4">
            <p className="text-sm font-semibold text-slate-900">¿Te pasa esto?</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li>• Respondes mensajes todo el día</li>
              <li>• Pierdes clientes por no contestar a tiempo</li>
              <li>• Tu agenda está desordenada</li>
            </ul>
            <p className="mt-3 text-sm font-semibold text-cyan-700">Esto lo soluciona automáticamente 👇</p>
          </div>

          <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
            <Link
              href="/reservar"
              className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-20px_rgba(8,145,178,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-cyan-500 active:scale-[0.99] active:translate-y-0 active:bg-cyan-700 sm:min-h-12 sm:w-auto"
            >
              Ver agenda funcionando en vivo
            </Link>
            <Link
              href="#solicitar-cotizacion"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-cyan-300 hover:text-cyan-700 active:scale-[0.99]"
            >
              Solicitar cotización rápida
            </Link>
          </div>
          <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500">Sin compromiso • Sin pago • Demo real</p>
          <p className="mt-1 text-sm text-slate-600">En menos de 1 minuto puedes ver cómo funciona</p>
          <p className="mt-3 text-sm font-medium text-slate-500">Usado por negocios en La Serena y Coquimbo</p>
        </div>
      </div>
    </section>
  );
}
