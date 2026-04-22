import { FinalCtaSection } from "../components/final-cta-section";
import { LeadCaptureSection } from "../components/lead-capture-section";
import { RevealOnScroll } from "../components/reveal-on-scroll";

export default function ServiciosDemoContactoPage() {
  return (
    <main>
      <section className="px-4 pb-6 pt-10 sm:px-6 sm:pt-12 lg:px-10">
        <RevealOnScroll className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-6 shadow-[0_28px_75px_-45px_rgba(79,70,229,0.55)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Contacto</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Cuéntanos tu caso y te mostramos cómo implementarlo
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
            En esta página puedes dejar tus datos para recibir una propuesta guiada sin cambiar tu operación actual.
          </p>
        </RevealOnScroll>
      </section>

      <LeadCaptureSection />
      <FinalCtaSection />
    </main>
  );
}
