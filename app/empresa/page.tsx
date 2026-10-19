import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "../(marketing)/components/home/marketing-header";
import { WhatsAppFloatingButton } from "../(marketing)/components/home/whatsapp-floating-button";
import { whatsappHref } from "../(marketing)/components/home/marketing-content";

export const metadata: Metadata = {
  title: "Empresa y soluciones | CITAYA",
  description:
    "Conoce CITAYA, un proyecto tecnológico desarrollado por R&G SpA: sitios web, agenda online, automatizaciones e integraciones para negocios.",
};

const capabilities = [
  {
    title: "Desarrollo web",
    description:
      "Sitios comerciales adaptables a dispositivos móviles, con formularios y canales de contacto según el alcance acordado.",
  },
  {
    title: "CITAYA Agendas",
    description:
      "Sistema de reservas online para gestionar servicios, horarios y solicitudes desde un panel.",
  },
  {
    title: "Automatizaciones e integraciones",
    description:
      "Flujos y conexiones entre herramientas que se evalúan técnicamente antes de cotizar e implementar.",
  },
  {
    title: "Soluciones con inteligencia artificial",
    description:
      "Aplicaciones y asistentes a medida, con alcance, fuentes de datos y controles definidos para cada proyecto.",
  },
] as const;

const workSteps = [
  "Conocemos la necesidad y definimos qué problema se quiere resolver.",
  "Presentamos una propuesta con alcance, precio, plazos y condiciones.",
  "Implementamos y revisamos los entregables acordados.",
  "Definimos el soporte y mantenimiento que correspondan al servicio contratado.",
] as const;

export default function EmpresaPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />

      <section className="bg-slate-950 px-4 pb-16 pt-14 text-white sm:px-6 sm:pb-20 sm:pt-16 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Empresa y soluciones
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Tecnología aplicada a las necesidades de cada negocio.
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-slate-300 sm:text-lg">
            CITAYA es un proyecto tecnológico desarrollado y operado por R&amp;G SpA.
            Creamos herramientas para negocios que necesitan organizar su atención,
            mejorar su presencia digital y simplificar procesos.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/demos"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Ver demostraciones
            </Link>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-500 px-5 py-3 text-sm font-semibold text-white transition hover:border-cyan-300"
            >
              Solicitar una reunión comercial
            </a>
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 sm:py-18 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Qué podemos implementar
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Cada servicio se configura o desarrolla según las necesidades reales del cliente.
            No todas las integraciones ni funciones avanzadas están incluidas por defecto.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {capabilities.map((capability) => (
              <article key={capability.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
                  {capability.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-14 sm:px-6 sm:py-18 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Cómo trabajamos
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Atendemos proyectos de forma remota y evaluamos necesidades de negocios de
              La Serena, Coquimbo y otras regiones de Chile.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Las implementaciones, asesorías y capacitaciones especializadas se
              acuerdan mediante cotización. Las condiciones se informan antes de comenzar.
            </p>
          </div>
          <ol className="space-y-4">
            {workSteps.map((step, index) => (
              <li key={step} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-sm font-bold text-cyan-800">
                  {index + 1}
                </span>
                <p className="self-center text-sm leading-relaxed text-slate-700 sm:text-base">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 sm:py-18 lg:px-10">
        <div className="mx-auto max-w-6xl rounded-3xl bg-slate-950 p-7 text-white sm:p-10">
          <h2 className="text-2xl font-semibold sm:text-3xl">Conversemos sobre tu proyecto</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
            Podemos revisar una necesidad concreta, mostrar los ejemplos disponibles
            y preparar una propuesta comercial con el alcance y costo correspondiente.
            Las demostraciones no representan resultados medidos de clientes.
          </p>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Consultar por WhatsApp
          </a>
        </div>
      </section>

      <WhatsAppFloatingButton />
    </main>
  );
}
