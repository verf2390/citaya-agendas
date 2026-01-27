// app/tenants/[slug]/page.tsx
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

  console.log("[tenant-page] host:", host);
  console.log("[tenant-page] params.slug:", params?.slug);
  console.log("[tenant-page] slug(final):", slug);

  if (!slug) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-sm border p-6">
          <h1 className="text-xl font-semibold">Tenant no encontrado</h1>
          <p className="text-gray-600 mt-2">
            No pude resolver el slug desde la URL.
          </p>
        </div>
      </main>
    );
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, slug, name, address, city, phone_display")
    .eq("slug", slug)
    .single();

  if (tenantErr || !tenant) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-sm border p-6">
          <h1 className="text-xl font-semibold">Tenant no encontrado</h1>
          <p className="text-gray-600 mt-2">
            Revisa el subdominio o el slug en la tabla <b>tenants</b>.
          </p>
        </div>
      </main>
    );
  }

  const { data: services } = await supabase
    .from("services")
    .select("id, name, duration_min, price, currency")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-3xl font-bold tracking-tight">{tenant.name}</h1>

          <div className="mt-4 space-y-1 text-gray-700">
            {(tenant.address || tenant.city) && (
              <p>
                {tenant.address ?? ""}
                {tenant.city ? ` · ${tenant.city}` : ""}
              </p>
            )}
            {tenant.phone_display && <p>📞 {tenant.phone_display}</p>}
          </div>

          <p className="mt-4 text-sm text-gray-500">
            Reserva tu hora en segundos. Confirmación inmediata por correo.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl bg-white shadow-sm border p-6">
          <h2 className="text-xl font-semibold">Servicios</h2>
          <p className="text-sm text-gray-500 mt-1">
            Elige un servicio para ver disponibilidad.
          </p>

          {!services?.length ? (
            <div className="mt-6 rounded-xl border bg-gray-50 p-4">
              <p className="text-gray-700 font-medium">
                No hay servicios configurados aún.
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Crea al menos 1 registro en la tabla <b>services</b> para este
                tenant.
              </p>
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {services.map((s) => (
                <li
                  key={s.id}
                  className="rounded-xl border p-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-sm text-gray-600">
                      {s.duration_min} min
                      {s.price ? ` · $${s.price} ${s.currency}` : ""}
                    </p>
                  </div>

                  <a
                    href={`/reservar?tenant=${tenant.slug}&service=${s.id}`}
		    className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
		  >
                     Reservar
                   </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
