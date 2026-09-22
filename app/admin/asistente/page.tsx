"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle, Send, ShieldCheck, Sparkles, User } from "lucide-react";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { adminFetch } from "@/lib/api/adminFetch";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolsUsed?: string[];
};

type AssistantResponse = {
  ok?: boolean;
  answer?: string;
  error?: string;
  toolsUsed?: string[];
};

const EXAMPLE_QUESTIONS = [
  "¿Cuántas reservas tengo mañana?",
  "Muéstrame clientes que llevan más de 60 días sin venir.",
  "¿Cuánto tengo pendiente por cobrar?",
  "Redáctame un mensaje para recuperar clientes inactivos.",
] as const;

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Hola. Puedo consultar reservas, clientes inactivos y cobros pendientes, además de ayudarte a analizar o redactar mensajes. No enviaré ni modificaré nada sin tu revisión.",
};

function nextMessageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export default function AdminAssistantPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const submitMessage = async (message: string) => {
    const value = message.trim();
    if (!value || sending || value.length > 2_000) return;

    const userMessage: ChatMessage = {
      id: nextMessageId(),
      role: "user",
      text: value,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError("");
    setSending(true);

    try {
      const response = await adminFetch("/api/admin/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: value,
          history: messages
            .filter((item) => item.id !== INITIAL_MESSAGE.id)
            .slice(-6)
            .map(({ role, text }) => ({ role, text })),
        }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | AssistantResponse
        | null;

      if (response.status === 401) {
        router.push(
          `/login?redirectTo=${encodeURIComponent("/admin/asistente")}`,
        );
        return;
      }
      if (!response.ok || !payload?.ok || !payload.answer) {
        throw new Error(
          payload?.error || "No se pudo completar la consulta de IA.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: "assistant",
          text: payload.answer ?? "",
          toolsUsed: payload.toolsUsed ?? [],
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo completar la consulta de IA.",
      );
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage(draft);
  };

  return (
    <AdminPageShell width="wide">
      <AdminNav />

      <div className="space-y-5">
        <AdminPageHeader
          eyebrow="Citaya AI · lectura segura"
          title="Asistente IA"
          description="Consulta información de tu negocio, analiza resultados y prepara borradores sin ejecutar acciones automáticamente."
          actions={<StatusBadge tone="green">Solo lectura</StatusBadge>}
        />

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <AdminSectionCard
            title="Conversación"
            description="El contexto visible se usa en la consulta actual y no se guarda en la auditoría."
            className="min-h-[34rem]"
          >
            <div
              className="flex min-h-[24rem] flex-col gap-3"
              aria-live="polite"
              aria-busy={sending}
            >
              {messages.map((message) => {
                const isAssistant = message.role === "assistant";
                const Icon = isAssistant ? Bot : User;
                return (
                  <article
                    key={message.id}
                    className={`flex items-start gap-3 ${
                      isAssistant ? "" : "flex-row-reverse"
                    }`}
                  >
                    <div
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${
                        isAssistant
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-slate-800 bg-slate-900 text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div
                      className={`max-w-[88%] rounded-2xl border p-3 text-sm font-medium leading-6 shadow-sm ${
                        isAssistant
                          ? "border-slate-200 bg-slate-50 text-slate-800"
                          : "border-slate-900 bg-slate-900 text-white"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {message.text}
                      </div>
                      {message.toolsUsed?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
                          {message.toolsUsed.map((tool) => (
                            <StatusBadge key={tool} tone="blue">
                              {tool}
                            </StatusBadge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}

              {sending ? (
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Consultando datos autorizados…
                </div>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-4 border-t border-slate-100 pt-4">
              <label htmlFor="ai-message" className="sr-only">
                Escribe tu consulta para el asistente IA
              </label>
              <textarea
                id="ai-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2_000}
                rows={3}
                disabled={sending}
                placeholder="Ejemplo: ¿Cuántas reservas tengo mañana?"
                className="w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
              />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-medium text-slate-500">
                  {draft.length}/2000 · No incluyas contraseñas ni secretos.
                </div>
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  Consultar
                </button>
              </div>
            </form>
          </AdminSectionCard>

          <div className="grid content-start gap-4">
            <AdminSectionCard
              title="Preguntas rápidas"
              description="Prueba una consulta segura del negocio."
            >
              <div className="grid gap-2">
                {EXAMPLE_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={sending}
                    onClick={() => void submitMessage(question)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </AdminSectionCard>

            <AdminSectionCard title="Controles activos">
              <div className="grid gap-3 text-sm font-medium text-slate-600">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>Solo consulta el tenant autenticado en este subdominio.</span>
                </div>
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                  <span>Puede analizar y redactar; no envía, cobra ni modifica reservas.</span>
                </div>
              </div>
            </AdminSectionCard>
          </div>
        </div>
      </div>
    </AdminPageShell>
  );
}
