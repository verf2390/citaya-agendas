import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import DemoQuoteSection from "./DemoQuoteSection";

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
  const heroTitle = demo.hero_title ?? "Así se vería tu agenda online";
  const heroSubtitle =
    demo.hero_subtitle ??
    "Logo, servicios, profesionales y reservas en un solo lugar.";
  const primaryColor = demo.primary_color ?? "#111827";
  const logoUrl = demo.logo_url ?? tenant.logo_url ?? null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-14 w-14 overflow-hidden rounded-2xl border bg-white">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brandName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
              Logo
            </div>
          )}
        </div>

        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{brandName}</h1>
          <p className="text-sm text-gray-600">{heroTitle}</p>
          <p className="mt-1 text-sm text-gray-500">{heroSubtitle}</p>
        </div>

        <Link
          href={`/demo/${slug}/reservar`}
          className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow"
          style={{ backgroundColor: primaryColor }}
        >
          Probar agenda
        </Link>
      </div>

      {/* Cotizador */}
      <DemoQuoteSection
        whatsappNumber="56961425029"
        primaryColor={primaryColor}
      />

      {/* Servicios */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Servicios</h2>
        <p className="mt-1 text-sm text-gray-600">
          Ejemplo personalizable para cualquier rubro.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.length === 0 ? (
            <div className="rounded-2xl border p-4 text-sm text-gray-600">
              No hay servicios cargados para este tenant demo.
            </div>
          ) : (
            services.map((s) => (
              <div key={s.id} className="rounded-2xl border p-4">
                <div className="text-sm font-semibold">
                  {s.name ?? "Servicio"}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  {s.duration_min
                    ? `${s.duration_min} min`
                    : "Duración configurable"}
                  {typeof s.price === "number" ? ` • $${s.price}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Profesionales */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Profesionales / Equipo</h2>
        <p className="mt-1 text-sm text-gray-600">
          Se adapta a clínicas, salones, asesorías, clases, etc.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {professionals.length === 0 ? (
            <div className="rounded-2xl border p-4 text-sm text-gray-600">
              No hay profesionales cargados para este tenant demo.
            </div>
          ) : (
            professionals.map((p) => (
              <span key={p.id} className="rounded-full border px-3 py-1 text-sm">
                {p.full_name ?? "Profesional"}
              </span>
            ))
          )}
        </div>
      </section>

      {/* Nota demo */}
      <section className="mt-10 rounded-2xl border bg-gray-50 p-4 text-sm text-gray-700">
        <div className="font-semibold">Nota</div>
        <div className="mt-1">
          Esta demo permite probar el flujo real de Citaya y además estimar el
          valor de implementación y mensualidad según el tamaño de tu equipo.
        </div>
      </section>
    </main>
  );
}