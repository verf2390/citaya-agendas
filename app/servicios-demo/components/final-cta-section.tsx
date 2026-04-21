import Link from "next/link";

const closingPoints = [
  "Más clientes atendidos con tiempos de respuesta claros",
  "Menos tiempo perdido en coordinación manual",
  "Un flujo digital que ordena ventas y operación",
] as const;

const whatsappMessage = encodeURIComponent(
  "Hola, vi esta demo y me gustaría cotizar una web o automatización para mi negocio.",
);

const emailSubject = encodeURIComponent("Consulta sobre web y automatización");
const emailBody = encodeURIComponent(
  "Hola, vi la demo y me gustaría recibir más información sobre una solución para mi negocio.",
);

const contactButtons = [
  {
    label: "WhatsApp",
    helper: "+56 9 6142 5029",
    href: `https://wa.me/56961425029?text=${whatsappMessage}`,
    tone: "bg-emerald-400 text-emerald-950 hover:bg-emerald-300",
    icon: "WA",
  },
  {
    label: "Síguenos en Instagram",
    helper: "@citaya_agenda",
    href: "https://www.instagram.com/citaya_agenda",
    tone: "bg-fuchsia-500/90 text-white hover:bg-fuchsia-400",
    icon: "IG",
  },
  {
    label: "Enviar correo",
    helper: "verf14@gmail.com",
    href: `mailto:verf14@gmail.com?subject=${emailSubject}&body=${emailBody}`,
    tone: "border border-cyan-200/50 bg-white/10 text-cyan-50 hover:bg-white/20",
    icon: "@",
  },
] as const;

export function FinalCtaSection() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
      <div className="mx-auto max-w-5xl rounded-3xl bg-[linear-gradient(145deg,#0f172a,#0c4a6e)] px-6 py-9 text-white shadow-[0_30px_80px_-45px_rgba(2,132,199,0.7)] sm:px-10 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Cierre comercial</p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          Después del formulario viene lo importante: convertir y operar mejor
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50 sm:text-base">
          Esta demo muestra una web que trabaja como sistema: capta leads, confirma en automático y entrega continuidad
          comercial para que tu empresa venda más con una operación más ordenada.
        </p>

        <ul className="mt-5 space-y-2">
          {closingPoints.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm text-cyan-50">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300" />
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div className="mt-7 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap">
          <Link
            href={`https://wa.me/56961425029?text=${whatsappMessage}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_30px_66px_-10px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-2 hover:scale-[1.015] hover:from-cyan-600 hover:to-cyan-500 hover:shadow-[0_46px_92px_-12px_rgba(8,145,178,1)]"
          >
            Quiero implementarlo en mi negocio
          </Link>
          <Link
            href="#solicitar-demo"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-cyan-200/40 bg-white/10 px-6 py-3 text-sm font-medium text-cyan-50 transition-all duration-200 hover:border-cyan-100/60 hover:bg-white/20"
          >
            Solicitar demo guiada
          </Link>
        </div>

        <div className="mt-8 border-t border-white/20 pt-6 sm:mt-10 sm:pt-8">
          <p className="text-sm font-medium text-cyan-100 sm:text-base">
            ¿Te gustaría una solución así para tu negocio? Hablemos sobre tu web, automatización o captación de
            clientes.
          </p>

          <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2 lg:grid-cols-3">
            {contactButtons.map((button) => (
              <Link
                key={button.label}
                href={button.href}
                target="_blank"
                rel="noreferrer"
                className={`group inline-flex min-h-14 items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-2 hover:scale-[1.015] ${button.tone}`}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/15 text-xs font-bold tracking-wide">
                  {button.icon}
                </span>
                <span className="flex flex-col leading-tight">
                  <span>{button.label}</span>
                  <span className="mt-1 text-xs font-medium opacity-90">{button.helper}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
