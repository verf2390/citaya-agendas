export default function ContactoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-4 py-10 text-slate-900 sm:px-6">
      <section className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Concierge inmobiliario</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-5xl">Recibe asesoría inmobiliaria personalizada</h1>
        <p className="mt-4 max-w-2xl text-slate-600 sm:text-lg">
          Cuéntanos qué buscas y te proponemos opciones reales.
        </p>

        <form className="mt-8 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-slate-600">
            Nombre
            <input type="text" className="h-12 rounded-xl border border-slate-300 px-3" placeholder="Tu nombre" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-600">
            Email
            <input type="email" className="h-12 rounded-xl border border-slate-300 px-3" placeholder="tu@email.com" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-600 sm:col-span-2">
            ¿Qué propiedad estás buscando?
            <textarea className="min-h-28 rounded-xl border border-slate-300 p-3" placeholder="Ej: Departamento 2D+2B en Vitacura para inversión." />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 text-sm font-semibold text-white shadow-[0_16px_45px_-14px_rgba(109,40,217,0.9)] transition-all duration-300 hover:scale-[1.02] hover:brightness-110"
            >
              Solicitar asesoría privada
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href="https://wa.me/56961425029"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
          >
            <span aria-hidden="true">✦</span>
            Hablar por WhatsApp
          </a>
          <a
            href="mailto:verf14@gmail.com"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Contacto por email
          </a>
        </div>
      </section>
    </main>
  );
}
