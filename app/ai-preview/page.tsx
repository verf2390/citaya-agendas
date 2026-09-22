"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  Cloud,
  Cpu,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  WalletCards,
} from "lucide-react";

type DemoMessage = {
  role: "user" | "assistant";
  text: string;
  meta?: string;
};

const QUICK = [
  "¿Cuántas reservas tengo mañana?",
  "Muéstrame clientes que llevan más de 60 días sin venir.",
  "¿Cuánto tengo pendiente por cobrar?",
  "Redáctame un mensaje para recuperar clientes inactivos.",
] as const;

function demoAnswer(question: string): DemoMessage {
  const q = question.toLowerCase();

  if (q.includes("mañana") || q.includes("reserva")) {
    return {
      role: "assistant",
      text:
        "Mañana tienes 8 reservas activas.\n\n• 5 confirmadas\n• 2 pendientes de confirmación\n• 1 con saldo pendiente\n\nLa franja más ocupada es entre 16:00 y 19:00.",
      meta: "Tool: count_appointments · proveedor: local · 1,2 s",
    };
  }

  if (q.includes("60") || q.includes("inactivo") || q.includes("volver")) {
    return {
      role: "assistant",
      text:
        "Encontré 14 clientes que llevan más de 60 días sin una visita efectiva.\n\nLos 5 con mayor antigüedad llevan entre 104 y 163 días sin volver. Puedo prepararte un mensaje de recuperación para ese grupo.",
      meta: "Tool: list_inactive_customers · proveedor: local · 1,8 s",
    };
  }

  if (q.includes("cobrar") || q.includes("deben") || q.includes("pendiente")) {
    return {
      role: "assistant",
      text:
        "Tienes $128.000 CLP pendientes de cobro distribuidos en 6 reservas.\n\nLa mayor deuda individual es de $35.000 CLP. No estoy contando reservas canceladas ni vencidas.",
      meta: "Tool: get_pending_receivables · proveedor: local · 1,5 s",
    };
  }

  return {
    role: "assistant",
    text:
      "Claro. Te propongo este borrador:\n\n“Hola 👋 Hace un tiempo que no te vemos. Si quieres retomar tu atención, puedes revisar horarios disponibles y reservar directamente desde nuestro enlace. Si necesitas ayuda, escríbenos por aquí.”\n\nNo enviaré nada hasta que tú lo apruebes.",
    meta: "Sin acción automática · borrador generado",
  };
}

export default function CitayaAIPreviewPage() {
  const [messages, setMessages] = useState<DemoMessage[]>([
    {
      role: "assistant",
      text:
        "Hola 👋 Soy el asistente de Citaya. Puedo consultar tu agenda, detectar clientes inactivos, revisar saldos pendientes y ayudarte a redactar mensajes. En esta demo no modifico ni envío nada.",
      meta: "Demo visual · datos ficticios",
    },
  ]);
  const [draft, setDraft] = useState("");

  const usage = useMemo(
    () => ({
      requests: 124,
      local: 97,
      cloud: 27,
      fallback: 6,
      avg: "1,9 s",
      cloudTokens: "18.420",
    }),
    [],
  );

  const submit = (value: string) => {
    const text = value.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { role: "user", text },
      demoAnswer(text),
    ]);
    setDraft("");
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-6 shadow-2xl sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                <Sparkles className="h-4 w-4" />
                Citaya AI · Demo visual
              </div>
              <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
                Un asistente conectado a tu negocio, no un chatbot genérico.
              </h1>
              <p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-slate-300 sm:text-base">
                Esta vista usa datos ficticios. No consulta Supabase, no llama a
                OpenAI y no toca servidores reales. Sirve para probar cómo se
                vería y se sentiría Citaya AI dentro del panel.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
              Solo lectura
            </div>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl sm:p-5">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <div className="text-lg font-black">Asistente IA</div>
                <div className="text-xs font-medium text-slate-400">
                  Contexto del negocio + tools autorizadas
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-black text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Disponible
              </div>
            </div>

            <div className="min-h-[28rem] space-y-4 rounded-2xl bg-slate-950/50 p-3 sm:p-4">
              {messages.map((message, index) => {
                const ai = message.role === "assistant";
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 ${ai ? "" : "flex-row-reverse"}`}
                  >
                    <div
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${
                        ai
                          ? "border-blue-400/30 bg-blue-400/10 text-blue-300"
                          : "border-white/10 bg-white/10 text-white"
                      }`}
                    >
                      {ai ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </div>
                    <div
                      className={`max-w-[88%] rounded-2xl border p-3 text-sm leading-6 ${
                        ai
                          ? "border-white/10 bg-white/[0.05] text-slate-200"
                          : "border-blue-400/20 bg-blue-500 text-white"
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{message.text}</div>
                      {message.meta ? (
                        <div className="mt-3 border-t border-white/10 pt-2 text-[11px] font-bold text-slate-400">
                          {message.meta}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {QUICK.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => submit(question)}
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left text-xs font-bold text-slate-300 transition hover:border-blue-400/40 hover:bg-blue-400/10 hover:text-white"
                >
                  {question}
                </button>
              ))}
            </div>

            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit(draft);
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Pregunta algo sobre tu negocio…"
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 text-sm font-medium text-white outline-none placeholder:text-slate-500 focus:border-blue-400/50"
              />
              <button
                type="submit"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-500 px-4 text-sm font-black text-white transition hover:bg-blue-400"
              >
                <Send className="h-4 w-4" />
                Consultar
              </button>
            </form>
          </div>

          <aside className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 text-sm font-black">Uso IA · 7 días</div>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Solicitudes" value={String(usage.requests)} />
                <Metric label="Latencia prom." value={usage.avg} />
              </div>

              <div className="mt-3 space-y-2">
                <UsageRow icon={<Cpu className="h-4 w-4" />} label="Local" value={usage.local} />
                <UsageRow icon={<Cloud className="h-4 w-4" />} label="Cloud" value={usage.cloud} />
                <UsageRow label="Fallback" value={usage.fallback} />
                <UsageRow label="Tokens cloud" value={usage.cloudTokens} />
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 text-sm font-black">Lo que puede consultar</div>
              <div className="space-y-3 text-sm font-medium text-slate-300">
                <Feature icon={<CalendarDays className="h-4 w-4" />} text="Agenda y reservas" />
                <Feature icon={<User className="h-4 w-4" />} text="Clientes inactivos" />
                <Feature icon={<WalletCards className="h-4 w-4" />} text="Saldos pendientes" />
                <Feature icon={<Sparkles className="h-4 w-4" />} text="Análisis y redacción" />
              </div>
            </div>

            <div className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm leading-6 text-amber-100">
              <div className="font-black">Demo segura</div>
              <div className="mt-1 text-amber-100/80">
                Los números, clientes y respuestas de esta página son ficticios.
                No hay acciones de cobro, envío, cancelación ni reagendamiento.
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
    </div>
  );
}

function UsageRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
      <span className="flex items-center gap-2 text-xs font-bold text-slate-400">
        {icon}
        {label}
      </span>
      <span className="text-sm font-black text-white">{value}</span>
    </div>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
      <div className="text-blue-300">{icon}</div>
      <span>{text}</span>
    </div>
  );
}
