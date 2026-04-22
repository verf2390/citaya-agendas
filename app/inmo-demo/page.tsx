import Link from "next/link";

import { propiedadesInmo } from "./data";

const pilares = [
  {
    titulo: "Estrategia patrimonial",
    descripcion: "Diseñamos una ruta de compra e inversión según horizonte, liquidez y perfil de riesgo.",
    icono: "◈",
  },
  {
    titulo: "Análisis de plusvalía",
    descripcion: "Combinamos data de mercado y lectura territorial para seleccionar ubicaciones con proyección real.",
    icono: "◎",
  },
  {
    titulo: "Negociación y cierre",
    descripcion: "Defendemos tus intereses en cada etapa con acompañamiento legal y comercial serio.",
    icono: "◇",
  },
  {
    titulo: "Selección curada",
    descripcion: "Filtramos oportunidades por criterio: calidad de activo, entorno y valor de entrada.",
    icono: "✦",
  },
];

const testimonios = [
  {
    nombre: "Martina Rojas",
    contexto: "Inversionista · Providencia",
    frase: "En menos de dos semanas teníamos una terna de activos sólidos y una recomendación totalmente argumentada.",
  },
  {
    nombre: "Felipe Gutiérrez",
    contexto: "Familia joven · Lo Barnechea",
    frase: "Sentimos una asesoría de verdad: transparente, estratégica y con acompañamiento real hasta el cierre.",
  },
  {
    nombre: "Carolina Vidal",
    contexto: "Empresaria · Las Condes",
    frase: "No fue un catálogo: fue una curaduría precisa para decidir con seguridad patrimonial.",
  },
];

export default function InmoDemoHomePage() {
  const destacadas = propiedadesInmo.slice(0, 3);

  return (
    <main className="overflow-x-hidden bg-slate-100 text-slate-900">
      <section className="relative isolate flex min-h-[86vh] items-center overflow-hidden px-4 py-16 sm:px-8 sm:py-20 lg:px-16">
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

        <div className="absolute inset-0 -z-20 bg-slate-950/70 backdrop-blur-[3px]" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(129,140,248,0.24),transparent_35%),radial-gradient(circle_at_80%_15%,rgba(245,158,11,0.16),transparent_35%),linear-gradient(115deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88),rgba(30,27,75,0.8))]" />

        <div className="pointer-events-none absolute -left-24 top-14 -z-10 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-8 -z-10 h-72 w-72 rounded-full bg-amber-300/15 blur-3xl" />

        <div className="mx-auto grid w-full max-w-6xl items-end gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="animate-fade-in-up">
            <p className="inline-flex rounded-full border border-white/20 bg-white/8 px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.28em] text-slate-100 shadow-[0_14px_40px_-20px_rgba(255,255,255,0.45)] backdrop-blur-md">
              Advisory boutique · Santiago Oriente
            </p>
            <h1 className="mt-7 max-w-2xl text-4xl font-semibold leading-[1.02] text-white sm:text-6xl lg:text-7xl">
              Curaduría inmobiliaria premium para patrimonio de alto nivel
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">
              Propiedades excepcionales para residencia o inversión, evaluadas con análisis de valor, visión estratégica y
              acompañamiento experto en cada etapa.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/inmo-demo/propiedades"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-indigo-300/40 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-600 px-7 py-3 text-sm font-semibold text-white shadow-[0_26px_65px_-24px_rgba(79,70,229,1)] ring-1 ring-indigo-200/30 transition-all duration-300 hover:-translate-y-1 hover:brightness-110"
              >
                Ver propiedades premium
              </Link>
              <Link
                href="/inmo-demo/contacto"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/35 bg-white/10 px-7 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/18"
              >
                Hablar con un asesor
              </Link>
            </div>
          </div>

          <aside className="animate-fade-in-up rounded-2xl border border-white/20 bg-white/10 p-6 text-white backdrop-blur-xl shadow-[0_30px_70px_-34px_rgba(15,23,42,1)] [animation-delay:130ms]">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-200">Selección privada</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-100">Santiago Oriente · Inversión / Residencia</p>
            <p className="mt-5 border-t border-white/20 pt-5 text-xs leading-relaxed text-slate-300">
              Activos elegidos por proyección, liquidez y calidad de ubicación con criterios de entrada y salida.
            </p>
          </aside>
        </div>
      </section>

      <section className="bg-white px-4 py-18 sm:px-8 sm:py-24 lg:px-16">
        <div className="mx-auto w-full max-w-6xl animate-fade-in-up">
          <div className="mb-10 flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-slate-500">Selección curada</p>
              <h2 className="mt-4 text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">Propiedades destacadas</h2>
            </div>
            <Link href="/inmo-demo/propiedades" className="hidden text-sm font-medium text-slate-500 transition hover:text-slate-900 sm:inline">
              Ver catálogo completo
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {destacadas.map((propiedad) => (
              <article
                key={propiedad.slug}
                className="group overflow-hidden rounded-2xl border border-slate-300/80 bg-white shadow-[0_28px_70px_-38px_rgba(2,6,23,0.95)] transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_40px_95px_-34px_rgba(2,6,23,1)]"
              >
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={propiedad.imagenPrincipal}
                    alt={propiedad.titulo}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/15 to-transparent" />
                  <span className="absolute left-4 top-4 border border-white/45 bg-slate-900/65 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-100 backdrop-blur-sm">
                    {propiedad.badge}
                  </span>
                  <p className="absolute bottom-4 left-4 border border-white/25 bg-slate-950/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-100 backdrop-blur-sm">
                    {propiedad.tipo}
                  </p>
                </div>

                <div className="space-y-5 p-7">
                  <p className="text-3xl font-semibold tracking-tight text-indigo-700">{propiedad.precio}</p>
                  <div>
                    <h3 className="text-xl font-semibold leading-snug text-slate-900">{propiedad.titulo}</h3>
                    <p className="mt-2 text-sm text-slate-500">{propiedad.ubicacion}</p>
                  </div>
                  <ul className="grid grid-cols-4 gap-2 border border-slate-200 bg-slate-100/80 p-3 text-center text-[11px] uppercase tracking-[0.08em] text-slate-600">
                    <li>
                      <p className="text-sm font-semibold tracking-normal text-slate-900">{propiedad.metros}</p>
                      <p>m²</p>
                    </li>
                    <li>
                      <p className="text-sm font-semibold tracking-normal text-slate-900">{propiedad.habitaciones}</p>
                      <p>Dorm.</p>
                    </li>
                    <li>
                      <p className="text-sm font-semibold tracking-normal text-slate-900">{propiedad.banos}</p>
                      <p>Baños</p>
                    </li>
                    <li>
                      <p className="text-sm font-semibold tracking-normal text-slate-900">{propiedad.estacionamientos}</p>
                      <p>Estac.</p>
                    </li>
                  </ul>
                  <Link
                    href={`/inmo-demo/propiedades/${propiedad.slug}`}
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50"
                  >
                    Ver detalle
                  </Link>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-8 sm:hidden">
            <Link
              href="/inmo-demo/propiedades"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700"
            >
              Ver catálogo completo
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200/80 bg-slate-100 px-4 py-16 sm:px-8 sm:py-22 lg:px-16">
        <div className="mx-auto max-w-6xl animate-fade-in-up">
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Criterio por sobre volumen</p>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
            No solo vendemos propiedades: asesoramos decisiones patrimoniales
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pilares.map((item) => (
              <article
                key={item.titulo}
                className="rounded-2xl border border-slate-300/80 bg-gradient-to-b from-white to-slate-100 p-6 shadow-[0_24px_54px_-34px_rgba(15,23,42,0.9)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_28px_56px_-30px_rgba(15,23,42,0.82)]"
              >
                <p className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-lg text-indigo-700">
                  {item.icono}
                </p>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{item.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.descripcion}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-slate-950 px-4 py-16 text-white sm:px-8 sm:py-22 lg:px-16">
        <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="mx-auto max-w-6xl animate-fade-in-up rounded-3xl border border-white/10 bg-white/5 p-7 shadow-[0_30px_80px_-45px_rgba(0,0,0,1)] backdrop-blur-lg sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-300">Confianza verificable</p>
          <div className="mt-8 grid gap-4 text-center sm:grid-cols-3 sm:text-left">
            <Metric value="+120" label="propiedades gestionadas" />
            <Metric value="UF 380.000" label="en operaciones cerradas" />
            <Metric value="9 años" label="asesorando clientes en Santiago" />
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 border-t border-white/10 pt-7 text-center text-[11px] uppercase tracking-[0.2em] text-slate-400 sm:grid-cols-4">
            <span>Banco Andes</span>
            <span>Capital Sur</span>
            <span>Patrimonio 360</span>
            <span>Inversiones Norte</span>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-16 sm:px-8 sm:py-22 lg:px-16">
        <div className="mx-auto max-w-6xl animate-fade-in-up">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Testimonios</p>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
            Clientes que decidieron con respaldo profesional
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {testimonios.map((testimonio) => (
              <article
                key={testimonio.nombre}
                className="rounded-2xl border border-slate-300/80 bg-gradient-to-b from-white to-slate-100 p-7 shadow-[0_24px_56px_-36px_rgba(15,23,42,0.95)]"
              >
                <p className="text-4xl leading-none text-indigo-200">“</p>
                <p className="mt-4 text-[15px] leading-relaxed text-slate-700">{testimonio.frase}”</p>
                <p className="mt-6 font-semibold text-slate-900">{testimonio.nombre}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{testimonio.contexto}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-100 px-4 pb-18 sm:px-8 lg:px-16">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 px-6 py-14 text-center text-white shadow-[0_38px_95px_-46px_rgba(15,23,42,1)] sm:px-10">
          <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-indigo-500/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="pointer-events-none absolute inset-x-12 top-8 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
          <p className="relative text-[11px] uppercase tracking-[0.24em] text-slate-300">Asesoría privada</p>
          <h2 className="relative mt-4 text-4xl font-semibold leading-tight sm:text-5xl">Recibe una estrategia inmobiliaria hecha para tu perfil</h2>
          <p className="relative mx-auto mt-5 max-w-2xl text-slate-300">
            Cuéntanos tus objetivos y te proponemos opciones reales, seleccionadas con criterio de inversión y calidad de vida.
          </p>
          <div className="relative mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/inmo-demo/contacto"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-indigo-300/40 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-600 px-7 text-sm font-semibold text-white shadow-[0_28px_70px_-24px_rgba(79,70,229,1)] ring-1 ring-indigo-200/30 transition-all duration-300 hover:-translate-y-1 hover:brightness-110"
            >
              Hablar con asesor
            </Link>
            <a
              href="https://wa.me/56961425029"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-emerald-300/35 bg-emerald-400 px-7 text-sm font-semibold text-emerald-950 shadow-[0_24px_52px_-24px_rgba(16,185,129,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-emerald-300"
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
        className="fixed bottom-4 right-4 z-50 inline-flex min-h-12 items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-[0_20px_45px_-24px_rgba(5,150,105,0.75)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-emerald-400"
      >
        <span aria-hidden="true">✦</span>
        WhatsApp
      </a>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <article className="rounded-2xl border border-white/15 bg-white/5 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <p className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">{value}</p>
      <p className="mt-2 text-sm uppercase tracking-[0.14em] text-slate-300">{label}</p>
    </article>
  );
}
