"use client";

import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, RefreshCw, Send, Upload, Video, X } from "lucide-react";
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

type TemplateKey =
  | "promo"
  | "discount"
  | "reactivation"
  | "vacation"
  | "reminder"
  | "pending_payment";
type SegmentKey =
  | "all"
  | "recurring"
  | "inactive"
  | "pending_payment"
  | "upcoming";
type CampaignMediaType = "none" | "image" | "gif" | "video";

const CAMPAIGN_TEMPLATES: Array<{
  id: TemplateKey;
  title: string;
  text: string;
  subject: string;
  headline: string;
  message: string;
  ctaLabel: string;
}> = [
  {
    id: "promo",
    title: "Promoción",
    text: "Invita a reservar con una oferta o novedad de temporada.",
    subject: "Tenemos una promoción especial para ti",
    headline: "Tenemos una promoción especial para ti",
    message:
      "Hola {{customerName}}, en {{businessName}} tenemos una promoción especial por tiempo limitado. Reserva tu hora aquí.",
    ctaLabel: "Reservar hora",
  },
  {
    id: "discount",
    title: "Descuento",
    text: "Activa reservas con un beneficio claro y fácil de entender.",
    subject: "Un beneficio especial para tu próxima reserva",
    headline: "Un descuento pensado para ti",
    message:
      "Hola {{customerName}}, queremos invitarte a reservar nuevamente con un beneficio especial disponible por pocos días.",
    ctaLabel: "Reservar con beneficio",
  },
  {
    id: "reactivation",
    title: "Reactivación",
    text: "Recupera clientes que llevan tiempo sin agendar.",
    subject: "Te esperamos nuevamente en {{businessName}}",
    headline: "Hace tiempo que no te vemos",
    message:
      "Hola {{customerName}}, queremos invitarte a volver a reservar tu próxima hora de forma rápida y sencilla.",
    ctaLabel: "Agendar nuevamente",
  },
  {
    id: "vacation",
    title: "Aviso de vacaciones",
    text: "Informa cambios de horario y motiva reservas anticipadas.",
    subject: "Información importante sobre nuestros horarios",
    headline: "Aviso importante",
    message:
      "Hola {{customerName}}, te contamos que tendremos cambios en nuestros horarios. Te recomendamos reservar con anticipación.",
    ctaLabel: "Ver disponibilidad",
  },
  {
    id: "reminder",
    title: "Recordatorio",
    text: "Invita a clientes activos a reservar su próxima visita.",
    subject: "Recuerda reservar tu próxima hora",
    headline: "Agenda tu próxima visita",
    message:
      "Hola {{customerName}}, puedes reservar tu próxima hora online en pocos segundos.",
    ctaLabel: "Reservar hora",
  },
  {
    id: "pending_payment",
    title: "Pago pendiente",
    text: "Recuerda pagos pendientes de forma clara y directa.",
    subject: "Tienes un pago pendiente",
    headline: "Completa tu pago para asegurar tu reserva",
    message:
      "Hola {{customerName}}, tienes un pago pendiente asociado a tu reserva. Puedes completarlo de forma segura desde el siguiente botón.",
    ctaLabel: "Pagar ahora",
  },
];

const SEGMENTS: Array<{ id: SegmentKey; title: string; text: string }> = [
  { id: "all", title: "Todos", text: "Clientes con email disponible." },
  {
    id: "recurring",
    title: "Clientes recurrentes",
    text: "Personas que ya han reservado más de una vez.",
  },
  {
    id: "inactive",
    title: "Clientes inactivos",
    text: "Clientes que no han vuelto en las últimas semanas.",
  },
  {
    id: "pending_payment",
    title: "Pago pendiente",
    text: "Clientes con pagos por completar.",
  },
  {
    id: "upcoming",
    title: "Próximas citas",
    text: "Clientes con reservas confirmadas por venir.",
  },
];

type TenantInfo = {
  id: string;
  slug: string;
  name?: string | null;
  logo_url?: string | null;
  phone_display?: string | null;
  whatsapp?: string | null;
  admin_email?: string | null;
};

type SendResult = {
  campaignId?: string;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  message: string;
};

const MEDIA_TYPES: Array<{ id: CampaignMediaType; title: string; text: string }> = [
  { id: "none", title: "Sin imagen", text: "Envía solo texto y botón." },
  { id: "image", title: "Imagen / banner", text: "JPG, PNG o WebP para promociones." },
  { id: "gif", title: "GIF animado", text: "Animación liviana compatible con email." },
  { id: "video", title: "Video", text: "Se enviará como enlace compatible." },
];

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GIF_MIME_TYPES = new Set(["image/gif"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function mediaTypeFromMime(mimeType: string): CampaignMediaType | null {
  if (IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (GIF_MIME_TYPES.has(mimeType)) return "gif";
  if (VIDEO_MIME_TYPES.has(mimeType)) return "video";
  return null;
}

function formatFileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function whatsappUrlFromPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "";
  const normalized = digits.startsWith("56")
    ? digits
    : digits.startsWith("9") && digits.length === 9
      ? `56${digits}`
      : digits;
  return normalized.length >= 8 ? `https://wa.me/${normalized}` : "";
}

function isLikelyChileanMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  return (
    (digits.startsWith("569") && digits.length >= 11) ||
    (digits.startsWith("56") && digits.length >= 11) ||
    (digits.startsWith("9") && digits.length === 9)
  );
}

function fallbackBookingUrl(slug: string) {
  return slug ? `https://${slug}.citaya.online/reservar` : "https://citaya.online/reservar";
}

function replaceTemplateVariables(
  value: string,
  vars: Record<string, string>,
) {
  return Object.entries(vars).reduce(
    (acc, [key, replacement]) => acc.replaceAll(`{{${key}}}`, replacement),
    value,
  );
}

function isPendingPaymentCampaign(templateKey: TemplateKey, segmentKey: SegmentKey) {
  return templateKey === "pending_payment" || segmentKey === "pending_payment";
}

export default function AdminCampanasPage() {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("promo");
  const [segmentKey, setSegmentKey] = useState<SegmentKey>("all");
  const [subject, setSubject] = useState(CAMPAIGN_TEMPLATES[0].subject);
  const [headline, setHeadline] = useState(CAMPAIGN_TEMPLATES[0].headline);
  const [message, setMessage] = useState(CAMPAIGN_TEMPLATES[0].message);
  const [ctaLabel, setCtaLabel] = useState(CAMPAIGN_TEMPLATES[0].ctaLabel);
  const [ctaUrl, setCtaUrl] = useState("");
  const [mediaType, setMediaType] = useState<CampaignMediaType>("none");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFileName, setMediaFileName] = useState("");
  const [mediaMimeType, setMediaMimeType] = useState("");
  const [mediaSize, setMediaSize] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<{
    type: "success" | "setup" | "error";
    text: string;
  } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        return;
      }

      const withWhatsapp = await supabase
        .from("tenants")
        .select("id, slug, name, logo_url, phone_display, whatsapp, admin_email")
        .eq("slug", slug)
        .maybeSingle();

      const tenantRes =
        !withWhatsapp.error && withWhatsapp.data?.id
          ? withWhatsapp
          : await supabase
              .from("tenants")
              .select("id, slug, name, logo_url, phone_display, admin_email")
              .eq("slug", slug)
              .maybeSingle();

      if (tenantRes.error || !tenantRes.data?.id) {
        setTenantError(tenantRes.error?.message ?? `No existe tenant para ${slug}`);
        return;
      }

      const tenant = tenantRes.data as TenantInfo;
      setTenantInfo(tenant);
      setTenantSlug(tenant.slug);
      setCtaUrl(fallbackBookingUrl(tenant.slug));

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
    () => CAMPAIGN_TEMPLATES.find((item) => item.id === templateKey),
    [templateKey],
  );
  const selectedAudience = useMemo(
    () => SEGMENTS.find((item) => item.id === segmentKey),
    [segmentKey],
  );
  const pendingPaymentCampaign = isPendingPaymentCampaign(templateKey, segmentKey);

  const statusLabel = sending
    ? "Enviando"
    : sendState?.type === "success"
      ? "Enviada"
      : "Preparada";

  const isSendDisabled =
    sending ||
    !authChecked ||
    !subject.trim() ||
    !message.trim() ||
    !ctaLabel.trim() ||
    (!pendingPaymentCampaign && !ctaUrl.trim()) ||
    !confirmed;

  const effectiveMediaUrl = mediaType === "none" ? "" : mediaUrl.trim();
  const selectedMediaType = useMemo(
    () => MEDIA_TYPES.find((item) => item.id === mediaType),
    [mediaType],
  );

  const resetMedia = () => {
    setMediaUrl("");
    setMediaFileName("");
    setMediaMimeType("");
    setMediaSize(0);
  };

  const changeMediaType = (nextType: CampaignMediaType) => {
    setMediaType(nextType);
    resetMedia();
    setSendState(null);
    setResult(null);
    setConfirmed(false);
  };

  const uploadCampaignMedia = async (file: File | null) => {
    if (!file || uploadingMedia) return;

    const detectedType = mediaTypeFromMime(file.type);
    if (!detectedType) {
      toast({
        title: "Formato no permitido",
        description: "Usa JPG, PNG, WebP, GIF, MP4, MOV o WebM.",
        variant: "destructive",
      });
      return;
    }

    if (mediaType !== "none" && mediaType !== detectedType) {
      toast({
        title: "Tipo de contenido distinto",
        description: "Selecciona el tipo correcto antes de subir el archivo.",
        variant: "destructive",
      });
      return;
    }

    const maxSize = detectedType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxSize) {
      toast({
        title: "El archivo supera el tamaño permitido",
        description:
          detectedType === "video"
            ? "Los videos pueden pesar hasta 25 MB."
            : "Las imagenes y GIF pueden pesar hasta 5 MB.",
        variant: "destructive",
      });
      return;
    }

    setUploadingMedia(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Inicia sesión nuevamente para subir el archivo.");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("tenantSlug", tenantSlug);

      const res = await fetch("/api/admin/campaigns/upload-media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "No se pudo subir el archivo");
      }

      setMediaType(json.mediaType as CampaignMediaType);
      setMediaUrl(String(json.mediaUrl ?? ""));
      setMediaFileName(String(json.fileName ?? file.name));
      setMediaMimeType(String(json.mimeType ?? file.type));
      setMediaSize(Number(json.size ?? file.size));
      setSendState(null);
      setResult(null);
      setConfirmed(false);
      toast({ title: "Imagen cargada correctamente", description: "El contenido visual quedó listo para la campaña." });
    } catch (e: any) {
      toast({
        title: "No se pudo subir el archivo",
        description: e?.message ?? "Intenta nuevamente en unos minutos.",
        variant: "destructive",
      });
    } finally {
      setUploadingMedia(false);
    }
  };

  const sendCampaign = async () => {
    if (sending) return;

    const cleanSubject = subject.trim();
    const cleanHeadline = headline.trim();
    const cleanMessage = message.trim();
    const cleanCtaLabel = pendingPaymentCampaign ? "Pagar ahora" : ctaLabel.trim();
    const cleanCtaUrl = pendingPaymentCampaign ? "" : ctaUrl.trim();
    const cleanMediaUrl = effectiveMediaUrl;
    if (!cleanSubject || !cleanMessage || !cleanCtaLabel || (!pendingPaymentCampaign && !cleanCtaUrl)) {
      const text = "Completa asunto, mensaje y botón antes de enviar la campaña.";
      setSendState({ type: "error", text });
      toast({ title: "Datos incompletos", description: text, variant: "destructive" });
      return;
    }

    if (cleanMediaUrl && !isValidHttpUrl(cleanMediaUrl)) {
      const text = "La URL del contenido visual debe comenzar con http:// o https://.";
      setSendState({ type: "error", text });
      toast({ title: "URL no válida", description: text, variant: "destructive" });
      return;
    }

    if (!confirmed) {
      const text = "Confirma el envío antes de continuar.";
      setSendState({ type: "error", text });
      toast({ title: "Confirmación requerida", description: text, variant: "destructive" });
      return;
    }

    setSending(true);
    setSendState(null);
    setResult(null);

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
          templateKey,
          segmentKey,
          subject: cleanSubject,
          headline: cleanHeadline,
          message: cleanMessage,
          ctaLabel: cleanCtaLabel,
          ctaUrl: cleanCtaUrl,
          tenantSlug,
          mediaType,
          mediaUrl: cleanMediaUrl,
          mediaFileName,
          mediaMimeType,
          mediaSize,
          campaignImageUrl:
            mediaType === "image" || mediaType === "gif" ? cleanMediaUrl : "",
          imageUrl: mediaType === "image" || mediaType === "gif" ? cleanMediaUrl : "",
          videoUrl: mediaType === "video" ? cleanMediaUrl : "",
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
      setResult({
        campaignId: json.campaignId,
        sentCount: Number(json.sentCount ?? 0),
        skippedCount: Number(json.skippedCount ?? 0),
        errorCount: Number(json.errorCount ?? 0),
        message: text,
      });
      setConfirmed(false);
      toast({
        title: "Campaña enviada",
        description: `${Number(json.sentCount ?? 0)} emails enviados.`,
      });
    } catch (e: any) {
      const text = e?.message ?? "No se pudo conectar con el endpoint de campañas.";
      setSendState({ type: "error", text });
      toast({ title: "Error en campaña", description: text, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const selectTemplate = (id: TemplateKey) => {
    const template = CAMPAIGN_TEMPLATES.find((item) => item.id === id);
    setTemplateKey(id);
    setSendState(null);
    setResult(null);
    setConfirmed(false);
    if (!template) return;
    setSubject(template.subject);
    setHeadline(template.headline);
    setMessage(template.message);
    setCtaLabel(template.ctaLabel);
    setCtaUrl(id === "pending_payment" ? "" : fallbackBookingUrl(tenantSlug));
  };

  const restoreTemplate = () => {
    if (!selectedType) return;
    setSubject(selectedType.subject);
    setHeadline(selectedType.headline);
    setMessage(selectedType.message);
    setCtaLabel(pendingPaymentCampaign ? "Pagar ahora" : selectedType.ctaLabel);
    setCtaUrl(pendingPaymentCampaign ? "" : fallbackBookingUrl(tenantSlug));
    setSendState(null);
    setResult(null);
    setConfirmed(false);
  };

  const previewVars = useMemo(
    () => ({
      customerName: "María",
      businessName: tenantInfo?.name?.trim() || tenantSlug || "Citaya",
      serviceName: "Servicio destacado",
      amount: "$25.000",
      appointmentDate: "15 de mayo",
      appointmentTime: "10:30",
    }),
    [tenantInfo?.name, tenantSlug],
  );

  const previewSubject = useMemo(
    () => replaceTemplateVariables(subject || selectedType?.subject || "", previewVars),
    [previewVars, selectedType?.subject, subject],
  );

  const previewHeadline = useMemo(
    () => replaceTemplateVariables(headline || selectedType?.headline || "", previewVars),
    [headline, previewVars, selectedType?.headline],
  );

  const previewMessage = useMemo(
    () => replaceTemplateVariables(message || selectedType?.message || "", previewVars),
    [message, previewVars, selectedType?.message],
  );

  const previewWhatsApp = tenantInfo?.whatsapp?.trim() || "";
  const previewPhone = tenantInfo?.phone_display?.trim() || "";
  const previewWhatsAppValue =
    previewWhatsApp || (previewPhone && isLikelyChileanMobile(previewPhone) ? previewPhone : "");
  const previewWhatsAppUrl = whatsappUrlFromPhone(previewWhatsAppValue);
  const previewContactEmail = tenantInfo?.admin_email?.trim() || "";
  const hasContactChannels = Boolean(previewWhatsAppUrl || previewContactEmail);

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <AdminPageShell width="wide">
      <AdminNav />
      <AdminPageHeader
        eyebrow="CRM Pro"
        title="Campañas"
        description="Envía promociones, recordatorios y mensajes segmentados a tus clientes."
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard
          label="Estado"
          value={statusLabel}
          hint={sending ? "Procesando destinatarios" : "Lista para revisar"}
        />
        <AdminKpiCard label="Audiencia" value={selectedAudience?.title ?? "Todos"} tone="blue" />
        <AdminKpiCard label="Plantilla" value={selectedType?.title ?? "Promoción"} tone="green" />
        <AdminKpiCard label="Canal" value="Email" tone="amber" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <AdminSectionCard
          title="Configuración"
          description="Elige una plantilla, selecciona la audiencia y revisa el mensaje antes de enviar."
        >
          {!authChecked ? (
            <EmptyState
              title="Validando sesión"
              description="La campaña se habilitará cuando la sesión admin esté validada."
            />
          ) : (
            <div className="grid gap-6">
              <div>
                <div className="mb-2 text-sm font-black text-slate-800">Plantillas de campaña</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {CAMPAIGN_TEMPLATES.map((item) => {
                    const active = templateKey === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectTemplate(item.id)}
                        className={`rounded-2xl border p-4 text-left shadow-sm transition ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="font-black">{item.title}</div>
                        <div className={`mt-1 text-sm ${active ? "text-slate-200" : "text-slate-500"}`}>
                          {item.text}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-black text-slate-800">Destinatarios</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {SEGMENTS.map((item) => {
                    const active = segmentKey === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSegmentKey(item.id);
                          if (item.id === "pending_payment") {
                            setCtaLabel("Pagar ahora");
                            setCtaUrl("");
                          } else if (templateKey !== "pending_payment" && !ctaUrl.trim()) {
                            setCtaLabel(selectedType?.ctaLabel ?? "Reservar hora");
                            setCtaUrl(fallbackBookingUrl(tenantSlug));
                          }
                          setSendState(null);
                          setResult(null);
                          setConfirmed(false);
                        }}
                        className={`rounded-2xl border p-4 text-left shadow-sm transition ${
                          active
                            ? "border-sky-700 bg-sky-50 text-sky-950"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="font-black">{item.title}</div>
                        <div className="mt-1 text-sm text-slate-500">{item.text}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">Editor</div>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      Puedes personalizar el texto sin perder la estructura de la plantilla.
                    </p>
                    {pendingPaymentCampaign ? (
                    <p className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                        Esta campaña usará el link de pago pendiente de cada reserva. Si una reserva pendiente no tiene link de pago, se omitirá para evitar enviar al cliente a una página incorrecta.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={restoreTemplate}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Restaurar plantilla
                  </button>
                </div>

                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Asunto del email
                  <input
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      setSendState(null);
                      setResult(null);
                    }}
                    className="rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                    placeholder="Tenemos una promoción especial para ti"
                  />
                </label>

                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Título / headline
                  <input
                    value={headline}
                    onChange={(e) => {
                      setHeadline(e.target.value);
                      setSendState(null);
                      setResult(null);
                    }}
                    className="rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                    placeholder="Agenda tu próxima visita"
                  />
                </label>

                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Mensaje principal
                  <textarea
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      setSendState(null);
                      setResult(null);
                    }}
                    className="min-h-32 rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                    placeholder="Escribe el mensaje de la campaña"
                  />
                  <span className="text-xs font-semibold text-slate-500">
                    Variables: {"{{customerName}}"} · {"{{businessName}}"} · {"{{serviceName}}"} · {"{{amount}}"} · {"{{appointmentDate}}"} · {"{{appointmentTime}}"}
                  </span>
                </label>

                <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    Texto del botón
                    <input
                      value={ctaLabel}
                      onChange={(e) => {
                        if (pendingPaymentCampaign) return;
                        setCtaLabel(e.target.value);
                        setSendState(null);
                        setResult(null);
                      }}
                      disabled={pendingPaymentCampaign}
                      className="rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                      placeholder="Reservar hora"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    Link del botón
                    <input
                      value={
                        pendingPaymentCampaign
                          ? "Se usará automáticamente el link de pago de cada reserva"
                          : ctaUrl
                      }
                      onChange={(e) => {
                        if (pendingPaymentCampaign) return;
                        setCtaUrl(e.target.value);
                        setSendState(null);
                        setResult(null);
                      }}
                      disabled={pendingPaymentCampaign}
                      className="rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                      placeholder="https://..."
                    />
                    {pendingPaymentCampaign ? (
                      <span className="text-xs font-semibold text-slate-500">
                        El envío real reemplaza este campo por el payment link de cada reserva.
                      </span>
                    ) : null}
                  </label>
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <div className="text-sm font-black text-slate-800">Contenido visual</div>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Recomendado: imagen horizontal 1200x600 px o 1080x1080 px. Para videos, Citaya enviará un enlace compatible con correo.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {MEDIA_TYPES.map((item) => {
                    const active = mediaType === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => changeMediaType(item.id)}
                        className={`rounded-2xl border p-3 text-left transition ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        <div className="text-sm font-black">{item.title}</div>
                        <div className={`mt-1 text-xs font-semibold ${active ? "text-slate-200" : "text-slate-500"}`}>
                          {item.text}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {mediaType !== "none" ? (
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-white">
                        <Upload className="h-4 w-4" />
                        {uploadingMedia ? "Subiendo..." : "Subir archivo"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                          className="sr-only"
                          disabled={uploadingMedia}
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            void uploadCampaignMedia(file);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <span className="text-xs font-bold text-slate-500">
                        Imagen/GIF hasta 5 MB · Video hasta 25 MB
                      </span>
                    </div>

                    <label className="grid gap-1 text-sm font-bold text-slate-700">
                      Usar URL de imagen o video
                      <input
                        value={mediaUrl}
                        onChange={(e) => {
                          setMediaUrl(e.target.value);
                          setMediaFileName("");
                          setMediaMimeType("");
                          setMediaSize(0);
                          setSendState(null);
                          setResult(null);
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none focus:border-slate-400"
                        placeholder="https://..."
                      />
                    </label>

                    {effectiveMediaUrl ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black text-slate-800">
                              {mediaFileName || selectedMediaType?.title || "Contenido visual"}
                            </div>
                            <div className="truncate text-xs font-semibold text-slate-500">
                              {mediaMimeType || "URL externa"}
                              {mediaSize ? ` · ${formatFileSize(mediaSize)}` : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={resetMedia}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                          >
                            <X className="h-3.5 w-3.5" />
                            Quitar archivo
                          </button>
                        </div>

                        {mediaType === "video" ? (
                          <div className="grid gap-2">
                            <video
                              src={effectiveMediaUrl}
                              className="max-h-56 w-full rounded-2xl bg-slate-900 object-cover"
                              muted
                              controls
                            />
                            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs font-bold text-sky-900">
                              En el email se enviará como enlace para asegurar compatibilidad.
                            </div>
                          </div>
                        ) : (
                          <img
                            src={effectiveMediaUrl}
                            alt="Contenido visual de campaña"
                            className="max-h-72 w-full rounded-2xl object-contain"
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <div className="text-sm font-black text-slate-800">Canales de contacto</div>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Estos datos aparecerán en el footer de tus campañas.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black uppercase text-slate-500">WhatsApp</div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                        previewWhatsAppUrl
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-600"
                      }`}>
                        {previewWhatsAppUrl ? "Configurado" : "No configurado"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-900">
                      {previewWhatsAppUrl ? previewWhatsAppValue : "Agrega un WhatsApp para mostrar el botón."}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black uppercase text-slate-500">Email</div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                        previewContactEmail
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-600"
                      }`}>
                        {previewContactEmail ? "Configurado" : "No configurado"}
                      </span>
                    </div>
                    <div className="mt-1 break-all text-sm font-black text-slate-900">
                      {previewContactEmail || "Agrega un email para mostrar el botón."}
                    </div>
                  </div>
                </div>
                {!hasContactChannels ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                    <span>Puedes agregar WhatsApp y email de contacto desde Configuración para que aparezcan en tus campañas.</span>
                    <a
                      href="/admin/configuracion"
                      className="rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-900 shadow-sm hover:bg-amber-100"
                    >
                      Ir a Configuración
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-start gap-3 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    Confirmo que quiero enviar esta campaña a los clientes seleccionados.
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void sendCampaign()}
                    disabled={isSendDisabled}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {sending ? "Enviando campaña..." : "Enviar campaña"}
                  </button>
                  <StatusBadge status={sending ? "sending" : sendState?.type === "success" ? "sent" : "prepared"} />
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
            </div>
          )}
        </AdminSectionCard>

        <div className="grid gap-4">
          <AdminSectionCard title="Preview en vivo">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-black uppercase text-slate-500">Para María</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-700">
                  {previewSubject || "Asunto del email"}
                </div>
              </div>
              <div className="p-5 text-center">
                {effectiveMediaUrl && (mediaType === "image" || mediaType === "gif") ? (
                  <img
                    src={effectiveMediaUrl}
                    alt="Contenido visual de la campaña"
                    className="mb-5 max-h-64 w-full rounded-2xl object-contain"
                  />
                ) : null}
                {effectiveMediaUrl && mediaType === "video" ? (
                  <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
                      <Video className="h-5 w-5" />
                    </div>
                    <div className="mt-3 text-sm font-black text-slate-900">Video de campaña</div>
                    <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                      El video se abrirá desde el botón del correo.
                    </p>
                    <span className="mt-3 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">
                      Ver video
                    </span>
                  </div>
                ) : null}
                {tenantInfo?.logo_url ? (
                  <img
                    src={tenantInfo.logo_url}
                    alt={tenantInfo.name || "Logo"}
                    className="mx-auto mb-4 h-14 w-14 rounded-2xl object-cover"
                  />
                ) : null}
                <div className="text-xl font-black text-slate-950">
                  {previewHeadline || "Título de la campaña"}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {previewMessage || "Escribe un mensaje para ver la campaña."}
                </p>
                <a
                  href={pendingPaymentCampaign ? "#" : ctaUrl || "#"}
                  className="mt-5 inline-flex w-full justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
                  onClick={(e) => e.preventDefault()}
                >
                  {pendingPaymentCampaign ? "Pagar ahora" : ctaLabel || "Reservar hora"}
                </a>
                {pendingPaymentCampaign ? (
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                    En el envío real, cada cliente recibirá su link de pago correspondiente.
                  </p>
                ) : null}
                <div className="mt-6 border-t border-slate-200 pt-4">
                  <p className="text-xs font-bold leading-5 text-slate-500">
                    Este mensaje fue enviado automáticamente por Citaya en nombre de{" "}
                    <span className="font-black text-slate-700">
                      {previewVars.businessName}
                    </span>
                    .
                    <br />
                    Por favor, no respondas directamente a este correo.
                  </p>
                  {hasContactChannels ? (
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {previewWhatsAppUrl ? (
                        <a
                          href={previewWhatsAppUrl}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800"
                          onClick={(e) => e.preventDefault()}
                        >
                          WhatsApp
                        </a>
                      ) : null}
                      {previewContactEmail ? (
                        <a
                          href={`mailto:${previewContactEmail}`}
                          className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-800"
                          onClick={(e) => e.preventDefault()}
                        >
                          Email
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-bold text-slate-500">
                      Usa el botón principal de la campaña para continuar.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </AdminSectionCard>

          <AdminSectionCard title="Resumen de campaña">
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-500">Plantilla</span>
                <span className="font-black text-slate-900">{selectedType?.title}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-500">Segmento</span>
                <span className="font-black text-slate-900">{selectedAudience?.title}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-500">Canal</span>
                <span className="font-black text-slate-900">Email</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-500">Contenido visual</span>
                <span className="inline-flex items-center gap-1 text-right font-black text-slate-900">
                  {mediaType === "video" ? (
                    <Video className="h-4 w-4 text-slate-500" />
                  ) : mediaType === "image" || mediaType === "gif" ? (
                    <ImageIcon className="h-4 w-4 text-slate-500" />
                  ) : null}
                  {selectedMediaType?.title ?? "Sin imagen"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-500">Estado</span>
                <StatusBadge status={sending ? "sending" : sendState?.type === "success" ? "sent" : "prepared"} />
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 font-bold text-amber-900">
                Límite de seguridad: máximo 100 destinatarios.
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 font-bold text-slate-600">
                Se registrará un log por cada mensaje enviado.
              </div>
            </div>
          </AdminSectionCard>

          {result ? (
            <AdminSectionCard title="Resultado">
              <div className="grid gap-2 text-sm font-bold text-slate-700">
                <div className="flex justify-between">
                  <span>Enviados</span>
                  <span className="font-black text-emerald-700">{result.sentCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Omitidos</span>
                  <span className="font-black text-amber-700">{result.skippedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Errores</span>
                  <span className="font-black text-red-700">{result.errorCount}</span>
                </div>
                {result.campaignId ? (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                    Campaña registrada: {result.campaignId.slice(0, 8)}
                  </div>
                ) : null}
              </div>
            </AdminSectionCard>
          ) : (
            <AdminSectionCard title="Historial">
              <EmptyState
                title="Aún no has enviado campañas"
                description="Puedes comenzar con una promoción, un recordatorio o una campaña para clientes inactivos."
                actionLabel="Crear campaña"
                actionHref="/admin/campanas"
              />
            </AdminSectionCard>
          )}
        </div>
      </div>
    </AdminPageShell>
  );
}
