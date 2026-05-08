"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  contact_email?: string | null;
  admin_email?: string | null;
};

type SendResult = {
  campaignId?: string;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  invalidEmailCount: number;
  missingPaymentLinkCount: number;
  validPaymentLinkCount: number;
  totalMatchedCount: number;
  message: string;
};

type AudienceStats = {
  totalMatchedCount: number;
  validEmailCount: number;
  validPaymentLinkCount: number;
  recipientCount: number;
  skippedCount: number;
  invalidEmailCount: number;
  duplicateOrLimitedCount: number;
  missingPaymentLinkCount: number;
  audienceOffset: number;
  audienceLimit: number;
};

type CampaignHistoryItem = {
  id: string;
  campaignId: string;
  createdAt: string;
  subject: string;
  templateKey: string;
  segmentKey: string;
  channel: string;
  mediaType: CampaignMediaType;
  sentCount: number;
  errorCount: number;
  status: "enviada" | "parcial" | "error";
};

type CampaignLogRow = {
  created_at?: string | null;
  subject?: string | null;
  campaign_id?: string | null;
  template_key?: string | null;
  segment_key?: string | null;
  channel?: string | null;
  media_type?: string | null;
  status?: string | null;
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

function formatCampaignDate(value: string) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function groupCampaignHistory(logs: CampaignLogRow[]): CampaignHistoryItem[] {
  const grouped = new Map<string, CampaignHistoryItem>();

  for (const log of logs) {
    const createdAt = String(log.created_at ?? "");
    const fallbackKey = `${String(log.subject ?? "Campaña")}-${createdAt.slice(0, 16)}`;
    const campaignId = String(log.campaign_id ?? "") || fallbackKey;
    const current =
      grouped.get(campaignId) ??
      {
        id: campaignId,
        campaignId,
        createdAt,
        subject: String(log.subject ?? "Campaña"),
        templateKey: String(log.template_key ?? ""),
        segmentKey: String(log.segment_key ?? ""),
        channel: String(log.channel ?? "email"),
        mediaType: (String(log.media_type ?? "none") as CampaignMediaType) || "none",
        sentCount: 0,
        errorCount: 0,
        status: "enviada" as const,
      };

    if (!current.createdAt || createdAt > current.createdAt) {
      current.createdAt = createdAt;
    }
    if (String(log.status ?? "") === "sent") current.sentCount += 1;
    if (String(log.status ?? "") === "error") current.errorCount += 1;
    grouped.set(campaignId, current);
  }

  return Array.from(grouped.values())
    .map((item): CampaignHistoryItem => ({
      ...item,
      status:
        item.errorCount > 0 && item.sentCount > 0
          ? "parcial"
          : item.errorCount > 0
            ? "error"
            : "enviada",
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  const [audienceStats, setAudienceStats] = useState<AudienceStats | null>(null);
  const [loadingAudienceStats, setLoadingAudienceStats] = useState(false);
  const [audienceStatsError, setAudienceStatsError] = useState("");
  const [audienceOffset, setAudienceOffset] = useState(0);
  const [campaignHistory, setCampaignHistory] = useState<CampaignHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySetupRequired, setHistorySetupRequired] = useState(false);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        return;
      }

      const withWhatsapp = await supabase
        .from("tenants")
        .select("id, slug, name, logo_url, phone_display, whatsapp, contact_email, admin_email")
        .eq("slug", slug)
        .maybeSingle();

      const tenantRes =
        !withWhatsapp.error && withWhatsapp.data?.id
          ? withWhatsapp
          : await supabase
              .from("tenants")
              .select("id, slug, name, logo_url, phone_display, contact_email, admin_email")
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
  const pendingPaymentHasNoValidRecipients =
    pendingPaymentCampaign &&
    !loadingAudienceStats &&
    audienceStats !== null &&
    audienceStats.validPaymentLinkCount === 0;
  const pendingPaymentAudienceUnavailable =
    pendingPaymentCampaign &&
    !loadingAudienceStats &&
    (!audienceStats || Boolean(audienceStatsError));
  const eligibleAudienceCount = pendingPaymentCampaign
    ? audienceStats?.validPaymentLinkCount ?? 0
    : audienceStats?.validEmailCount ?? 0;
  const audienceRanges = useMemo(() => {
    const total = Math.max(0, eligibleAudienceCount);
    const count = Math.max(1, Math.ceil(total / 100));
    return Array.from({ length: count }, (_, index) => {
      const start = index * 100;
      const end = Math.min(start + 100, total || start + 100);
      return {
        offset: start,
        label: `${start + 1}-${end}`,
        estimatedCount: Math.max(0, end - start),
      };
    });
  }, [eligibleAudienceCount]);
  const selectedAudienceRange =
    audienceRanges.find((item) => item.offset === audienceOffset) ?? audienceRanges[0];

  useEffect(() => {
    if (audienceOffset > 0 && audienceOffset >= Math.max(1, eligibleAudienceCount)) {
      setAudienceOffset(0);
    }
  }, [audienceOffset, eligibleAudienceCount]);

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
    !confirmed ||
    (pendingPaymentCampaign &&
      (loadingAudienceStats ||
        pendingPaymentHasNoValidRecipients ||
        pendingPaymentAudienceUnavailable));

  const effectiveMediaUrl = mediaType === "none" ? "" : mediaUrl.trim();
  const selectedMediaType = useMemo(
    () => MEDIA_TYPES.find((item) => item.id === mediaType),
    [mediaType],
  );

  const loadCampaignHistory = useCallback(async () => {
    if (!authChecked || !tenantSlug) return;
    setLoadingHistory(true);
    setHistorySetupRequired(false);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Inicia sesión nuevamente para ver historial.");

      const params = new URLSearchParams(
        tenantInfo?.id ? { tenantId: tenantInfo.id, tenantSlug } : { tenantSlug },
      );
      const res = await fetch(`/api/admin/logs/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "No se pudo cargar el historial.");
      }
      setHistorySetupRequired(Boolean(json.setupRequired));
      setCampaignHistory(
        groupCampaignHistory(Array.isArray(json.logs) ? (json.logs as CampaignLogRow[]) : []),
      );
    } catch {
      setCampaignHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [authChecked, tenantInfo?.id, tenantSlug]);

  useEffect(() => {
    void loadCampaignHistory();
  }, [loadCampaignHistory]);

  useEffect(() => {
    if (!authChecked || !tenantSlug) {
      setAudienceStats(null);
      setAudienceStatsError("");
      setLoadingAudienceStats(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoadingAudienceStats(true);
      setAudienceStatsError("");

      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error("Inicia sesión nuevamente para revisar pagos pendientes.");

        const params = new URLSearchParams({
          tenantSlug,
          templateKey,
          segmentKey,
          audienceOffset: String(audienceOffset),
          audienceLimit: "100",
        });
        const res = await fetch(`/api/admin/campaigns/send?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? "No se pudo revisar la audiencia.");
        }
        if (cancelled) return;
        setAudienceStats({
          totalMatchedCount: Number(json.totalMatchedCount ?? 0),
          validEmailCount: Number(json.validEmailCount ?? 0),
          validPaymentLinkCount: Number(json.validPaymentLinkCount ?? 0),
          recipientCount: Number(json.recipientCount ?? 0),
          skippedCount: Number(json.skippedCount ?? 0),
          invalidEmailCount: Number(json.invalidEmailCount ?? 0),
          duplicateOrLimitedCount: Number(json.duplicateOrLimitedCount ?? 0),
          missingPaymentLinkCount: Number(json.missingPaymentLinkCount ?? 0),
          audienceOffset: Number(json.audienceOffset ?? audienceOffset),
          audienceLimit: Number(json.audienceLimit ?? 100),
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setAudienceStats(null);
        setAudienceStatsError(getErrorMessage(e, "No se pudo revisar la audiencia."));
      } finally {
        if (!cancelled) setLoadingAudienceStats(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [audienceOffset, authChecked, segmentKey, templateKey, tenantSlug]);

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
    } catch (e: unknown) {
      toast({
        title: "No se pudo subir el archivo",
        description: getErrorMessage(e, "Intenta nuevamente en unos minutos."),
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
          tenantId: tenantInfo?.id,
          mediaType,
          mediaUrl: cleanMediaUrl,
          mediaFileName,
          mediaMimeType,
          mediaSize,
          audienceOffset,
          audienceLimit: 100,
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
        invalidEmailCount: Number(json.invalidEmailCount ?? 0),
        missingPaymentLinkCount: Number(json.missingPaymentLinkCount ?? 0),
        validPaymentLinkCount: Number(json.validPaymentLinkCount ?? 0),
        totalMatchedCount: Number(json.totalMatchedCount ?? 0),
        message: text,
      });
      await loadCampaignHistory();
      setConfirmed(false);
      toast({
        title: "Campaña enviada",
        description: `${Number(json.sentCount ?? 0)} emails enviados.`,
      });
    } catch (e: unknown) {
      const text = getErrorMessage(e, "No se pudo conectar con el endpoint de campañas.");
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
    setAudienceOffset(0);
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
  const previewContactEmail =
    tenantInfo?.contact_email?.trim() || tenantInfo?.admin_email?.trim() || "";
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
                          setAudienceOffset(0);
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

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">Lote de destinatarios</div>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      El envío respeta el máximo de 100 destinatarios por lote.
                    </p>
                  </div>
                  <div className="text-xs font-black uppercase text-slate-500">
                    {loadingAudienceStats ? "Calculando" : `${eligibleAudienceCount} disponibles`}
                  </div>
                </div>
                <select
                  value={audienceOffset}
                  onChange={(e) => {
                    setAudienceOffset(Number(e.target.value));
                    setSendState(null);
                    setResult(null);
                    setConfirmed(false);
                  }}
                  disabled={loadingAudienceStats || audienceRanges.length <= 1}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  {audienceRanges.map((range) => (
                    <option key={range.offset} value={range.offset}>
                      {range.label} ({range.estimatedCount} estimados)
                    </option>
                  ))}
                </select>
                {audienceStatsError ? (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-800">
                    {audienceStatsError}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">Editor</div>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      Puedes personalizar el texto sin perder la estructura de la plantilla.
                    </p>
                    {pendingPaymentCampaign ? (
                      <div className="mt-3 grid gap-3 rounded-2xl border border-amber-100 bg-[linear-gradient(180deg,#fffbeb_0%,#ffffff_100%)] p-4 shadow-sm">
                        <div className="text-sm font-black text-amber-950">
                          Esta campaña enviará un link de pago único a cada cliente con pago pendiente.
                        </div>
                        <p className="text-sm font-semibold leading-6 text-amber-900">
                          El botón del email usará el mismo link real que aparece en Pagos para abrir, copiar o reenviar. Los registros sin link válido se omiten.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-4">
                          {[
                            ["Encontrados", loadingAudienceStats ? "..." : audienceStats?.totalMatchedCount ?? 0],
                            ["Con link válido", loadingAudienceStats ? "..." : audienceStats?.validPaymentLinkCount ?? 0],
                            ["Sin link", loadingAudienceStats ? "..." : audienceStats?.missingPaymentLinkCount ?? 0],
                            ["Email inválido", loadingAudienceStats ? "..." : audienceStats?.invalidEmailCount ?? 0],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-2xl border border-white bg-white/80 p-3 shadow-sm">
                              <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
                              <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
                            </div>
                          ))}
                        </div>
                        {audienceStatsError ? (
                          <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-800">
                            {audienceStatsError}
                          </div>
                        ) : null}
                        {pendingPaymentHasNoValidRecipients ? (
                          <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-800">
                            No hay pagos pendientes con link válido para enviar.
                          </div>
                        ) : null}
                        {audienceStats && audienceStats.missingPaymentLinkCount > 0 ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
                            Algunos clientes serán omitidos porque no tienen link de pago válido.
                          </div>
                        ) : null}
                      </div>
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
                {pendingPaymentHasNoValidRecipients ? (
                  <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-800">
                    No hay pagos pendientes con link válido para enviar.
                  </div>
                ) : null}
                {pendingPaymentCampaign && audienceStats && audienceStats.missingPaymentLinkCount > 0 ? (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                    Algunos clientes fueron omitidos porque no tienen link de pago válido.
                  </div>
                ) : null}

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
                <span className="font-bold text-slate-500">Rango</span>
                <span className="font-black text-slate-900">{selectedAudienceRange?.label}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-500">Destinatarios estimados</span>
                <span className="font-black text-slate-900">
                  {loadingAudienceStats ? "..." : audienceStats?.recipientCount ?? 0}
                </span>
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
              {pendingPaymentCampaign ? (
                <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-500">Pagos encontrados</span>
                    <span className="font-black text-slate-900">
                      {loadingAudienceStats ? "..." : audienceStats?.totalMatchedCount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-500">Listos para enviar</span>
                    <span className="font-black text-emerald-700">
                      {loadingAudienceStats ? "..." : audienceStats?.validPaymentLinkCount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-500">Omitidos sin link</span>
                    <span className="font-black text-amber-700">
                      {loadingAudienceStats ? "..." : audienceStats?.missingPaymentLinkCount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-500">Emails inválidos</span>
                    <span className="font-black text-red-700">
                      {loadingAudienceStats ? "..." : audienceStats?.invalidEmailCount ?? 0}
                    </span>
                  </div>
                </div>
              ) : null}
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
                {pendingPaymentCampaign ? (
                  <>
                    <div className="flex justify-between">
                      <span>Con link válido</span>
                      <span className="font-black text-emerald-700">{result.validPaymentLinkCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sin link de pago</span>
                      <span className="font-black text-amber-700">{result.missingPaymentLinkCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Email inválido</span>
                      <span className="font-black text-red-700">{result.invalidEmailCount}</span>
                    </div>
                  </>
                ) : null}
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
          ) : null}

          <AdminSectionCard title="Historial">
            {loadingHistory ? (
              <EmptyState
                title="Cargando historial"
                description="Estamos revisando los envíos registrados para este tenant."
              />
            ) : historySetupRequired ? (
              <EmptyState
                title="Historial no configurado"
                description="Falta crear la tabla message_logs en Supabase para persistir campañas enviadas."
              />
            ) : campaignHistory.length === 0 ? (
              <EmptyState
                title="Aún no has enviado campañas"
                description="Puedes comenzar con una promoción, un recordatorio o una campaña para clientes inactivos."
                actionLabel="Crear campaña"
                actionHref="/admin/campanas"
              />
            ) : (
              <div className="grid gap-3">
                {campaignHistory.slice(0, 8).map((item) => {
                  const template = CAMPAIGN_TEMPLATES.find((entry) => entry.id === item.templateKey);
                  const segment = SEGMENTS.find((entry) => entry.id === item.segmentKey);
                  const media = MEDIA_TYPES.find((entry) => entry.id === item.mediaType);
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-black text-slate-900">
                            {item.subject || template?.title || "Campaña"}
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-500">
                            {formatCampaignDate(item.createdAt)}
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600">
                        <div className="flex justify-between gap-3">
                          <span>Plantilla</span>
                          <span className="text-right text-slate-900">{template?.title || item.templateKey || "Sin dato"}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Segmento</span>
                          <span className="text-right text-slate-900">{segment?.title || item.segmentKey || "Sin dato"}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Canal</span>
                          <span className="text-right text-slate-900">{item.channel || "email"}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Contenido visual</span>
                          <span className="text-right text-slate-900">{media?.title || "Sin imagen"}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Destinatarios/enviados</span>
                          <span className="text-right text-slate-900">{item.sentCount}</span>
                        </div>
                        {item.errorCount > 0 ? (
                          <div className="flex justify-between gap-3 text-red-700">
                            <span>Errores</span>
                            <span>{item.errorCount}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </AdminSectionCard>
        </div>
      </div>
    </AdminPageShell>
  );
}
