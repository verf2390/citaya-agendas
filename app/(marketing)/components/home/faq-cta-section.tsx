import Link from "next/link";

const faqs = [
  {
    question: "¿Esto sirve para mi tipo de negocio?",
    answer:
      "Sí, está pensado para negocios que trabajan por agenda: estéticas, barberías, salud y servicios.",
  },
  {
    question: "¿Necesito saber de tecnología?",
    answer: "No, todo está pensado para ser simple de usar.",
  },
  {
    question: "¿Puedo empezar básico?",
    answer: "Sí, puedes partir simple y luego escalar.",
  },
  {
    question: "¿Incluye agenda online?",
    answer: "Sí, según tu caso.",
  },
  {
    question: "¿Cuánto demora?",
    answer: "Se puede lanzar una versión funcional en poco tiempo.",
  },
  {
    question: "¿Incluye soporte?",
    answer: "Sí, se puede acompañar el proceso.",
  },
] as const;

const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

export function FaqCtaSection() {
  return (
    <section className="bg-cyan-50/35 px-4 pb-20 pt-10 sm:px-6 sm:pb-24 sm:pt-12 lg:px-10 lg:pb-28 lg:pt-14">
      <div className="mx-auto grid w-full max-w-6xl gap-12">
        <div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Preguntas frecuentes
          </h2>

          <div className="mt-6 space-y-3 sm:mt-8">
            {faqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-2xl border border-slate-300 bg-white p-4 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-1.5 hover:border-cyan-400 hover:shadow-[0_34px_76px_-32px_rgba(8,145,178,0.56)] sm:p-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left text-sm font-semibold text-slate-900 sm:text-base">
                  <span>{faq.question}</span>
                  <span
                    className="text-xl leading-none text-cyan-700 transition-transform duration-200 group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="pt-3 text-sm leading-relaxed text-slate-600 sm:text-base">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-cyan-200 bg-gradient-to-br from-slate-900/5 via-white to-cyan-200/60 px-5 py-8 text-center shadow-[0_40px_100px_-48px_rgba(15,23,42,0.55)] sm:px-8 sm:py-10">
          <h3 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
            Tu negocio puede verse profesional y vender con más orden
          </h3>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Te muestro cómo se vería esto en tu negocio (sin compromiso).
          </p>

          <div className="mx-auto mt-7 grid w-full max-w-xl gap-3 sm:mt-8 sm:flex sm:justify-center sm:gap-4">
            <Link
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_26px_56px_-12px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-1.5 hover:from-cyan-600 hover:to-cyan-500 hover:shadow-[0_38px_78px_-15px_rgba(8,145,178,0.98)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 active:translate-y-0 active:from-cyan-800 active:to-cyan-700 sm:w-auto"
            >
              Muéstrame cómo funcionaría
            </Link>
            <a
              href="#demos"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-6 py-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 active:translate-y-0 sm:w-auto"
            >
              Ver demos
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
