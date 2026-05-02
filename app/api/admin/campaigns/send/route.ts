export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type CampaignPayload = {
  templateKey?: string;
  segmentKey?: string;
  subject?: string;
  headline?: string;
  message?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  tenantSlug?: string;
  mediaType?: string;
  mediaUrl?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
  mediaSize?: number | string;
  videoUrl?: string;
  imageUrl?: string;
  campaignImageUrl?: string;
};

type TenantBranding = {
  id: string;
  slug: string;
  name: string | null;
  logo_url: string | null;
  phone_display?: string | null;
  whatsapp?: string | null;
  admin_email?: string | null;
};

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type AppointmentRow = {
  customer_id: string | null;
  service_name: string | null;
  start_at: string | null;
  status: string | null;
  booking_status: string | null;
  payment_status: string | null;
  payment_required_amount: number | string | null;
  payment_remaining_amount: number | string | null;
  payment_url: string | null;
};

type Recipient = {
  customerId: string;
  customerName: string;
  customerEmail: string;
  phone: string;
  lastAppointmentAt: string | null;
  totalAppointments: number;
  pendingAmount: number;
  paymentLink: string;
  payment_link: string;
  ctaUrl: string;
  cta_url: string;
  ctaLabel: string;
  cta_label: string;
  tags: string[];
};

const ALLOWED_TEMPLATES = new Set([
  "promo",
  "discount",
  "reactivation",
  "vacation",
  "reminder",
  "pending_payment",
  "pago_pendiente",
  "payment",
  "payment_pending",
]);

const ALLOWED_SEGMENTS = new Set([
  "all",
  "recurring",
  "inactive",
  "pending_payment",
  "pagos_pendientes",
  "payment_pending",
  "upcoming",
]);

const MAX_RECIPIENTS = 100;
const ALLOWED_MEDIA_TYPES = new Set(["none", "image", "gif", "video"]);

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function fallbackBookingUrl(slug: string) {
  return slug ? `https://${slug}.citaya.online/reservar` : "https://citaya.online/reservar";
}

function isPaymentCampaign(input: { templateKey: string; segmentKey: string }) {
  return (
    input.templateKey === "pending_payment" ||
    input.templateKey === "pago_pendiente" ||
    input.templateKey === "payment" ||
    input.templateKey === "payment_pending" ||
    input.segmentKey === "pending_payment" ||
    input.segmentKey === "pagos_pendientes" ||
    input.segmentKey === "payment_pending"
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function isLikelyChileanMobile(value: string) {
  const digits = digitsOnly(value);
  return (
    (digits.startsWith("569") && digits.length >= 11) ||
    (digits.startsWith("56") && digits.length >= 11) ||
    (digits.startsWith("9") && digits.length === 9)
  );
}

function normalizeWhatsappNumber(value: string) {
  const digits = digitsOnly(value);
  if (digits.length < 8) return "";
  if (digits.startsWith("56")) return digits;
  if (digits.startsWith("9") && digits.length === 9) return `56${digits}`;
  return digits;
}

function whatsappUrlFromPhone(value: string) {
  const normalizedPhone = normalizeWhatsappNumber(value);
  return normalizedPhone ? `https://wa.me/${normalizedPhone}` : "";
}

function moneyNumber(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getTenantSlug(req: Request, body: CampaignPayload) {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  const fromHost = getTenantSlugFromHostname(host);
  if (fromHost) return fromHost;

  return String(body.tenantSlug ?? "").trim();
}

async function fetchTenantBranding(tenantSlug: string): Promise<TenantBranding | null> {
  const withWhatsapp = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name, logo_url, phone_display, whatsapp, admin_email")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!withWhatsapp.error && withWhatsapp.data?.id) {
    return withWhatsapp.data as TenantBranding;
  }

  const fallback = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name, logo_url, phone_display, admin_email")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (fallback.error || !fallback.data?.id) return null;
  return fallback.data as TenantBranding;
}

function appointmentStats(appointments: AppointmentRow[]) {
  const byCustomer = new Map<
    string,
    {
      totalAppointments: number;
      lastAppointmentAt: string | null;
      pendingAmount: number;
      hasPendingPayment: boolean;
      pendingPaymentLink: string;
      hasUpcoming: boolean;
    }
  >();

  const now = Date.now();

  for (const appt of appointments) {
    if (!appt.customer_id) continue;
    const current =
      byCustomer.get(appt.customer_id) ??
      {
        totalAppointments: 0,
        lastAppointmentAt: null,
        pendingAmount: 0,
        hasPendingPayment: false,
        pendingPaymentLink: "",
        hasUpcoming: false,
      };

    current.totalAppointments += 1;

    const startAt = appt.start_at ? String(appt.start_at) : null;
    const startMs = startAt ? new Date(startAt).getTime() : Number.NaN;
    if (
      startAt &&
      Number.isFinite(startMs) &&
      (!current.lastAppointmentAt ||
        startMs > new Date(current.lastAppointmentAt).getTime())
    ) {
      current.lastAppointmentAt = startAt;
    }

    const paymentStatus = normalized(appt.payment_status);
    const bookingStatus = normalized(appt.booking_status);
    const status = normalized(appt.status);
    const isPendingPayment =
      paymentStatus === "pending" ||
      paymentStatus === "failed" ||
      paymentStatus === "pending_payment" ||
      bookingStatus === "pending_payment" ||
      status === "pending_payment";

    if (isPendingPayment) {
      current.hasPendingPayment = true;
      current.pendingAmount +=
        moneyNumber(appt.payment_remaining_amount) ||
        moneyNumber(appt.payment_required_amount);
      if (!current.pendingPaymentLink && appt.payment_url?.trim()) {
        current.pendingPaymentLink = appt.payment_url.trim();
      }
    }

    const isUpcoming =
      Number.isFinite(startMs) &&
      startMs >= now &&
      (status === "confirmed" || bookingStatus === "confirmed");
    if (isUpcoming) current.hasUpcoming = true;

    byCustomer.set(appt.customer_id, current);
  }

  return byCustomer;
}

function tagsForRecipient(input: {
  totalAppointments: number;
  lastAppointmentAt: string | null;
  pendingAmount: number;
  hasUpcoming: boolean;
}) {
  const tags: string[] = [];
  if (input.totalAppointments >= 2) tags.push("recurrente");
  if (input.pendingAmount > 0) tags.push("pago_pendiente");
  if (input.hasUpcoming) tags.push("proxima_cita");
  if (!input.lastAppointmentAt) tags.push("sin_citas");
  return tags;
}

async function fetchRecipients(tenantId: string, segmentKey: string) {
  const { data: customers, error: customersError } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("tenant_id", tenantId)
    .order("full_name", { ascending: true })
    .limit(1000);

  if (customersError) throw new Error(customersError.message);

  const customerRows = (customers ?? []) as CustomerRow[];
  const customerIds = customerRows.map((c) => c.id);

  let appointments: AppointmentRow[] = [];
  if (customerIds.length > 0) {
    const { data: appointmentRows, error: appointmentsError } = await supabaseAdmin
      .from("appointments")
      .select(
        "customer_id, service_name, start_at, status, booking_status, payment_status, payment_required_amount, payment_remaining_amount, payment_url",
      )
      .eq("tenant_id", tenantId)
      .in("customer_id", customerIds)
      .limit(5000);

    if (appointmentsError) throw new Error(appointmentsError.message);
    appointments = (appointmentRows ?? []) as AppointmentRow[];
  }

  const statsByCustomer = appointmentStats(appointments);
  const inactiveBefore = Date.now() - 1000 * 60 * 60 * 24 * 45;

  const recipients = customerRows
    .map((customer) => {
      const stats = statsByCustomer.get(customer.id) ?? {
        totalAppointments: 0,
        lastAppointmentAt: null,
        pendingAmount: 0,
        hasPendingPayment: false,
        pendingPaymentLink: "",
        hasUpcoming: false,
      };

      const lastMs = stats.lastAppointmentAt
        ? new Date(stats.lastAppointmentAt).getTime()
        : Number.NaN;
      const inactive =
        !stats.lastAppointmentAt ||
        (Number.isFinite(lastMs) && lastMs < inactiveBefore);

      const matches =
        segmentKey === "all" ||
        (segmentKey === "recurring" && stats.totalAppointments >= 2) ||
        (segmentKey === "inactive" && inactive) ||
        ((segmentKey === "pending_payment" ||
          segmentKey === "pagos_pendientes" ||
          segmentKey === "payment_pending") &&
          stats.hasPendingPayment) ||
        (segmentKey === "upcoming" && stats.hasUpcoming);

      if (!matches) return null;

      return {
        customerId: customer.id,
        customerName: customer.full_name?.trim() || "Cliente",
        customerEmail: customer.email?.trim().toLowerCase() || "",
        phone: customer.phone?.trim() || "",
        lastAppointmentAt: stats.lastAppointmentAt,
        totalAppointments: stats.totalAppointments,
        pendingAmount: stats.pendingAmount,
        paymentLink: stats.pendingPaymentLink,
        payment_link: stats.pendingPaymentLink,
        ctaUrl: "",
        cta_url: "",
        ctaLabel: "",
        cta_label: "",
        tags: tagsForRecipient({
          totalAppointments: stats.totalAppointments,
          lastAppointmentAt: stats.lastAppointmentAt,
          pendingAmount: stats.pendingAmount,
          hasUpcoming: stats.hasUpcoming,
        }),
      } satisfies Recipient;
    })
    .filter((recipient): recipient is Recipient => Boolean(recipient));

  if (segmentKey === "recurring") {
    recipients.sort((a, b) => b.totalAppointments - a.totalAppointments);
  }

  if (segmentKey === "inactive") {
    recipients.sort((a, b) => {
      const aTime = a.lastAppointmentAt ? new Date(a.lastAppointmentAt).getTime() : 0;
      const bTime = b.lastAppointmentAt ? new Date(b.lastAppointmentAt).getTime() : 0;
      return aTime - bTime;
    });
  }

  return recipients;
}

function filterPaymentRecipients(
  recipients: Recipient[],
  ctaLabel: string,
  ctaUrl: string,
) {
  const usable: Recipient[] = [];
  const skippedMissingPaymentLink: Recipient[] = [];

  for (const recipient of recipients) {
    const paymentLink = recipient.paymentLink || recipient.payment_link;
    if (!paymentLink || !isHttpUrl(paymentLink)) {
      skippedMissingPaymentLink.push(recipient);
      continue;
    }

    usable.push({
      ...recipient,
      paymentLink,
      payment_link: paymentLink,
      ctaUrl: paymentLink,
      cta_url: paymentLink,
      ctaLabel,
      cta_label: ctaLabel,
    });
  }

  return { recipients: usable, skippedMissingPaymentLink };
}

function enrichNormalRecipients(
  recipients: Recipient[],
  ctaLabel: string,
  ctaUrl: string,
) {
  return recipients.map((recipient) => ({
    ...recipient,
    ctaUrl,
    cta_url: ctaUrl,
    ctaLabel,
    cta_label: ctaLabel,
  }));
}

function dedupeValidRecipients(recipients: Recipient[]) {
  const seen = new Set<string>();
  const valid: Recipient[] = [];
  let skipped = 0;

  for (const recipient of recipients) {
    const email = recipient.customerEmail.trim().toLowerCase();
    if (!email || !isEmail(email) || seen.has(email)) {
      skipped += 1;
      continue;
    }
    seen.add(email);
    valid.push({ ...recipient, customerEmail: email });
  }

  const limited = valid.slice(0, MAX_RECIPIENTS);
  skipped += Math.max(0, valid.length - limited.length);

  return { recipients: limited, skippedCount: skipped };
}

async function logMessage(
  req: Request,
  token: string,
  body: {
    tenantSlug: string;
    type: "campaign";
    recipient: string;
    subject: string;
    status: "sent" | "error";
    errorMessage?: string;
  },
) {
  try {
    await fetch(new URL("/api/admin/logs/messages", req.url).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    console.error("[api/admin/campaigns/send] log ignored:", e?.message || e);
  }
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CampaignPayload | null;
    if (!body || typeof body !== "object") return badRequest("JSON invalido");

    const payload = {
      templateKey: String(body.templateKey ?? "").trim(),
      segmentKey: String(body.segmentKey ?? "").trim(),
      subject: String(body.subject ?? "").trim(),
      headline: String(body.headline ?? "").trim(),
      message: String(body.message ?? "").trim(),
      ctaLabel: String(body.ctaLabel ?? "").trim(),
      ctaUrl: String(body.ctaUrl ?? "").trim(),
      mediaType: String(body.mediaType ?? "none").trim(),
      mediaUrl: String(
        body.mediaUrl ||
          body.campaignImageUrl ||
          body.imageUrl ||
          body.videoUrl ||
          "",
      ).trim(),
      mediaFileName: String(body.mediaFileName ?? "").trim(),
      mediaMimeType: String(body.mediaMimeType ?? "").trim(),
      mediaSize: moneyNumber(body.mediaSize),
    };

    if (!ALLOWED_TEMPLATES.has(payload.templateKey)) return badRequest("Plantilla invalida");
    if (!ALLOWED_SEGMENTS.has(payload.segmentKey)) return badRequest("Segmento invalido");
    if (!payload.subject) return badRequest("El asunto es obligatorio.");
    if (!payload.message) return badRequest("El mensaje es obligatorio.");
    const paymentCampaign = isPaymentCampaign(payload);
    if (!payload.ctaLabel && !paymentCampaign) return badRequest("El texto del boton es obligatorio.");
    if (!paymentCampaign && payload.ctaUrl && !isHttpUrl(payload.ctaUrl)) {
      return badRequest("El link del boton debe ser una URL valida.");
    }
    if (!ALLOWED_MEDIA_TYPES.has(payload.mediaType)) {
      return badRequest("Tipo de contenido visual invalido.");
    }
    if (payload.mediaUrl && !isHttpUrl(payload.mediaUrl)) {
      return badRequest("La URL del contenido visual debe ser valida.");
    }

    const tenantSlug = getTenantSlug(req, body);
    if (!tenantSlug) return badRequest("No se pudo detectar el tenant actual.");

    const tenant = await fetchTenantBranding(tenantSlug);
    if (!tenant?.id) return badRequest("Tenant no encontrado.");

    const ctaLabel = paymentCampaign ? "Pagar ahora" : payload.ctaLabel || "Reservar hora";
    const ctaUrl = paymentCampaign
      ? ""
      : payload.ctaUrl || fallbackBookingUrl(tenant.slug);
    if (!paymentCampaign && !isHttpUrl(ctaUrl)) {
      return badRequest("El link del boton debe ser una URL valida.");
    }

    const webhookUrl = process.env.N8N_CAMPAIGN_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "No esta configurado el webhook de campanas." },
        { status: 500 },
      );
    }

    const recipientSegmentKey = paymentCampaign ? "pending_payment" : payload.segmentKey;
    const allRecipients = await fetchRecipients(tenant.id, recipientSegmentKey);
    const { recipients: emailRecipients, skippedCount: emailSkippedCount } =
      dedupeValidRecipients(allRecipients);
    const paymentFiltered = paymentCampaign
      ? filterPaymentRecipients(emailRecipients, ctaLabel, ctaUrl)
      : {
          recipients: enrichNormalRecipients(emailRecipients, ctaLabel, ctaUrl),
          skippedMissingPaymentLink: [],
        };
    const recipients = paymentFiltered.recipients;
    const skippedCount =
      emailSkippedCount + paymentFiltered.skippedMissingPaymentLink.length;

    if (recipients.length === 0) {
      if (paymentFiltered.skippedMissingPaymentLink.length > 0) {
        await Promise.all(
          paymentFiltered.skippedMissingPaymentLink.map((recipient) =>
            logMessage(req, token, {
              tenantSlug: tenant.slug,
              type: "campaign",
              recipient: recipient.customerEmail || recipient.customerId,
              subject: payload.subject,
              status: "error",
              errorMessage: "Pago pendiente sin link de pago",
            }),
          ),
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: paymentCampaign
            ? "No se encontraron pagos pendientes con link de pago disponible."
            : "No encontramos clientes disponibles para este segmento.",
          skippedCount,
          skippedReasonSummary: paymentCampaign
            ? {
                missingPaymentLink: paymentFiltered.skippedMissingPaymentLink.length,
                invalidOrDuplicateEmail: emailSkippedCount,
              }
            : { invalidOrDuplicateEmail: emailSkippedCount },
        },
        { status: 400 },
      );
    }

    if (paymentFiltered.skippedMissingPaymentLink.length > 0) {
      await Promise.all(
        paymentFiltered.skippedMissingPaymentLink.map((recipient) =>
          logMessage(req, token, {
            tenantSlug: tenant.slug,
            type: "campaign",
            recipient: recipient.customerEmail || recipient.customerId,
            subject: payload.subject,
            status: "error",
            errorMessage: "Pago pendiente sin link de pago",
          }),
        ),
      );
    }

    const campaignId = crypto.randomUUID();
    const businessName = tenant.name?.trim() || tenant.slug;
    const logoUrl = tenant.logo_url?.trim() || "";
    const tenantWhatsapp = tenant.whatsapp?.trim() || "";
    const phoneDisplay = tenant.phone_display?.trim() || "";
    const whatsapp =
      tenantWhatsapp || (phoneDisplay && isLikelyChileanMobile(phoneDisplay) ? phoneDisplay : "");
    const whatsappUrl = whatsappUrlFromPhone(whatsapp);
    const contactEmail = tenant.admin_email?.trim() || "";
    const normalizedMediaType =
      payload.mediaUrl && payload.mediaType !== "none"
        ? (payload.mediaType as "image" | "gif" | "video")
        : "none";
    const imageCompatUrl =
      normalizedMediaType === "image" || normalizedMediaType === "gif"
        ? payload.mediaUrl
        : "";
    const videoCompatUrl = normalizedMediaType === "video" ? payload.mediaUrl : "";
    const media = {
      type: normalizedMediaType,
      url: payload.mediaUrl && normalizedMediaType !== "none" ? payload.mediaUrl : "",
      fileName: payload.mediaFileName,
      mimeType: payload.mediaMimeType,
      size: payload.mediaSize,
    };

    const webhookPayload = {
      campaignId,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      businessName,
      logoUrl,
      whatsapp,
      whatsappUrl,
      whatsapp_url: whatsappUrl,
      contactEmail,
      contact_email: contactEmail,
      phoneDisplay,
      phone_display: phoneDisplay,
      replyNotice: true,
      fromName: businessName,
      campaignType: payload.templateKey,
      templateKey: payload.templateKey,
      segmentKey: payload.segmentKey,
      isPaymentCampaign: paymentCampaign,
      subject: payload.subject,
      headline: payload.headline,
      message: payload.message,
      ctaLabel,
      cta_label: ctaLabel,
      ctaUrl,
      cta_url: ctaUrl,
      fallbackCtaUrl: paymentCampaign ? "" : fallbackBookingUrl(tenant.slug),
      fallback_cta_url: paymentCampaign ? "" : fallbackBookingUrl(tenant.slug),
      media,
      campaignImageUrl: imageCompatUrl,
      campaign_image_url: imageCompatUrl,
      imageUrl: imageCompatUrl,
      image_url: imageCompatUrl,
      bannerUrl: imageCompatUrl,
      banner_url: imageCompatUrl,
      videoUrl: videoCompatUrl,
      video_url: videoCompatUrl,
      recipients,
      metadata: {
        source: "admin_campaigns",
        createdAt: new Date().toISOString(),
        mediaType: media.type,
        mediaUrl: media.url,
        mediaFileName: media.fileName,
      },
    };

    let n8nRes: Response;
    try {
      n8nRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      });
    } catch (e: any) {
      console.error("[api/admin/campaigns/send] n8n fetch error:", e?.message || e);
      await Promise.all(
        recipients.map((recipient) =>
          logMessage(req, token, {
            tenantSlug: tenant.slug,
            type: "campaign",
            recipient: recipient.customerEmail,
            subject: payload.subject,
            status: "error",
            errorMessage: "No se pudo conectar con el sistema de envios.",
          }),
        ),
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo conectar con el sistema de envios." },
        { status: 502 },
      );
    }

    if (!n8nRes.ok) {
      const detail = await n8nRes.text().catch(() => "");
      console.error("[api/admin/campaigns/send] n8n error:", {
        status: n8nRes.status,
        detail,
      });
      await Promise.all(
        recipients.map((recipient) =>
          logMessage(req, token, {
            tenantSlug: tenant.slug,
            type: "campaign",
            recipient: recipient.customerEmail,
            subject: payload.subject,
            status: "error",
            errorMessage: "No se pudo conectar con el sistema de envios.",
          }),
        ),
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo conectar con el sistema de envios." },
        { status: 502 },
      );
    }

    const n8nJson = await n8nRes.json().catch(() => null);
    const n8nSentCount = Number(n8nJson?.sentCount);
    const sentCount =
      Number.isFinite(n8nSentCount) && n8nSentCount >= 0
        ? Math.min(n8nSentCount, recipients.length)
        : recipients.length;

    await Promise.all(
      recipients.map((recipient) =>
        logMessage(req, token, {
          tenantSlug: tenant.slug,
          type: "campaign",
          recipient: recipient.customerEmail,
          subject: payload.subject,
          status: "sent",
        }),
      ),
    );

    return NextResponse.json({
      ok: true,
      campaignId,
      sentCount,
      skippedCount,
      skippedReasonSummary: paymentCampaign
        ? {
            missingPaymentLink: paymentFiltered.skippedMissingPaymentLink.length,
            invalidOrDuplicateEmail: emailSkippedCount,
          }
        : { invalidOrDuplicateEmail: emailSkippedCount },
      segmentKey: payload.segmentKey,
      templateKey: payload.templateKey,
      message: "Campana enviada correctamente",
    });
  } catch (e: any) {
    console.error("[api/admin/campaigns/send] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error enviando campana" },
      { status: 500 },
    );
  }
}
