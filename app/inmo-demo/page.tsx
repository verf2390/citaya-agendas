import Link from "next/link";

import { propiedadesInmo } from "./data";

const pilares = [
  {
    titulo: "Estrategia de inversión",
    descripcion: "Definimos una ruta clara para invertir en ubicaciones con proyección real.",
    icono: "↗",
  },
  {
    titulo: "Análisis de plusvalía",
    descripcion: "Evaluamos data de mercado, demanda y horizonte de valorización.",
    icono: "◎",
  },
  {
    titulo: "Acompañamiento completo",
    descripcion: "Te guiamos desde la selección hasta el cierre de la operación.",
    icono: "◇",
  },
  {
    titulo: "Selección personalizada",
    descripcion: "Filtramos propiedades con criterio según perfil, plazo y objetivos.",
    icono: "✦",
  },
];

const testimonios = [
  {
    nombre: "Martina Rojas",
    contexto: "Inversionista · Providencia",
    frase: "Encontramos una propiedad perfecta para inversión en menos de 2 semanas.",
  },
  {
    nombre: "Felipe Gutiérrez",
    contexto: "Familia joven · Lo Barnechea",
    frase: "El proceso se sintió serio, claro y con acompañamiento real en cada decisión.",
  },
  {
    nombre: "Carolina Vidal",
    contexto: "Empresaria · Las Condes",
    frase: "Seleccionaron opciones con criterio. Ahorramos tiempo y elegimos con confianza.",
  },
];

export default function InmoDemoHomePage() {
  const destacadas = propiedadesInmo.slice(0, 3);

  return (
    <main className="overflow-x-hidden bg-[#f8fafc] text-slate-900">
      <section className="relative isolate flex min-h-[78vh] items-center overflow-hidden px-4 py-14 sm:px-8 sm:py-20 lg:px-16">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/inmo-demo/properties/pexels-griffinw-6643264.jpg"
          className="absolute inset-0 -z-30 h-full w-full object-cover"
        >
          <source src="/inmo-demo/hero/17224730-hd_1920_1080_30fps.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 -z-20 bg-slate-950/35 backdrop-blur-[2px]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950/85 via-slate-900/70 to-indigo-950/70" />

        <div className="mx-auto w-full max-w-6xl animate-[fadeIn_700ms_ease-out]">
          <p className="inline-flex rounded-full border border-white/25 bg-white/10 px-4 py-1 text-xs uppercase tracking-[0.2em] text-slate-200">
            Santiago Oriente · Propiedades premium
          </p>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            Propiedades extraordinarias para decisiones inteligentes
          </h1>
          <p className="mt-5 max-w-2xl text-base text-slate-200 sm:text-lg">
            Asesoría inmobiliaria premium para vivir, invertir y proyectar tu patrimonio.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/inmo-demo/propiedades"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-7 py-3 text-sm font-semibold text-white shadow-[0_16px_45px_-14px_rgba(109,40,217,0.9)] transition-all duration-300 hover:scale-[1.02] hover:brightness-110"
            >
              Ver propiedades
            </Link>
            <Link
              href="/inmo-demo/contacto"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/40 bg-white/10 px-7 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-white/20"
            >
              Hablar con asesor
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8 sm:py-20 lg:px-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Selección curada</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">Propiedades destacadas</h2>
          </div>
          <Link href="/inmo-demo/propiedades" className="hidden text-sm font-medium text-slate-500 sm:inline">
            Ver catálogo completo
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {destacadas.map((propiedad) => (
            <article
              key={propiedad.slug}
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_50px_-30px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_30px_60px_-24px_rgba(15,23,42,0.55)]"
            >
              <div className="relative h-56 overflow-hidden">
                <img
                  src={propiedad.imagenPrincipal}
                  alt={propiedad.titulo}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute left-4 top-4 rounded-full border border-white/60 bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-900">
                  {propiedad.badge}
                </span>
              </div>
              <div className="space-y-4 p-5">
                <p className="text-2xl font-semibold text-indigo-700">{propiedad.precio}</p>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{propiedad.titulo}</h3>
                  <p className="text-sm text-slate-500">{propiedad.ubicacion}</p>
                </div>
                <ul className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-600">
                  <li>
                    <p className="font-semibold text-slate-900">{propiedad.metros}</p>
                    <p>m²</p>
                  </li>
                  <li>
                    <p className="font-semibold text-slate-900">{propiedad.habitaciones}</p>
                    <p>Dorm.</p>
                  </li>
                  <li>
                    <p className="font-semibold text-slate-900">{propiedad.banos}</p>
                    <p>Baños</p>
                  </li>
                  <li>
                    <p className="font-semibold text-slate-900">{propiedad.estacionamientos}</p>
                    <p>Estac.</p>
                  </li>
                </ul>
                <Link
                  href={`/inmo-demo/propiedades/${propiedad.slug}`}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Ver detalle
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-4 py-14 sm:px-8 sm:py-16 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-semibold text-slate-950 sm:text-4xl">No solo vendemos propiedades</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pilares.map((item) => (
              <article key={item.titulo} className="rounded-xl border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-1">
                <p className="text-lg text-indigo-700">{item.icono}</p>
                <h3 className="mt-2 text-base font-semibold text-slate-900">{item.titulo}</h3>
                <p className="mt-2 text-sm text-slate-600">{item.descripcion}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f8fafc] px-4 py-14 sm:px-8 sm:py-16 lg:px-16">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="grid gap-4 text-center sm:grid-cols-3 sm:text-left">
            <p className="text-lg font-semibold text-slate-900">+120 propiedades gestionadas</p>
            <p className="text-lg font-semibold text-slate-900">UF 380.000 en operaciones</p>
            <p className="text-lg font-semibold text-slate-900">Clientes asesorados en Santiago</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 text-center text-xs uppercase tracking-[0.2em] text-slate-400 sm:grid-cols-4">
            <span>Banco Andes</span>
            <span>Capital Sur</span>
            <span>Patrimonio 360</span>
            <span>Inversiones Norte</span>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-14 sm:px-8 sm:py-16 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-semibold text-slate-950 sm:text-4xl">Clientes que tomaron decisiones con respaldo</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {testimonios.map((testimonio) => (
              <article key={testimonio.nombre} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm text-slate-600">“{testimonio.frase}”</p>
                <p className="mt-4 font-semibold text-slate-900">{testimonio.nombre}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">{testimonio.contexto}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-4 pb-16 sm:px-8 lg:px-16">
        <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-slate-950 px-6 py-10 text-center text-white sm:px-10">
          <h2 className="text-3xl font-semibold sm:text-4xl">Recibe asesoría inmobiliaria personalizada</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-300">
            Cuéntanos qué buscas y te proponemos opciones reales seleccionadas con criterio.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/inmo-demo/contacto"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-7 text-sm font-semibold text-white shadow-[0_16px_45px_-14px_rgba(109,40,217,0.9)] transition-all duration-300 hover:scale-[1.02] hover:brightness-110"
            >
              Hablar con asesor
            </Link>
            <a
              href="https://wa.me/56961425029"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 px-7 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
            >
              WhatsApp directo
            </a>
          </div>
        </div>
      </section>

      <a
        href="https://wa.me/56961425029"
        target="_blank"
        rel="noreferrer"
        aria-label="Contactar por WhatsApp"
        className="fixed bottom-4 right-4 z-50 inline-flex min-h-12 items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-lg transition hover:-translate-y-0.5 hover:bg-emerald-400"
      >
        <span aria-hidden="true">✦</span>
        WhatsApp
      </a>
    </main>
  );
}
