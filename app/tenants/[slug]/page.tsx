// app/tenants/[slug]/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";

const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);

function getSubdomainSlugFromHost(host: string) {
  const cleanHost = (host || "").split(":")[0]; // quita puerto
  const parts = cleanHost.split(".");
  if (parts.length < 3) return null; // ej: citaya.online (sin subdominio)
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

function DemoLanding() {
  return (
    <main className="min-h-screen bg-slate-50">
      {/* Fondo suave */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl" />
        <div className="absolute -bottom-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/35 via-slate-100/20 to-emerald-100/25 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-[980px] px-4 pb-16 pt-10 sm:pt-14">
        <section className="rounded-3xl border border-slate-200 bg-white/85 shadow-sm backdrop-blur">
          <div className="p-6 sm:p-10">
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  DEMO · Citaya Pro
                </div>

                <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                  Así se vería la agenda online de tu negocio
                </h1>

                <p className="mt-2 text-base font-semibold text-slate-700">
                  Profesional · Automática · 24/7
                </p>

                <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600">
                  Este demo te permite ver la experiencia completa: elegir
                  servicio, ver horarios reales, reservar y recibir confirmación.
                  Sin login.
                </p>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/reservar"
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-6 py-4 text-base font-extrabold text-white shadow-sm hover:opacity-90 active:scale-[0.99] sm:w-auto"
                  >
                    Probar demo ahora
                  </Link>

                  <Link
                    href="https://citaya.online"
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-4 text-base font-extrabold text-slate-900 hover:bg-slate-50 sm:w-auto"
                  >
                    Volver
                  </Link>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  * Datos de ejemplo. La app real usa tu logo, tus servicios y tu
                  configuración.
                </p>
              </div>

              <div className="w-full sm:w-[360px]">
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-100 to-white shadow-sm">
                  <div className="p-5">
                    <div className="text-xs font-semibold text-slate-600">
                      Qué incluye
                    </div>

                    <ul className="mt-3 grid gap-2 text-sm text-slate-700">
                      <li className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        ✅ Servicios + profesionales
                      </li>
                      <li className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        ✅ Horarios reales por disponibilidad
                      </li>
                      <li className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        ✅ Confirmación + link privado
                      </li>
                    </ul>

                    <div className="mt-4 text-[11px] text-slate-500">
                      Si quieres, luego hacemos una versión con tu marca y tus
                      textos.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mini testimonios (opcionales) */}
            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                {
                  name: "María",
                  text: "Reservé en 30 segundos. Se siente súper pro.",
                },
                {
                  name: "Camila",
                  text: "Me llegó el correo y pude reagendar sin hablar con nadie.",
                },
                {
                  name: "Daniela",
                  text: "Así debería ser cualquier agenda online.",
                },
              ].map((t) => (
                <div
                  key={t.name}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-xs font-extrabold text-white">
                      {t.name.slice(0, 1)}
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {t.name}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">“{t.text}”</p>
                </div>
              ))}
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

  // ✅ si estamos en demo (por subdominio o por /tenants/demo) -> landing demo bonita
  if (slugFromHost === "demo" || params?.slug === "demo") {
    return <DemoLanding />;
  }

  // fallback: si alguna vez llega params.slug, lo usamos; si no, usamos subdominio
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

  const firstServiceId = services?.[0]?.id ?? null;

  const ctaHref = firstServiceId
    ? `/reservar?tenant=${encodeURIComponent(
        tenant.slug,
      )}&service=${encodeURIComponent(firstServiceId)}`
    : `/reservar?tenant=${encodeURIComponent(tenant.slug)}`;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Fondo suave */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl" />
        <div className="absolute -bottom-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/35 via-slate-100/20 to-emerald-100/25 blur-3xl" />
      </div>

      <header className="border-b bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Reserva online
              </div>

              <div className="mt-4 flex items-center gap-3">
                {tenant.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
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
                    <p>
                      {tenant.address ?? ""}
                      {tenant.city ? ` · ${tenant.city}` : ""}
                    </p>
                  )}
                  {showPhone && tenant.phone_display && <p>📞 {tenant.phone_display}</p>}
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
                  Confirmación inmediata · enlace privado para modificar/cancelar
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
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex items-center">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <span key={i} className="text-slate-900" aria-hidden="true">
                            ★
                          </span>
                        ))}
                      </div>
                      <div className="text-xs font-semibold text-slate-700">
                        5.0
                      </div>
                      <div className="text-xs text-slate-500">(Clientes felices)</div>
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
                              // eslint-disable-next-line @next/next/no-img-element
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
                            <span>{p.name}</span>
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
            {/* /banner */}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-3xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">Servicios</h2>
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
                Crea al menos 1 registro en la tabla <b>services</b> para este tenant.
              </p>
            </div>
          ) : (
            <ul className="mt-6 grid gap-3">
              {services.map((s) => {
                const durationText =
                  typeof s.duration_min === "number" ? `${s.duration_min} min` : null;

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
            <b>Política:</b> puedes reagendar o cancelar con al menos <b>3 horas</b> de
            anticipación desde el enlace privado que llega al correo.
          </div>
        </div>
      </section>
    </main>
  );
}
