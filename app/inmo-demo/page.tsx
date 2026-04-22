import Link from "next/link";

import { InmoHero } from "./components/inmo-hero";
import { propiedadesInmo } from "./data";

const pilares = [
  {
    titulo: "Asesoría patrimonial",
    descripcion: "Diseñamos una ruta de compra e inversión según horizonte, liquidez y perfil de riesgo.",
    icono: "◈",
  },
  {
    titulo: "Análisis de plusvalía",
    descripcion: "Combinamos data de mercado y lectura territorial para seleccionar ubicaciones con proyección real.",
    icono: "◎",
  },
  {
    titulo: "Acompañamiento integral",
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
    <main className="overflow-x-hidden">
      <InmoHero
        eyebrow="Advisory boutique · Santiago Oriente"
        title="Residencias y activos premium para decisiones inmobiliarias con criterio patrimonial"
        subtitle="Un sistema inmobiliario curado para clientes que exigen estrategia, confianza y ejecución impecable."
        editorialNote="Selección privada · Santiago Oriente"
      >
        <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,320px)] lg:items-end">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/inmo-demo/propiedades"
              className="btn-inmo-primary shadow-[0_0_40px_rgba(99,102,241,0.35)] transition-transform duration-300 hover:scale-[1.02]"
            >
              Ver propiedades premium
            </Link>
            <Link href="/inmo-demo/contacto" className="btn-inmo-secondary border-white/45 bg-white/10 text-white hover:border-white hover:bg-white/20">
              Hablar con un asesor
            </Link>
          </div>

          <aside className="rounded-2xl border border-white/10 bg-white/10 p-5 text-slate-100 backdrop-blur-xl">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-200/90">Curaduría activa</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-100/90">
              Oportunidades validadas por potencial de plusvalía, calidad de entorno y timing de entrada.
            </p>
          </aside>
        </div>
      </InmoHero>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 flex items-end justify-between gap-4 animate-fade-in-up">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Selección curada</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">Propiedades destacadas</h2>
          </div>
          <Link href="/inmo-demo/propiedades" className="hidden text-sm font-medium text-slate-500 transition hover:text-slate-900 sm:inline">
            Ver catálogo completo
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {destacadas.map((propiedad) => (
            <article key={propiedad.slug} className="inmo-card group animate-fade-in-up">
              <div className="relative h-60 overflow-hidden">
                <img src={propiedad.imagenPrincipal} alt={propiedad.titulo} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-slate-900/5 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full border border-white/55 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-900">
                  {propiedad.badge}
                </span>
                <p className="absolute bottom-4 left-4 rounded-lg bg-slate-950/65 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">{propiedad.tipo}</p>
              </div>

              <div className="space-y-4 p-6">
                <p className="text-2xl font-semibold tracking-tight text-indigo-700">{propiedad.precio}</p>
                <div>
                  <h3 className="text-lg font-semibold leading-snug text-slate-900">{propiedad.titulo}</h3>
                  <p className="mt-1 text-sm text-slate-500">{propiedad.ubicacion}</p>
                </div>
                <ul className="grid grid-cols-4 gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-center text-xs text-slate-600">
                  <li><p className="font-semibold text-slate-900">{propiedad.metros}</p><p>m²</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.habitaciones}</p><p>Dorm.</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.banos}</p><p>Baños</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.estacionamientos}</p><p>Estac.</p></li>
                </ul>
                <Link href={`/inmo-demo/propiedades/${propiedad.slug}`} className="btn-inmo-secondary w-full justify-center">
                  Ver detalle
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200/80 bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-fade-in-up">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Servicios premium</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
            Un servicio de concierge inmobiliario, de principio a cierre
          </h2>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pilares.map((item) => (
              <article key={item.titulo} className="inmo-card p-6">
                <p className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 text-lg text-indigo-700">{item.icono}</p>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{item.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.descripcion}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f3f5f9] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_26px_65px_-42px_rgba(15,23,42,0.6)] sm:p-9 animate-fade-in-up">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Testimonios</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {testimonios.map((testimonio) => (
              <article key={testimonio.nombre} className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6">
                <p className="text-3xl leading-none text-indigo-300">“</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{testimonio.frase}”</p>
                <p className="mt-5 font-semibold text-slate-900">{testimonio.nombre}</p>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{testimonio.contexto}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
