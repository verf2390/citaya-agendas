"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type CampaignType = "promo" | "vacation" | "discount" | "custom";
type Audience = "all" | "recurring" | "inactive" | "pending_payment";

const CAMPAIGN_TEMPLATES: Array<{
  id: CampaignType;
  title: string;
  text: string;
  subject: string;
  message: string;
}> = [
  {
    id: "promo",
    title: "Promoción",
    text: "Invita a reservar con una oferta o novedad de temporada.",
    subject: "Tenemos una promoción especial para ti",
    message:
      "Hola {{nombre}}, en {{negocio}} tenemos una promoción especial por tiempo limitado. Reserva tu hora aquí: {{link_reserva}}",
  },
  {
    id: "vacation",
    title: "Aviso de vacaciones",
    text: "Informa fechas de cierre y motiva reservas antes o después.",
    subject: "Agenda tus horas antes de nuestras vacaciones",
    message:
      "Hola {{nombre}}, te avisamos que {{negocio}} tendrá cambios de atención por vacaciones. Puedes reservar tu próxima hora aquí: {{link_reserva}}",
  },
  {
    id: "discount",
    title: "Descuento",
    text: "Activa reservas con un incentivo claro y directo.",
    subject: "Un descuento especial para tu próxima reserva",
    message:
      "Hola {{nombre}}, queremos verte nuevamente en {{negocio}}. Tenemos un descuento especial para tu próxima reserva: {{link_reserva}}",
  },
  {
    id: "custom",
    title: "Reactivación",
    text: "Recupera clientes que llevan tiempo sin agendar.",
    subject: "Te esperamos nuevamente",
    message:
      "Hola {{nombre}}, ha pasado un tiempo desde tu última visita a {{negocio}}. Agenda una nueva hora cuando quieras desde este link: {{link_reserva}}",
  },
];

const AUDIENCES: Array<{ id: Audience; title: string; text: string }> = [
  { id: "all", title: "Todos", text: "Toda la base de clientes disponible." },
  {
    id: "recurring",
    title: "Clientes recurrentes",
    text: "Clientes con historial suficiente para acciones de fidelización.",
  },
  {
    id: "inactive",
    title: "Clientes inactivos",
    text: "Clientes sin actividad reciente para campañas de reactivación.",
  },
  {
    id: "pending_payment",
    title: "Pago pendiente",
    text: "Clientes con abonos o pagos pendientes de seguimiento.",
  },
];

export default function AdminCampanasPage() {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [campaignType, setCampaignType] = useState<CampaignType>("promo");
  const [audience, setAudience] = useState<Audience>("all");
  const [subject, setSubject] = useState(CAMPAIGN_TEMPLATES[0].subject);
  const [message, setMessage] = useState(CAMPAIGN_TEMPLATES[0].message);
  const [imageUrl, setImageUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<{
    type: "success" | "setup" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        return;
      }

      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();

      if (error || !data?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        return;
      }

      setTenantSlug(data.slug);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/campanas")}`);
        return;
      }
      setAuthChecked(true);
    };

    void run();
  }, [router]);

  const selectedType = useMemo(
    () => CAMPAIGN_TEMPLATES.find((item) => item.id === campaignType),
    [campaignType],
  );
  const selectedAudience = useMemo(
    () => AUDIENCES.find((item) => item.id === audience),
    [audience],
  );

  const sendCampaign = async () => {
    if (sending) return;

    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (!cleanSubject || !cleanMessage) {
      const text = "Completa asunto y mensaje antes de preparar la campaña.";
      setSendState({ type: "error", text });
      toast({ title: "Datos incompletos", description: text, variant: "destructive" });
      return;
    }

    setSending(true);
    setSendState(null);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const res = await fetch("/api/admin/campaigns/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: campaignType,
          segment: audience,
          subject: cleanSubject,
          message: cleanMessage,
          tenantSlug,
        }),
      });

      const json = await res.json().catch(() => null);

      if (json?.placeholder) {
        const text = "Tu campaña quedó preparada. Activa el canal de envíos para publicarla.";
        setSendState({ type: "setup", text });
        toast({ title: "Campaña preparada", description: text });
        return;
      }

      if (!res.ok || !json?.ok) {
        const text = json?.error ?? "No se pudo preparar la campaña.";
        setSendState({ type: "error", text });
        toast({ title: "Error en campaña", description: text, variant: "destructive" });
        return;
      }

      const text = json.message ?? "Campaña enviada a automatización.";
      setSendState({ type: "success", text });
      toast({ title: "Campaña enviada", description: text });
    } catch (e: any) {
      const text = e?.message ?? "No se pudo conectar con el endpoint de campañas.";
      setSendState({ type: "error", text });
      toast({ title: "Error en campaña", description: text, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const selectTemplate = (id: CampaignType) => {
    const template = CAMPAIGN_TEMPLATES.find((item) => item.id === id);
    setCampaignType(id);
    setSendState(null);
    if (!template) return;
    setSubject(template.subject);
    setMessage(template.message);
  };

  const previewMessage = useMemo(() => {
    const businessName = tenantSlug || "Citaya";
    return (message || selectedType?.message || "")
      .replaceAll("{{nombre}}", "María")
      .replaceAll("{{link_reserva}}", "https://reserva.citaya.online")
      .replaceAll("{{negocio}}", businessName);
  }, [message, selectedType?.message, tenantSlug]);

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <AdminPageShell width="normal">
      <AdminNav />
      <AdminPageHeader
        eyebrow="CRM Pro"
        title="Campañas"
        description={`Crea campañas segmentadas para clientes de ${tenantSlug || "..."} con plantillas listas para vender.`}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard
          label="Estado"
          value={sendState?.type === "success" ? "Publicada" : "Preparada"}
          hint={sendState?.type === "success" ? "Campaña procesada" : "Lista para activar canal"}
        />
        <AdminKpiCard label="Audiencia" value={selectedAudience?.title ?? "Todos"} tone="blue" />
        <AdminKpiCard label="Plantilla" value={selectedType?.title ?? "Promoción"} tone="green" />
        <AdminKpiCard label="Canal" value="Email" tone="amber" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <AdminSectionCard
          title="Nueva campaña"
          description="Elige una plantilla, ajusta el mensaje y revisa la vista previa antes de enviar."
        >
          {!authChecked ? (
            <EmptyState title="Validando sesión" description="La campaña se habilitará cuando la sesión admin esté validada." />
          ) : (
            <div className="grid gap-5">
              <div>
                <div className="mb-2 text-sm font-black text-slate-800">Plantillas de campaña</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {CAMPAIGN_TEMPLATES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectTemplate(item.id)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        campaignType === item.id
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-black">{item.title}</div>
                      <div className={`mt-1 text-sm ${campaignType === item.id ? "text-slate-200" : "text-slate-500"}`}>
                        {item.text}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-black text-slate-800">Destinatarios</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {AUDIENCES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAudience(item.id)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        audience === item.id
                          ? "border-sky-700 bg-sky-50 text-sky-950"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-black">{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.text}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Asunto o título
                  <input
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      setSendState(null);
                    }}
                    className="rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                    placeholder="Ej: agenda abierta para mayo"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Mensaje
                  <textarea
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      setSendState(null);
                    }}
                    className="min-h-32 rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                    placeholder="Escribe el mensaje base de la futura campaña"
                  />
                  <span className="text-xs font-semibold text-slate-500">
                    Variables disponibles: {"{{nombre}}"} · {"{{link_reserva}}"} · {"{{negocio}}"}
                  </span>
                </label>
              </div>

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="text-sm font-black text-slate-800">Imagen de campaña</div>
                  <p className="mt-1 text-sm text-slate-500">
                    Usa una imagen para reforzar promociones, anuncios o temporadas especiales.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    Subir imagen
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setImageUrl(URL.createObjectURL(file));
                        setSendState(null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    URL de imagen
                    <input
                      value={imageUrl.startsWith("blob:") ? "" : imageUrl}
                      onChange={(e) => {
                        setImageUrl(e.target.value);
                        setSendState(null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium outline-none focus:border-slate-400"
                      placeholder="https://..."
                    />
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void sendCampaign()}
                  disabled={sending}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {sending ? "Preparando..." : "Enviar campaña"}
                </button>
                {sendState?.type === "success" ? (
                  <StatusBadge tone="green">Campaña procesada</StatusBadge>
                ) : (
                  <StatusBadge tone="amber">Lista para revisión</StatusBadge>
                )}
              </div>

              {sendState ? (
                <div
                  className={`rounded-2xl border p-3 text-sm font-bold ${
                    sendState.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : sendState.type === "setup"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {sendState.text}
                </div>
              ) : null}
            </div>
          )}
        </AdminSectionCard>

        <AdminSectionCard title="Preview en vivo">
          <div className="space-y-3 text-sm">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Imagen de campaña"
                  className="h-44 w-full object-cover"
                />
              ) : (
                <div className="grid h-36 place-items-center bg-slate-100 text-sm font-bold text-slate-400">
                  Imagen de campaña
                </div>
              )}
              <div className="p-4">
                <div className="text-xs font-black uppercase text-slate-500">Para María</div>
                <div className="mt-1 text-lg font-black text-slate-950">
                  {subject || selectedType?.subject}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {previewMessage || "Escribe un mensaje para ver la campaña."}
                </p>
                <button
                  type="button"
                  className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
                >
                  Reservar hora
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-500">Segmento</div>
              <div className="mt-1 font-black text-slate-950">{selectedAudience?.title}</div>
              <p className="mt-1 text-slate-500">{selectedAudience?.text}</p>
            </div>
          </div>
        </AdminSectionCard>
      </div>
    </AdminPageShell>
  );
}
