import Link from "next/link";
import { FinalCtaSection } from "../components/final-cta-section";
import { RevealOnScroll } from "../components/reveal-on-scroll";

const faqs = [
  {
    question: "¿Cuánto tarda en estar funcionando?",
    answer: "En pocos días puedes tener una versión activa con tus servicios, horarios y flujo de reservas automatizado.",
  },
  {
    question: "¿Necesito cambiar mi forma de trabajar?",
    answer: "No. Adaptamos el flujo a tu negocio para que sigas operando, pero con menos mensajes manuales.",
  },
  {
    question: "¿Mis clientes pueden reservar desde el celular?",
    answer: "Sí, la experiencia es mobile-first y está pensada para que la reserva sea rápida desde WhatsApp o enlace directo.",
  },
  {
    question: "¿Incluye confirmaciones automáticas?",
    answer: "Sí, cada solicitud puede confirmarse automáticamente por WhatsApp o email para que no pierdas oportunidades.",
  },
] as const;

export default function ServiciosDemoFaqPage() {
  return (
    <main>
      <section className="px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-12 lg:px-10 lg:pb-20">
        <div className="mx-auto max-w-6xl">
          <RevealOnScroll>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">FAQ</p>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Respuestas claras para decidir con confianza
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Aquí resolvemos las dudas más comunes antes de implementar tu experiencia de reservas.
            </p>
          </RevealOnScroll>

          <div className="mt-8 grid gap-4 sm:mt-10 md:grid-cols-2">
            {faqs.map((item, index) => (
              <RevealOnScroll
                key={item.question}
                delayMs={index * 70}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <h2 className="text-base font-semibold text-slate-900">{item.question}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.answer}</p>
              </RevealOnScroll>
            ))}
          </div>

          <RevealOnScroll className="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 sm:mt-10 sm:p-6">
            <p className="text-sm font-semibold text-indigo-900">¿Tienes otra pregunta?</p>
            <p className="mt-1 text-sm text-indigo-800">Te la resolvemos por WhatsApp y te mostramos una demo aplicada a tu negocio.</p>
            <Link
              href="/servicios-demo/contacto"
              className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02]"
            >
              Ir a contacto
            </Link>
          </RevealOnScroll>
        </div>
      </section>

      <FinalCtaSection />
    </main>
  );
}
