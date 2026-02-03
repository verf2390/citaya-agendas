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

export default async function TenantHome({
  params,
}: {
  params: { slug?: string };
}) {
  const supabase = supabaseServer;

  const h = await headers();
  const host = h.get("host") ?? "";
  const slugFromHost = getSubdomainSlugFromHost(host);

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
      "id, slug, name, address, city, phone_display, description, show_address, show_phone",
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

  // ✅ Multi-professional por empresa (para credibilidad en la home)
  const { data: professionals } = await supabase
    .from("professionals")
    .select("id, name, active")
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
            {/* Lado izquierdo: marca + copy */}
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Reserva online
              </div>

              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                {tenant.name}
              </h1>

              <p className="mt-2 text-base font-semibold text-slate-700">
                Reserva tu hora en segundos
              </p>

              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
                {tenant.description ??
                  "Elige un servicio y un horario disponible. Confirmación inmediata por correo y enlace privado para gestionar tu cita."}
              </p>

              {/* ✅ Mostrar u ocultar datos según configuración del tenant */}
              {(showAddress || showPhone) && (
                <div className="mt-4 space-y-1 text-sm text-slate-700">
                  {showAddress && (tenant.address || tenant.city) && (
                    <p>
                      {tenant.address ?? ""}
                      {tenant.city ? ` · ${tenant.city}` : ""}
                    </p>
                  )}
                  {showPhone && tenant.phone_display && (
                    <p>📞 {tenant.phone_display}</p>
                  )}
                </div>
              )}

              {/* ✅ CTA grande arriba (único CTA fuerte) */}
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

            {/* Lado derecho: banner/credibilidad */}
            <div className="w-full md:w-[360px]">
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-100 to-white shadow-sm">
                <div className="p-5">
                  <div className="text-xs font-semibold text-slate-600">
                    Atención profesional
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    Agenda sin llamadas y con horarios reales disponibles.
                  </div>

                  {/* “Reseñas” demo */}
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
                      <div className="text-xs text-slate-500">
                        (Clientes felices)
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      * Demo (luego lo conectamos a reseñas reales si quieres)
                    </div>
                  </div>

                  {/* Profesionales (multi-professional por tenant) */}
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs font-semibold text-slate-600">
                      Profesionales
                    </div>

                    {professionals?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {professionals.slice(0, 6).map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            {p.name}
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

            {/* ❌ Quitamos el botón duplicado del header */}
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

          {/* Nota política (simple) */}
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <b>Política:</b> puedes reagendar o cancelar con al menos <b>3 horas</b> de anticipación
            desde el enlace privado que llega al correo.
          </div>
        </div>
      </section>
    </main>
  );
}
