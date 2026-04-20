export default function ContactoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(212,192,158,0.2),transparent_35%),linear-gradient(160deg,#09090b,#18181b,#0a0a0a)] px-4 py-10 text-white sm:px-6">
      <section className="w-full max-w-xl rounded-3xl border border-stone-300/20 bg-zinc-900/70 p-6 text-center shadow-[0_24px_50px_-34px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-10">
        <p className="text-xs uppercase tracking-[0.22em] text-stone-300">Asesoría premium</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">Contáctanos</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-300 sm:text-base">
          Estamos listos para ayudarte a encontrar tu próxima propiedad con una asesoría estratégica y personalizada.
        </p>

        <div className="mt-7 rounded-2xl border border-stone-300/15 bg-black/25 px-5 py-4 text-left text-sm text-stone-200 sm:text-base">
          <p>
            <span className="font-medium text-[#d4c09e]">Horario:</span> Lunes a Viernes · 09:00 a 19:00
          </p>
          <p className="mt-2">
            <span className="font-medium text-[#d4c09e]">Respuesta promedio:</span> Menos de 30 minutos
          </p>
        </div>

        <a
          href="https://wa.me/56961425029"
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-[#d4c09e] px-6 py-3 text-sm font-semibold text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1] hover:shadow-[0_14px_28px_-16px_rgba(212,192,158,0.9)] sm:w-auto"
        >
          Escribir por WhatsApp
        </a>
      </section>
    </main>
  );
}
