import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";

type DemoTenantRow = {
  id: string;
  slug: string;
  tenant_id: string;
  brand_name: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  primary_color: string | null;
  logo_url: string | null;
  is_active: boolean;
};

type TenantCore = {
  id: string;
  slug: string | null;
  name: string | null;
  logo_url: string | null;
  description: string | null;
};

type DemoService = {
  id: string;
  name: string | null;
  duration_min: number | null;
  price: number | null;
};

type DemoProfessional = {
  id: string;
  full_name: string | null;
};

async function getDemoBySlug(slug: string) {
  const sb = supabaseServer;

  const { data: demo, error: dErr } = await sb
    .from("demo_tenants")
    .select(
      "id, slug, tenant_id, brand_name, hero_title, hero_subtitle, primary_color, logo_url, is_active"
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (dErr) throw dErr;
  if (!demo?.tenant_id) return null;

  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, slug, name, logo_url, description")
    .eq("id", demo.tenant_id)
    .maybeSingle();

  if (tErr) throw tErr;
  if (!tenant?.id) return null;

  const { data: services, error: sErr } = await sb
    .from("services")
    .select("id, name, duration_min, price")
    .eq("tenant_id", tenant.id)
    .order("name", { ascending: true });

  if (sErr) throw sErr;

  const { data: professionals, error: pErr } = await sb
    .from("professionals")
    .select("id, full_name")
    .eq("tenant_id", tenant.id)
    .order("full_name", { ascending: true });

  if (pErr) throw pErr;

  return {
    demo: demo as DemoTenantRow,
    tenant: tenant as TenantCore,
    services: (services ?? []) as DemoService[],
    professionals: (professionals ?? []) as DemoProfessional[],
  };
}

export default async function DemoLandingPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = params.slug;

  const payload = await getDemoBySlug(slug);
  if (!payload) return notFound();

  const { demo, tenant, services, professionals } = payload;

  const brandName = demo.brand_name ?? tenant.name ?? "Tu negocio";
  const primaryColor = demo.primary_color ?? "#111827";
  const logoUrl = demo.logo_url ?? tenant.logo_url ?? null;
  const businessDescription =
    tenant.description ??
    "Agenda online activa 24/7 para recibir reservas de forma simple y profesional.";

  const reserveHref = `/demo/${slug}/reservar`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              DEMO · Citaya Pro
            </div>

            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={brandName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                    Logo
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-600">{brandName}</p>
                <h1 className="mt-2 max-w-3xl text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                  Así recibirías reservas automáticamente en tu negocio
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                  Tus clientes eligen horario, tú solo atiendes. Agenda online
                  activa 24/7 con confirmación automática y una experiencia
                  simple desde el celular.
                </p>
                <p className="mt-3 text-sm font-medium text-slate-500">
                  Disponible hoy • Sin instalación compleja
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={reserveHref}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:scale-[1.01] active:scale-[0.99] sm:w-auto"
                style={{ backgroundColor: primaryColor }}
              >
                Probar agenda en vivo
              </Link>

              <Link
                href="#servicios"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition duration-200 hover:bg-slate-50 active:scale-[0.99] sm:w-auto"
              >
                Ver ejemplo
              </Link>
            </div>

            <div className="mt-3 space-y-1 text-sm text-slate-500">
              <p>Sistema probado con reservas reales.</p>
              <p>En menos de 1 minuto puedes ver cómo funciona.</p>
            </div>

            <div className="mt-6 rounded-3xl border border-amber-100 bg-amber-50/70 p-4">
              <p className="text-sm font-semibold text-slate-900">¿Te pasa esto?</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                <li>• Respondes mensajes todo el día</li>
                <li>• Pierdes clientes por no contestar rápido</li>
                <li>• Tu agenda está desordenada</li>
              </ul>
              <p className="mt-3 text-sm font-medium text-slate-900">
                Esto se soluciona automáticamente 👇
              </p>
            </div>
          </div>

          <aside className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Qué incluye</p>

            <div className="mt-4 space-y-3">
              {[
                "Clientes pueden reservar 24/7",
                "Confirmación automática después de reservar",
                "Servicios + profesionales en una sola agenda",
                "Experiencia clara y cómoda desde celular",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Tu marca aquí</p>
              <p className="mt-2">
                Logo, servicios, equipo y textos adaptados a tu negocio.
              </p>
              <p className="mt-2">{businessDescription}</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              Vista previa real
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Así se vería la experiencia para tus clientes
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Esta demo usa datos reales del tenant para mostrar cómo se presenta
              tu negocio antes de entrar a reservar.
            </p>
          </div>

          <Link
            href={reserveHref}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition duration-200 hover:scale-[1.01] hover:bg-slate-800 active:scale-[0.99]"
          >
            Ir a reservar ahora
          </Link>
        </div>
      </section>

      <section id="servicios" className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Servicios
          </h2>
          <p className="text-sm leading-6 text-slate-600 sm:text-base">
            Ejemplo personalizable para cualquier rubro: barbería, estética,
            kinesiología, consultas, clases y más.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {services.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
              No hay servicios cargados para este tenant demo.
            </div>
          ) : (
            services.map((s) => (
              <div
                key={s.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="text-base font-semibold text-slate-900">
                  {s.name ?? "Servicio"}
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>
                    {s.duration_min
                      ? `Duración: ${s.duration_min} min`
                      : "Duración configurable"}
                  </p>
                  <p>
                    {typeof s.price === "number"
                      ? `Precio: $${s.price}`
                      : "Precio configurable"}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Profesionales / Equipo
          </h2>
          <p className="text-sm leading-6 text-slate-600 sm:text-base">
            Se adapta a negocios con una o varias personas atendiendo.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {professionals.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
              No hay profesionales cargados para este tenant demo.
            </div>
          ) : (
            professionals.map((p) => (
              <span
                key={p.id}
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                {p.full_name ?? "Profesional"}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 shadow-sm sm:p-8">
        <div className="text-base font-semibold text-slate-900">Nota</div>
        <div className="mt-2 max-w-3xl leading-7">
          Esta demo permite probar el flujo real de Citaya para que veas cómo
          reservarían tus clientes en tu propio negocio, con tu marca, tus
          servicios y tu equipo.
        </div>

        <div className="mt-5">
          <Link
            href={reserveHref}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:scale-[1.01] active:scale-[0.99] sm:w-auto"
            style={{ backgroundColor: primaryColor }}
          >
            Ver reserva real ahora
          </Link>
        </div>
      </section>
    </main>
  );
}