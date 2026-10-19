import Link from "next/link";
import {
  formatWebServicePriceCLP,
  WEB_SERVICE_PRICES_CLP,
} from "@/lib/commercial/web-service-prices";
import { whatsappHref } from "./marketing-content";

type Offer = {
  name: string;
  price: number;
  priceMode: "fixed" | "from";
  frequency?: "month";
  subtitle: string;
  deliverables: readonly string[];
};

const websites: readonly Offer[] = [
  {
    name: "Web Presencia",
    price: WEB_SERVICE_PRICES_CLP.presencia,
    priceMode: "fixed",
    subtitle: "Landing para emprendedores y profesionales",
    deliverables: [
      "Hasta 5 secciones en una sola página",
      "Diseño adaptable a celulares",
      "WhatsApp y formulario con canal de recepción configurado",
      "SEO técnico inicial y hasta 2 rondas de correcciones",
    ],
  },
  {
    name: "Web Negocios",
    price: WEB_SERVICE_PRICES_CLP.negocios,
    priceMode: "fixed",
    subtitle: "Sitio corporativo para pequeñas empresas",
    deliverables: [
      "Hasta 5 páginas de contenido",
      "Diseño responsive, servicios y contacto",
      "SEO inicial y analítica básica según configuración",
      "Hasta 3 rondas de correcciones",
    ],
  },
  {
    name: "Web Premium / Catálogo",
    price: WEB_SERVICE_PRICES_CLP.premiumFrom,
    priceMode: "from",
    subtitle: "Presentación de proyectos, servicios o catálogos",
    deliverables: [
      "Diseño personalizado y navegación estructurada",
      "Fichas, fotografías y filtros según alcance",
      "Carga inicial acotada y SEO base",
      "Presupuesto según volumen y funcionalidades",
    ],
  },
  {
    name: "Software web a medida",
    price: WEB_SERVICE_PRICES_CLP.customSoftwareFrom,
    priceMode: "from",
    subtitle: "Paneles, procesos e integraciones particulares",
    deliverables: [
      "Levantamiento de requisitos y evaluación técnica",
      "Propuesta por etapas con entregables definidos",
      "Integraciones según factibilidad",
      "Alcance y calendario acordados antes de implementar",
    ],
  },
];

const improvements: readonly Offer[] = [
  {
    name: "Auditoría web",
    price: WEB_SERVICE_PRICES_CLP.audit,
    priceMode: "fixed",
    subtitle: "Revisión y diagnóstico de tu página actual",
    deliverables: [
      "Informe priorizado de rendimiento y SEO técnico",
      "Revisión inicial de experiencia móvil y accesibilidad",
      "Hallazgos y mejoras recomendadas",
      "La ejecución de correcciones se cotiza aparte",
    ],
  },
  {
    name: "Optimización técnica",
    price: WEB_SERVICE_PRICES_CLP.optimizationFrom,
    priceMode: "from",
    subtitle: "Mejoras concretas sobre un sitio existente",
    deliverables: [
      "Intervención acotada según auditoría o revisión",
      "Imágenes, caché, metadatos y ajustes definidos",
      "Comparación antes y después cuando corresponda",
      "No incluye rediseño integral ni SEO mensual",
    ],
  },
  {
    name: "Mantención web",
    price: WEB_SERVICE_PRICES_CLP.maintenanceMonthlyFrom,
    priceMode: "from",
    frequency: "month",
    subtitle: "Acompañamiento técnico continuo",
    deliverables: [
      "Actualizaciones y controles definidos en contrato",
      "Soporte según horas y tiempos de respuesta acordados",
      "Revisión de respaldo y mantenimiento según plataforma",
      "Hosting, licencias y nuevos desarrollos por separado",
    ],
  },
];

function OfferGrid({ offers }: { offers: readonly Offer[] }) {
  return (
    <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {offers.map((offer) => (
        <article key={offer.name} className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.45)]">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-slate-950">{offer.name}</h3>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-slate-600">{offer.subtitle}</p>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-cyan-700">
              {offer.priceMode === "from" ? "Desde" : "Inversión"}
            </p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              {formatWebServicePriceCLP(offer.price)}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-600">
              + IVA {offer.frequency === "month" ? "· mensual" : "· pago por proyecto"}
            </p>
          </div>
          <ul className="mt-6 flex-1 space-y-3">
            {offer.deliverables.map((deliverable) => (
              <li key={deliverable} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-700">
                <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
                <span>{deliverable}</span>
              </li>
            ))}
          </ul>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
          >
            Solicitar cotización
          </a>
        </article>
      ))}
    </div>
  );
}

export function WebPortfolioSection() {
  return (
    <>
      <section id="planes-web" className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-800">CITAYA Web</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Páginas web y soluciones digitales con alcance claro
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
            Desde una página de presentación hasta un sistema personalizado. Todos los valores están
            expresados en pesos chilenos, más IVA; el presupuesto definitivo depende del alcance acordado.
          </p>
          <OfferGrid offers={websites} />
        </div>
      </section>
      <section id="optimizacion-web" className="bg-white px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-800">CITAYA Optimiza</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Mejora la página que ya tienes
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
            Una auditoría identifica problemas; la optimización ejecuta correcciones; la mantención
            acompaña la operación. Son servicios distintos.
          </p>
          <OfferGrid offers={improvements} />
          <div className="mt-9 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
            <strong className="text-slate-900">Condiciones comerciales:</strong> dominio, hosting,
            renovaciones, plugins, correo, licencias, soporte adicional y contenidos no están incluidos
            salvo que la propuesta lo indique expresamente. CITAYA Agendas, inteligencia artificial y
            Video Studio se contratan por separado. Ningún servicio garantiza resultados de ventas o
            una posición específica en buscadores.
          </div>
          <p className="mt-6 text-sm text-slate-600">
            ¿Necesitas reservas online?{" "}
            <Link href="/planes" className="font-semibold text-cyan-800 underline decoration-cyan-300 underline-offset-4 hover:text-cyan-700">
              Revisa CITAYA Agendas y sus planes.
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
