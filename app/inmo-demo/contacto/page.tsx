import { InmoHero } from "../components/inmo-hero";

export default function ContactoPage() {
  return (
    <main>
      <InmoHero
        eyebrow="Concierge inmobiliario"
        title="Recibe asesoría inmobiliaria personalizada"
        subtitle="Cuéntanos qué estás buscando y te contactaremos con una propuesta curada de acuerdo a tu perfil."
        poster="/inmo-demo/properties/pexels-artbovich-8141956.jpg"
        heightClassName="min-h-[80vh]"
      />

      <section className="mx-auto -mt-24 w-full max-w-5xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.55)] sm:p-10 animate-fade-in-up">
          <form className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              Nombre
              <input type="text" className="h-12 rounded-xl border border-slate-300 px-3 text-sm normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200" placeholder="Tu nombre" />
            </label>
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              Email
              <input type="email" className="h-12 rounded-xl border border-slate-300 px-3 text-sm normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200" placeholder="tu@email.com" />
            </label>
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-slate-500 sm:col-span-2">
              ¿Qué propiedad estás buscando?
              <textarea className="min-h-28 rounded-xl border border-slate-300 p-3 text-sm normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200" placeholder="Ej: Departamento 2D+2B en Vitacura para inversión." />
            </label>
            <div className="sm:col-span-2">
              <button type="button" className="btn-inmo-primary w-full justify-center">Solicitar asesoría privada</button>
            </div>
          </form>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href="https://wa.me/56961425029" target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-emerald-950 transition hover:-translate-y-0.5 hover:bg-emerald-400">
              <span aria-hidden="true">✦</span>
              Hablar por WhatsApp
            </a>
            <a href="mailto:verf14@gmail.com" className="btn-inmo-secondary justify-center">Contacto por email</a>
          </div>
        </div>
      </section>
    </main>
  );
}
