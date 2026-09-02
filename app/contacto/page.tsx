import Link from "next/link";
import { MarketingHeader } from "../(marketing)/components/home/marketing-header";
import { whatsappHref } from "../(marketing)/components/home/marketing-content";
import { WhatsAppFloatingButton } from "../(marketing)/components/home/whatsapp-floating-button";

export default function ContactoPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />

      <section className="bg-cyan-50/35 px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-12 lg:px-10 lg:pb-28">
        <div className="mx-auto max-w-5xl rounded-3xl border border-cyan-200 bg-white p-6 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.55)] sm:p-10">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Hablemos de tu negocio
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Te ayudamos a definir la mejor combinación de web, agenda online y automatizaciones para que tengas más
            orden y mejores conversiones.
          </p>

          <div className="mt-8 grid gap-4 sm:flex sm:flex-wrap">
            <Link
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_30px_66px_-10px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-1.5 hover:from-cyan-600 hover:to-cyan-500 sm:w-auto"
            >
              Contactar por WhatsApp
            </Link>
            <Link
              href="/demos"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 sm:w-auto"
            >
              Ver demos primero
            </Link>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <p className="text-sm leading-relaxed text-slate-700 sm:text-base">
              Trabajamos con negocios locales y de servicios que buscan una presencia digital más clara, premium y
              orientada a resultados reales.
            </p>
          </div>
        </div>
      </section>

      <WhatsAppFloatingButton />
    </main>
  );
}
