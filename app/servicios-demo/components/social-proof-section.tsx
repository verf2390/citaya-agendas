import { RevealOnScroll } from "./reveal-on-scroll";
import { SectionHeading } from "./section-heading";

const businessTypes = [
  "Barberías",
  "Estéticas / uñas / pestañas",
  "Psicólogos / kinesiólogos",
  "Centros de atención por hora",
  "Profesionales independientes",
] as const;

export function SocialProofSection() {
  return (
    <section className="bg-slate-50/60 px-4 py-14 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll>
          <SectionHeading
            eyebrow="Para quién es"
            title="Hecho para negocios locales que viven de sus reservas"
            description="Si atiendes por hora, esta forma de agendar te ahorra tiempo y evita perder clientes."
          />
        </RevealOnScroll>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {businessTypes.map((item, index) => (
            <RevealOnScroll key={item} delayMs={index * 70} className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-800 shadow-md">
              {item}
            </RevealOnScroll>
          ))}
        </div>

        <RevealOnScroll className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-rose-100 bg-rose-50/70 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">Antes</p>
            <p className="mt-2 text-base font-semibold text-rose-900">Todo se coordina por chat</p>
          </article>
          <article className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Después</p>
            <p className="mt-2 text-base font-semibold text-emerald-900">
              El cliente reserva solo y tú recibes la solicitud ordenada
            </p>
          </article>
        </RevealOnScroll>
      </div>
    </section>
  );
}
