import Link from "next/link";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";
import LeaveReviewModal from "@/components/tenant/LeaveReviewModal";
import DemoQuoteCard from "./DemoQuoteCard";

const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);

function getSubdomainSlugFromHost(host: string) {
  const cleanHost = (host || "").split(":")[0];
  const parts = cleanHost.split(".");
  if (parts.length < 3) return null;
  const sub = parts[0];
  if (!sub || RESERVED.has(sub)) return null;
  return sub;
}

function initialsFromName(name?: string | null) {
  const base = (name ?? "").trim();
  if (!base) return "T";
  return base
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function clampRating(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function StarsInline({ value }: { value: number }) {
  const v = clampRating(value);
  const full = Math.round(v);

  return (
    <div className="flex items-center gap-0.5" aria-label={`Valoración ${v}`}>
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i < full;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={[
              "text-sm leading-none",
              filled ? "text-slate-900" : "text-slate-300",
            ].join(" ")}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}

function DemoLanding() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.12),transparent_36%),linear-gradient(180deg,#e9eef5_0%,#f6f8fb_28%,#eef3f8_100%)]">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-10rem] h-[32rem] w-[62rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(15,23,42,0.22),rgba(15,23,42,0.06)_42%,transparent_72%)] blur-3xl" />
        <div className="absolute right-[-5rem] top-24 h-72 w-72 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="absolute bottom-[-9rem] left-[-5rem] h-80 w-80 rounded-full bg-amber-300/25 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-6 sm:pt-10">
        <section className="overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.95))] shadow-[0_30px_100px_rgba(15,23,42,0.14)] backdrop-blur">
          <div className="relative p-5 sm:p-8 lg:p-10">
            <div className="absolute inset-x-0 top-0 h-44 bg-[linear-gradient(180deg,rgba(15,23,42,0.07),transparent)]" />
            <div className="relative flex flex-col gap-8 lg:gap-10">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_360px] lg:items-start">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-100 shadow-[0_10px_30px_rgba(15,23,42,0.22)]">
                    DEMO · Citaya Pro
                  </div>

                  <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-[4rem] lg:leading-[0.95]">
                    Empieza a recibir reservas automáticas desde hoy
                  </h1>

                  <p className="mt-4 text-lg font-semibold text-slate-700 sm:text-xl">
                    Tus clientes eligen horario, tú solo atiendes
                  </p>

                  <p className="mt-4 inline-flex items-center rounded-full bg-[linear-gradient(180deg,#ecfdf5,#d1fae5)] px-3 py-1 text-sm font-bold text-emerald-800 ring-1 ring-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    Respuestas en menos de 15 minutos
                  </p>

                  <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
                    Esta demo te muestra cómo se vería una agenda online real para
                    tu negocio: reservas 24/7, horarios disponibles, confirmación
                    automática y una experiencia profesional desde el celular.
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/reservar"
                      className="inline-flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#020617_0%,#0f172a_45%,#1e293b_100%)] px-7 py-4 text-base font-extrabold text-white shadow-[0_18px_40px_rgba(15,23,42,0.32)] ring-1 ring-slate-900/20 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_50px_rgba(15,23,42,0.38)] hover:brightness-110 active:translate-y-0 active:scale-[0.985] sm:w-auto"
                    >
                      Ver agenda funcionando en vivo
                    </Link>

                  <Link
                    href="https://citaya-agendas.vercel.app/"
                    className="inline-flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-slate-300/90 bg-white/90 px-6 py-4 text-base font-extrabold text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition duration-200 hover:border-slate-400 hover:bg-white hover:shadow-[0_14px_30px_rgba(15,23,42,0.12)] active:scale-[0.99] sm:w-auto"
                  >
                    Volver a Citaya
                    </Link>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(241,245,249,0.9))] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">
                      Sin compromiso • Sin pago • Demo real
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      En menos de 1 minuto puedes ver cómo funciona
                    </p>
                  </div>

                  <p className="mt-4 text-xs text-slate-500">
                    * Datos de ejemplo. La app real usa tu logo, tus servicios y
                    tu configuración.
                  </p>
                </div>

                <div className="w-full md:w-[360px]">
                  <div className="overflow-hidden rounded-[28px] border border-slate-800/10 bg-[linear-gradient(180deg,#020617_0%,#0f172a_18%,#f8fafc_18%,#ffffff_100%)] shadow-[0_28px_60px_rgba(15,23,42,0.18)]">
                    <div className="p-5 sm:p-6">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
                        Qué incluye
                      </div>

                      <ul className="mt-5 grid gap-3 text-sm text-slate-700">
                        <li className="rounded-2xl border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                          ✅ Clientes pueden reservar 24/7
                        </li>
                        <li className="rounded-2xl border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                          ✅ Confirmación automática después de reservar
                        </li>
                        <li className="rounded-2xl border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                          ✅ Horarios reales según disponibilidad
                        </li>
                      </ul>

                      <div className="mt-5 rounded-2xl border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 text-[11px] leading-relaxed text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                        Luego hacemos esta misma versión con tu logo, tus
                        servicios y tus textos.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[28px] border border-amber-200/80 bg-[linear-gradient(180deg,#fff8eb_0%,#fff3db_100%)] p-5 shadow-[0_18px_40px_rgba(180,83,9,0.10)] sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">
                  ¿Te pasa esto?
                </p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700">
                  <li className="rounded-2xl border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,251,235,0.85))] px-4 py-3 shadow-[0_8px_20px_rgba(180,83,9,0.08)] ring-1 ring-amber-100">
                    • Respondes mensajes todo el día
                  </li>
                  <li className="rounded-2xl border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,251,235,0.85))] px-4 py-3 shadow-[0_8px_20px_rgba(180,83,9,0.08)] ring-1 ring-amber-100">
                    • Pierdes clientes por no contestar rápido
                  </li>
                  <li className="rounded-2xl border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,251,235,0.85))] px-4 py-3 shadow-[0_8px_20px_rgba(180,83,9,0.08)] ring-1 ring-amber-100">
                    • Tu agenda está desordenada
                  </li>
                </ul>
                <p className="mt-4 text-base font-bold text-slate-900">
                  Esto se soluciona automáticamente 👇
                </p>
              </div>

              <div className="rounded-[28px] border border-slate-800/10 bg-[linear-gradient(145deg,#020617_0%,#0f172a_55%,#172554_100%)] p-5 text-white shadow-[0_24px_55px_rgba(15,23,42,0.28)] sm:p-6">
                <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  Caso real
                </div>

                <h2 className="mt-4 text-2xl font-extrabold leading-tight text-white">
                  Negocios reales ya están usando esto
                </h2>

                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  Clientes ya están recibiendo reservas automáticas sin depender
                  de mensajes.
                </p>

                <p className="mt-5 text-sm font-bold text-white">
                  Fajas Paola — La Serena
                </p>

                <p className="mt-1 text-xs text-slate-400">
                  Clientes reales usando este sistema
                </p>

                <a
                  href="https://instagram.com/fajaspaola"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#ffffff_0%,#e2e8f0_100%)] px-5 py-3 text-sm font-extrabold text-slate-950 shadow-[0_12px_28px_rgba(15,23,42,0.22)] transition duration-200 hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:scale-[0.99]"
                >
                  Ver negocio real funcionando
                </a>
              </div>
            </div>

            <div className="mt-10 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,245,249,0.92))] p-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] sm:p-6">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.12em] text-slate-700">
                Primero mira cómo funciona 👇
              </p>

              <DemoQuoteCard />

              <p className="mt-4 text-xs text-slate-500">
                Esto es opcional. Primero prueba la agenda.
              </p>
            </div>

            <div className="mt-10">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    name: "María",
                    text: "Reservé en 30 segundos. Se siente súper pro.",
                  },
                  {
                    name: "Camila",
                    text: "Me llegó la confirmación y pude reagendar sin hablar con nadie.",
                  },
                  {
                    name: "Daniela",
                    text: "Así debería funcionar cualquier agenda online.",
                  },
                ].map((t) => (
                  <div
                    key={t.name}
                    className="rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_14px_32px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/70"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-[linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-xs font-extrabold text-white shadow-[0_10px_20px_rgba(15,23,42,0.25)]">
                        {t.name.slice(0, 1)}
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {t.name}
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-700">
                      “{t.text}”
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default async function TenantHome({
  params,
}: {
  params: { slug?: string };
}) {
  const supabase = supabaseServer;

  const h = await headers();
  const host = h.get("host") ?? "";
  const slugFromHost = getSubdomainSlugFromHost(host);

  if (slugFromHost === "demo" || params?.slug === "demo") {
    return <DemoLanding />;
  }

  const slug = params?.slug ?? slugFromHost;

  if (!slug) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <h1 className="text-xl font-semibold text-slate-900">
            Tenant no encontrado
          </h1>
          <p className="text-slate-600 mt-2">
            No pude resolver el negocio desde la URL.
          </p>
        </div>
      </main>
    );
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select(
      "id, slug, name, logo_url, address, city, phone_display, description, show_address, show_phone",
    )
    .eq("slug", slug)
    .single();

  if (tenantErr || !tenant) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <h1 className="text-xl font-semibold text-slate-900">
            Tenant no encontrado
          </h1>
          <p className="text-slate-600 mt-2">
            Revisa el subdominio o el slug en la tabla <b>tenants</b>.
          </p>
        </div>
      </main>
    );
  }

  const showAddress = tenant.show_address ?? true;
  const showPhone = tenant.show_phone ?? true;

  const { data: services } = await supabase
    .from("services")
    .select("id, name, duration_min, price, currency, is_active")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const { data: professionals } = await supabase
    .from("professionals")
    .select("id, name, active, avatar_url")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("created_at", { ascending: true });

  const { data: reviews } = await supabase
    .from("tenant_reviews")
    .select("id, rating")
    .eq("tenant_id", tenant.id)
    .eq("is_hidden", false);

  const reviewCount = reviews?.length ?? 0;
  const avgRatingRaw =
    reviewCount > 0
      ? (reviews ?? []).reduce((acc, r) => acc + (Number(r.rating) || 0), 0) /
        reviewCount
      : 0;

  const avgRating = Math.round(clampRating(avgRatingRaw) * 10) / 10;

  const firstServiceId = services?.[0]?.id ?? null;

  const ctaHref = firstServiceId
    ? `/reservar?tenant=${encodeURIComponent(
        tenant.slug,
      )}&service=${encodeURIComponent(firstServiceId)}`
    : `/reservar?tenant=${encodeURIComponent(tenant.slug)}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl" />
        <div className="absolute -bottom-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/35 via-slate-100/20 to-emerald-100/25 blur-3xl" />
      </div>

      <header className="border-b bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Reserva online
              </div>

              <div className="mt-4 flex items-center gap-3">
                {tenant.logo_url ? (
                  <img
                    src={tenant.logo_url}
                    alt={`${tenant.name} logo`}
                    className="h-12 w-12 rounded-2xl object-contain border border-slate-200 bg-white p-1"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-2xl grid place-items-center border border-slate-200 bg-slate-50 text-slate-800 font-extrabold">
                    {initialsFromName(tenant.name)}
                  </div>
                )}

                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                  {tenant.name}
                </h1>
              </div>

              <p className="mt-2 text-base font-semibold text-slate-700">
                Reserva tu hora en segundos
              </p>

              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
                {tenant.description ??
                  "Elige un servicio y un horario disponible. Confirmación inmediata por correo y enlace privado para gestionar tu cita."}
              </p>

              {(showAddress || showPhone) && (
                <div className="mt-4 space-y-1 text-sm text-slate-700">
                  {showAddress && (tenant.address || tenant.city) && (
                    <p className="text-slate-700">
                      {tenant.address ?? ""}
                      {tenant.city ? ` · ${tenant.city}` : ""}
                    </p>
                  )}
                  {showPhone && tenant.phone_display && (
                    <p className="text-slate-700">
                      <span className="font-semibold">📞</span>{" "}
                      {tenant.phone_display}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6">
                <Link
                  href={ctaHref}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-4 text-base font-extrabold text-white shadow-sm hover:opacity-90 active:scale-[0.99] sm:w-auto"
                >
                  Reserva ahora
                </Link>
                <p className="mt-2 text-xs text-slate-500">
                  Confirmación inmediata · enlace privado para
                  modificar/cancelar
                </p>
              </div>
            </div>

            <div className="w-full md:w-[360px]">
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-100 to-white shadow-sm">
                <div className="p-5">
                  <div className="text-xs font-semibold text-slate-600">
                    Atención profesional
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    Agenda sin llamadas y con horarios reales disponibles.
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs font-semibold text-slate-600">
                      Valoración
                    </div>
                    <div className="mt-3">
                      <LeaveReviewModal
                        tenantId={tenant.id}
                        businessName={tenant.name}
                      />
                    </div>

                    <div className="mt-1 flex items-center gap-2">
                      <StarsInline value={avgRating || 0} />
                      <div className="text-xs font-semibold text-slate-700">
                        {reviewCount > 0 ? avgRating.toFixed(1) : "—"}
                      </div>
                      <div className="text-xs text-slate-500">
                        (
                        {reviewCount > 0
                          ? `${reviewCount} reseña${
                              reviewCount === 1 ? "" : "s"
                            }`
                          : "Sin reseñas aún"}
                        )
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs font-semibold text-slate-600">
                      Profesionales
                    </div>

                    {professionals?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {professionals.slice(0, 6).map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            {p.avatar_url ? (
                              <img
                                src={p.avatar_url}
                                alt={p.name}
                                className="h-5 w-5 rounded-full object-cover border border-slate-200 bg-white"
                                loading="lazy"
                              />
                            ) : (
                              <span className="h-5 w-5 rounded-full bg-white border border-slate-200 grid place-items-center text-[10px] font-extrabold text-slate-700">
                                {initialsFromName(p.name).slice(0, 1)}
                              </span>
                            )}
                            <span className="max-w-[180px] truncate">
                              {p.name}
                            </span>
                          </span>
                        ))}

                        {professionals.length > 6 ? (
                          <span className="text-xs text-slate-500">
                            +{professionals.length - 6} más
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        (Aún no hay profesionales activos configurados)
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="rounded-3xl bg-white shadow-sm border border-slate-200 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">
                Servicios
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Elige un servicio para ver disponibilidad.
              </p>
            </div>
          </div>

          {!services?.length ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-slate-800 font-semibold">
                No hay servicios configurados aún.
              </p>
              <p className="text-sm text-slate-600 mt-1">
                Crea al menos 1 registro en la tabla <b>services</b> para este
                tenant.
              </p>
            </div>
          ) : (
            <ul className="mt-6 grid gap-3">
              {services.map((s) => {
                const durationText =
                  typeof s.duration_min === "number"
                    ? `${s.duration_min} min`
                    : null;

                const priceText =
                  typeof s.price === "number"
                    ? `$${s.price} ${s.currency ?? ""}`.trim()
                    : null;

                return (
                  <li
                    key={s.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-extrabold text-slate-900">{s.name}</p>

                      {(durationText || priceText) && (
                        <p className="mt-1 text-sm text-slate-600">
                          {durationText}
                          {durationText && priceText ? " · " : ""}
                          {priceText}
                        </p>
                      )}
                    </div>

                    <Link
                      href={`/reservar?tenant=${encodeURIComponent(
                        tenant.slug,
                      )}&service=${encodeURIComponent(s.id)}`}
                      className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:opacity-90 sm:w-auto"
                    >
                      Ver horas
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <b>Política:</b> puedes reagendar o cancelar con al menos{" "}
            <b>3 horas</b> de anticipación desde el enlace privado que llega al
            correo.
          </div>
        </div>
      </section>
    </main>
  );
}
