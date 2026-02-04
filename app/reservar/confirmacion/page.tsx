"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  CalendarPlus,
  Copy,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

type Appt = {
  id: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  professional_id: string;
  tenant_id: string;
  service_name?: string | null; // ✅ viene desde DB
};

type Tenant = {
  id: string;
  slug: string;
  name: string;
  phone_display: string | null;

  // opcionales si ya los tienes en tu API:
  logo_url?: string | null;
  address_display?: string | null;

  // ✅ Flags multi-tenant (si no existen, default true)
  show_address_after_booking?: boolean | null;
  show_phone_after_booking?: boolean | null;
};

type Professional = {
  id: string;
  name: string;
  title?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
};

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function normalizeCLPhoneToE164(phone: string) {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";

  if (raw.startsWith("+")) {
    const digits = raw.replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("569") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length >= 9) return `+56${digits}`;
  return digits.length >= 10 ? `+${digits}` : "";
}

function formatStartCL(startISO: string) {
  if (!startISO) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startISO));
}

function formatDateYMD(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function toICSDateUTC(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function safeText(v?: string | null) {
  return (v ?? "").toString().trim();
}

function buildICS(params: {
  title: string;
  description?: string;
  location?: string;
  startISO: string;
  endISO: string;
  uid: string;
}) {
  const start = new Date(params.startISO);
  const end = new Date(params.endISO);

  const dtStart = toICSDateUTC(start);
  const dtEnd = toICSDateUTC(end);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Citaya//Reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTAMP:${toICSDateUTC(new Date())}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${params.title.replace(/\n/g, " ")}`,
    params.location ? `LOCATION:${params.location.replace(/\n/g, " ")}` : "",
    params.description ? `DESCRIPTION:${params.description.replace(/\n/g, " ")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n");
}

export default function ConfirmacionPage() {
  return (
    <Suspense fallback={<ConfirmacionFallback />}>
      <ConfirmacionInner />
    </Suspense>
  );
}

function ConfirmacionFallback() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto w-full max-w-[560px] px-4 py-10 font-[system-ui]">
        <div className="rounded-3xl border bg-white/80 p-6 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-2xl bg-muted/60 animate-pulse" />
            <div>
              <div className="h-5 w-40 rounded bg-muted/60 animate-pulse" />
              <div className="mt-2 h-4 w-64 rounded bg-muted/50 animate-pulse" />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="h-10 rounded-2xl bg-muted/50 animate-pulse" />
            <div className="h-28 rounded-2xl bg-muted/50 animate-pulse" />
            <div className="h-12 rounded-2xl bg-muted/50 animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

function ConfirmacionInner() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";

  const tenantFromQuery = sp.get("tenant") ?? "";
  const host =
    typeof window !== "undefined"
      ? window.location.hostname.split(":")[0].toLowerCase()
      : "";
  const tenantFromSubdomain = host.endsWith(".citaya.online")
    ? host.replace(".citaya.online", "").split(".")[0]
    : "";
  const tenantSlugInitial = tenantFromQuery || tenantFromSubdomain;

  if (!id) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
        <div className="mx-auto w-full max-w-[560px] px-4 py-10 font-[system-ui]">
          <div className="rounded-3xl border bg-white/80 p-6 shadow-sm backdrop-blur">
            <div className="text-lg font-extrabold">⚠️ Link inválido</div>
            <div className="mt-2 text-sm font-semibold text-red-600">
              Falta el id de la cita.
            </div>
          </div>
        </div>
      </main>
    );
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const [appt, setAppt] = useState<Appt | null>(null);

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  const [loadingTenant, setLoadingTenant] = useState(false);
  const [loadingPros, setLoadingPros] = useState(false);

  const [copied, setCopied] = useState(false);

  // 1) Cargar cita por id (source of truth)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(
          `/api/appointments/by-id?id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );

        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? `Error cargando cita (${res.status})`);
        }

        if (!cancelled) setAppt(json.appointment as Appt);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "No se pudo cargar la cita");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // 2) Resolver tenant: preferimos slug (si existe), si no, intentamos por appt.tenant_id
  useEffect(() => {
    let cancelled = false;

    async function loadTenantBySlug(slug: string) {
      const res = await fetch(
        `/api/tenants/by-slug?slug=${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar tenant");
      return json?.tenant ?? null;
    }

    async function loadTenantById(tenantId: string) {
      const res = await fetch(
        `/api/tenants/by-id?id=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar tenant");
      return json?.tenant ?? null;
    }

    (async () => {
      try {
        setLoadingTenant(true);

        if (tenantSlugInitial) {
          const t = await loadTenantBySlug(tenantSlugInitial);
          if (!cancelled) setTenant(t);
          return;
        }

        const tid = appt?.tenant_id;
        if (tid) {
          try {
            const t = await loadTenantById(tid);
            if (!cancelled) setTenant(t);
          } catch {
            if (!cancelled) setTenant(null);
          }
        }
      } catch {
        if (!cancelled) setTenant(null);
      } finally {
        if (!cancelled) setLoadingTenant(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlugInitial, appt?.tenant_id]);

  // 3) Cargar profesionales por tenantSlug (si existe)
  useEffect(() => {
    const tenantSlug = tenantSlugInitial || tenant?.slug || "";
    if (!tenantSlug) return;

    let cancelled = false;
    setLoadingPros(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/professionals/by-tenant?tenant=${encodeURIComponent(tenantSlug)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(json?.error ?? "No se pudieron cargar profesionales");

        const list = (Array.isArray(json) ? json : []) as Professional[];
        if (!cancelled) setProfessionals(list);
      } catch {
        if (!cancelled) setProfessionals([]);
      } finally {
        if (!cancelled) setLoadingPros(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlugInitial, tenant?.slug]);

  if (error) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
        <div className="mx-auto w-full max-w-[560px] px-4 py-10 font-[system-ui]">
          <div className="rounded-3xl border bg-white/80 p-6 shadow-sm backdrop-blur">
            <div className="text-lg font-extrabold">
              ⚠️ No se pudo cargar la cita
            </div>
            <div className="mt-2 text-sm font-semibold text-red-600">
              {error}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const startLabel = useMemo(
    () => formatStartCL(appt?.start_at ?? ""),
    [appt?.start_at],
  );

  const professionalName = useMemo(() => {
    const proId = appt?.professional_id;
    if (!proId) return "—";
    return professionals.find((p) => p.id === proId)?.name ?? "Profesional";
  }, [appt?.professional_id, professionals]);

  // ✅ Servicio desde la cita (DB): appointments.service_name
  const serviceLabel = useMemo(() => {
    return (appt?.service_name ?? "").trim() || "—";
  }, [appt?.service_name]);

  const durationLabel = useMemo(() => {
    const a = appt?.start_at ? new Date(appt.start_at).getTime() : 0;
    const b = appt?.end_at ? new Date(appt.end_at).getTime() : 0;
    if (a && b && b > a) {
      const mins = Math.round((b - a) / 60000);
      if (mins > 0) return `${mins} min`;
    }
    return "—";
  }, [appt?.start_at, appt?.end_at]);

  const businessName = tenant?.name ?? (loadingTenant ? "Cargando…" : "—");

  const showAddrAfter = tenant?.show_address_after_booking ?? true;
  const showPhoneAfter = tenant?.show_phone_after_booking ?? true;

  const businessAddress = showAddrAfter ? safeText(tenant?.address_display) : "";
  const businessPhone = showPhoneAfter ? (tenant?.phone_display ?? "") : "";
  const businessPhoneE164 = normalizeCLPhoneToE164(businessPhone);

  const waUrl = useMemo(() => {
    if (!businessPhoneE164) return "";

    const msg = encodeURIComponent(
      [
        "Hola 👋, acabo de reservar una cita:",
        "",
        `• Servicio: ${serviceLabel}`,
        `• Fecha/Hora: ${startLabel}`,
        `• Profesional: ${professionalName}`,
        `• Nombre: ${appt?.customer_name ?? "—"}`,
        "",
        "¿Me confirmas por favor? 🙏",
      ].join("\n"),
    );

    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const phoneNoPlus = businessPhoneE164.replace("+", "");

    return isMobile
      ? `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${msg}`
      : `https://web.whatsapp.com/send?phone=${phoneNoPlus}&text=${msg}`;
  }, [businessPhoneE164, appt?.customer_name, professionalName, serviceLabel, startLabel]);

  const canOpenWA = !!waUrl;

  const calendarLinks = useMemo(() => {
    const title = `${businessName} - ${serviceLabel || "Cita"}`;
    const start = appt?.start_at ? new Date(appt.start_at) : null;
    const end = appt?.end_at ? new Date(appt.end_at) : null;
    if (!start || !end) return { gcal: "", icsUrl: "" };

    const startUTC = toICSDateUTC(new Date(start.toISOString()));
    const endUTC = toICSDateUTC(new Date(end.toISOString()));
    const dates = `${startUTC}/${endUTC}`;

    const details = [
      `Servicio: ${serviceLabel}`,
      `Profesional: ${professionalName}`,
      `Cliente: ${appt?.customer_name ?? "—"}`,
      appt?.customer_email ? `Correo: ${appt.customer_email}` : "",
      appt?.customer_phone ? `Tel: ${appt.customer_phone}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const location = businessAddress;

    const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      title,
    )}&dates=${encodeURIComponent(dates)}&details=${encodeURIComponent(
      details,
    )}&location=${encodeURIComponent(location)}`;

    const ics = buildICS({
      title,
      description: details,
      location: location || undefined,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      uid: `citaya-${appt?.id ?? id}@citaya.online`,
    });

    const icsUrl = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;

    return { gcal, icsUrl };
  }, [
    appt?.id,
    appt?.start_at,
    appt?.end_at,
    appt?.customer_name,
    appt?.customer_email,
    appt?.customer_phone,
    businessName,
    businessAddress,
    id,
    professionalName,
    serviceLabel,
  ]);

  const canCalendar = !!calendarLinks.gcal && !!calendarLinks.icsUrl;

  const detailsToCopy = useMemo(() => {
    return [
      "📌 Detalles de tu reserva",
      `Negocio: ${businessName}`,
      `Servicio: ${serviceLabel} (${durationLabel})`,
      `Profesional: ${professionalName}`,
      `Fecha/Hora: ${startLabel}`,
      appt?.customer_name ? `Cliente: ${appt.customer_name}` : "",
      appt?.customer_email ? `Correo: ${appt.customer_email}` : "",
      appt?.customer_phone ? `Celular: ${appt.customer_phone}` : "",
      businessAddress ? `Dirección: ${businessAddress}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    appt?.customer_email,
    appt?.customer_name,
    appt?.customer_phone,
    businessName,
    businessAddress,
    durationLabel,
    professionalName,
    serviceLabel,
    startLabel,
  ]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(detailsToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = detailsToCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      } catch {}
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto w-full max-w-[560px] px-4 py-10 font-[system-ui]">
        <div className="rounded-3xl border bg-white/80 p-6 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                <BadgeCheck className="h-5 w-5" />
              </div>

              <div>
                <div className="text-xl font-extrabold leading-tight">
                  ¡Reserva confirmada!
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Guarda estos detalles. Si necesitas cambios, podrás gestionarlo
                  desde el correo.
                </div>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-2 rounded-2xl border bg-white/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              <span>Confirmación segura</span>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-muted-foreground">
              Cargando detalles de tu cita…
            </div>
          ) : null}
        </div>

        <section className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm text-emerald-900/80">Resumen</div>
              <div className="mt-1 text-lg font-extrabold text-emerald-950">
                {serviceLabel}
              </div>
              <div className="mt-1 text-sm text-emerald-950/70">
                {startLabel} · {durationLabel}
              </div>
            </div>

            <button
              type="button"
              onClick={onCopy}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border bg-white/70 px-3 py-2 text-xs font-extrabold transition hover:bg-white",
                copied && "border-emerald-400",
              )}
            >
              <Copy className="h-4 w-4" />
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 text-sm">
            <Row label="Negocio" value={businessName} />
            <Row
              label="Profesional"
              value={loadingPros ? "Cargando…" : professionalName}
            />
            <Row
              label="Servicio"
              value={`${serviceLabel}${durationLabel !== "—" ? ` · ${durationLabel}` : ""}`}
            />
            <Row label="Cliente" value={appt?.customer_name ?? "—"} />
            <Row label="Correo" value={appt?.customer_email ?? "—"} />
            <Row label="Celular" value={appt?.customer_phone ?? "—"} />
            {businessAddress ? <Row label="Dirección" value={businessAddress} /> : null}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <a
              href={canCalendar ? calendarLinks.gcal : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!canCalendar}
              onClick={(e) => {
                if (!canCalendar) e.preventDefault();
              }}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold transition",
                canCalendar
                  ? "bg-foreground text-background hover:opacity-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              <CalendarPlus className="h-4 w-4" />
              Agregar a Google Calendar
            </a>

            <a
              href={canCalendar ? calendarLinks.icsUrl : undefined}
              download={`cita-${formatDateYMD(new Date(appt?.start_at ?? Date.now()))}.ics`}
              aria-disabled={!canCalendar}
              onClick={(e) => {
                if (!canCalendar) e.preventDefault();
              }}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-2xl border bg-white/70 px-4 py-3 text-sm font-extrabold transition hover:bg-white",
                !canCalendar && "cursor-not-allowed opacity-60 hover:bg-white/70",
              )}
            >
              <CalendarPlus className="h-4 w-4" />
              Descargar .ics
            </a>

            <a
              href={canOpenWA ? waUrl : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!canOpenWA}
              onClick={(e) => {
                if (!canOpenWA) e.preventDefault();
              }}
              className={cn(
                "sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold transition",
                canOpenWA
                  ? "bg-emerald-700 text-white hover:opacity-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              <MessageCircle className="h-4 w-4" />
              Abrir WhatsApp (opcional)
            </a>

            {!canOpenWA ? (
              <div className="sm:col-span-2 text-xs text-emerald-950/70">
                No se pudo generar el link de WhatsApp (falta teléfono válido del
                negocio o el negocio ocultó su teléfono).
              </div>
            ) : !businessPhoneE164 ? (
              <div className="sm:col-span-2 text-xs text-emerald-950/70">
                WhatsApp requiere un teléfono del negocio válido.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-white/60 px-4 py-3">
      <div className="text-xs font-extrabold text-emerald-950/70">{label}</div>
      <div className="text-right text-sm font-semibold text-emerald-950">
        {value}
      </div>
    </div>
  );
}
