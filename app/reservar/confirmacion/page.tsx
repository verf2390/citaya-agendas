"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck } from "lucide-react";

type Appt = {
  id: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  professional_id: string;
  tenant_id: string;
  service_id?: string | null;
};

type Tenant = {
  id: string;
  slug: string;
  name: string;
  phone_display: string | null;
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

  // si ya viene +56...
  if (raw.startsWith("+")) {
    const digits = raw.replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }

  const digits = raw.replace(/\D/g, "");

  // casos típicos Chile
  if (digits.startsWith("569") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length >= 9) return `+56${digits}`;

  // fallback: si es largo, lo intento igual
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
      <div className="mx-auto w-full max-w-[520px] px-4 py-10 font-[system-ui]">
        <div className="rounded-2xl border bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="text-lg font-extrabold">Cargando…</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Estamos preparando los detalles de tu cita.
          </div>
          <div className="mt-4 h-10 rounded-xl bg-muted/50 animate-pulse" />
          <div className="mt-2 h-24 rounded-xl bg-muted/50 animate-pulse" />
        </div>
      </div>
    </main>
  );
}

function ConfirmacionInner() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";

  // tenant por query o subdominio *.citaya.online
  const tenantFromQuery = sp.get("tenant") ?? "";
  const host =
    typeof window !== "undefined"
      ? window.location.hostname.split(":")[0].toLowerCase()
      : "";
  const tenantFromSubdomain = host.endsWith(".citaya.online")
    ? host.replace(".citaya.online", "").split(".")[0]
    : "";
  const tenantSlug = tenantFromQuery || tenantFromSubdomain;

  // 🚫 Sin id = link inválido
  if (!id) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
        <div className="mx-auto w-full max-w-[520px] px-4 py-10 font-[system-ui]">
          <div className="rounded-2xl border bg-white/80 p-5 shadow-sm backdrop-blur">
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

  // 1) Cargar cita por id
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

  // 2) Cargar tenant por slug (para nombre y teléfono del negocio)
  useEffect(() => {
    if (!tenantSlug) return;

    let cancelled = false;
    setLoadingTenant(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/tenants/by-slug?slug=${encodeURIComponent(tenantSlug)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => null);

        if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar tenant");

        if (!cancelled) setTenant(json?.tenant ?? null);
      } catch (e) {
        // si falla, no bloqueamos la confirmación; solo no mostramos nombre/WA del negocio
        if (!cancelled) setTenant(null);
      } finally {
        if (!cancelled) setLoadingTenant(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // 3) Cargar profesionales por tenant (para resolver appt.professional_id -> nombre)
  useEffect(() => {
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
        if (!res.ok) throw new Error(json?.error ?? "No se pudieron cargar profesionales");

        const list = (Array.isArray(json) ? json : []) as Professional[];
        if (!cancelled) setProfessionals(list);
      } catch (e) {
        if (!cancelled) setProfessionals([]);
      } finally {
        if (!cancelled) setLoadingPros(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // 🚫 Error cargando cita
  if (error) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
        <div className="mx-auto w-full max-w-[520px] px-4 py-10 font-[system-ui]">
          <div className="rounded-2xl border bg-white/80 p-5 shadow-sm backdrop-blur">
            <div className="text-lg font-extrabold">⚠️ No se pudo cargar la cita</div>
            <div className="mt-2 text-sm font-semibold text-red-600">{error}</div>
          </div>
        </div>
      </main>
    );
  }

  const startLabel = useMemo(() => formatStartCL(appt?.start_at ?? ""), [appt?.start_at]);

  // ✅ profesional real desde professionals[] + appt.professional_id
  const professionalName = useMemo(() => {
    const proId = appt?.professional_id;
    if (!proId) return "—";
    return professionals.find((p) => p.id === proId)?.name ?? "Profesional";
  }, [appt?.professional_id, professionals]);

  // ✅ WhatsApp al negocio (tenant.phone_display)
  const waUrl = useMemo(() => {
    const businessPhone = tenant?.phone_display ?? "";
    const e164 = normalizeCLPhoneToE164(businessPhone);
    if (!e164) return "";

    const msg = encodeURIComponent(
      "Hola, acabo de reservar una cita. ¿Me confirmas por favor?",
    );

    const isMobile =
      typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // WhatsApp espera sin "+" normalmente, pero funciona con ambos; usamos sin "+"
    const phoneNoPlus = e164.replace("+", "");

    return isMobile
      ? `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${msg}`
      : `https://web.whatsapp.com/send?phone=${phoneNoPlus}&text=${msg}`;
  }, [tenant?.phone_display]);

  const canOpenWA = !!waUrl;

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto w-full max-w-[520px] px-4 py-10 font-[system-ui]">
        {/* Header */}
        <div className="rounded-2xl border bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5" />
            <div className="text-lg font-extrabold">Reserva registrada</div>
          </div>

          <div className="mt-2 text-sm text-muted-foreground">
            Te enviamos un correo con los detalles de tu cita. Desde ahí podrás cancelarla o
            reagendarla si lo necesitas.
          </div>

          {loading ? (
            <div className="mt-3 text-sm text-muted-foreground">
              Cargando detalles de tu cita…
            </div>
          ) : null}
        </div>

        {/* Card detalles */}
        <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-extrabold">Negocio:</span>{" "}
              <span className="font-medium">{tenant?.name ?? (loadingTenant ? "Cargando…" : "—")}</span>
            </div>

            <div>
              <span className="font-extrabold">Profesional:</span>{" "}
              <span className="font-medium">
                {loadingPros ? "Cargando…" : professionalName}
              </span>
            </div>

            <div>
              <span className="font-extrabold">Fecha/Hora:</span>{" "}
              <span className="font-medium">{startLabel}</span>
            </div>

            <div>
              <span className="font-extrabold">Correo:</span>{" "}
              <span className="font-medium">{appt?.customer_email ?? "—"}</span>
            </div>

            <div>
              <span className="font-extrabold">Celular:</span>{" "}
              <span className="font-medium">{appt?.customer_phone ?? "—"}</span>
            </div>
          </div>

          <div className="mt-4">
            <a
              href={canOpenWA ? waUrl : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!canOpenWA}
              onClick={(e) => {
                if (!canOpenWA) e.preventDefault();
              }}
              className={cn(
                "inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-extrabold transition",
                canOpenWA
                  ? "bg-foreground text-background hover:opacity-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              Abrir WhatsApp (opcional)
            </a>

            {!canOpenWA ? (
              <div className="mt-2 text-xs text-muted-foreground">
                No se pudo generar el link de WhatsApp (falta teléfono válido del negocio).
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
