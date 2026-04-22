import Link from "next/link";
import { whatsappHref } from "./marketing-content";

type FinalCtaSectionProps = {
  showFaqTeaser?: boolean;
};

export function FinalCtaSection({ showFaqTeaser = false }: FinalCtaSectionProps) {
  return (
    <section className="bg-cyan-50/35 px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-10 lg:px-10 lg:pb-28">
      <div className="mx-auto max-w-6xl rounded-3xl border border-cyan-200 bg-gradient-to-br from-slate-900/5 via-white to-cyan-200/60 px-5 py-8 text-center shadow-[0_40px_100px_-48px_rgba(15,23,42,0.55)] sm:px-8 sm:py-10">
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
          Tu negocio puede verse profesional y vender con más orden
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          Te mostramos cómo se vería en tu caso, sin compromiso y con enfoque práctico.
        </p>

        <div className="mx-auto mt-7 grid w-full max-w-xl gap-3 sm:mt-8 sm:flex sm:justify-center sm:gap-4">
          <Link
            href="/contacto"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_30px_66px_-10px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-1.5 hover:from-cyan-600 hover:to-cyan-500 sm:w-auto"
          >
            Ir a contacto
          </Link>
          <Link
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-6 py-3 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 sm:w-auto"
          >
            Escribir por WhatsApp
          </Link>
        </div>

        {showFaqTeaser ? (
          <p className="mt-5 text-sm text-slate-600">
            ¿Aún tienes dudas?{" "}
            <Link href="/faq" className="font-semibold text-cyan-700 hover:text-cyan-800">
              Revisa preguntas frecuentes
            </Link>
            .
          </p>
        ) : null}
      </div>
    </section>
  );
}
