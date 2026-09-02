// app/tenants/[slug]/layout.tsx
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";

const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);

function getSubdomainSlugFromHost(host: string) {
  const cleanHost = (host || "").split(":")[0];
  const parts = cleanHost.split(".");
  if (parts.length < 3) return null;
  const sub = parts[0];
  if (!sub || RESERVED.has(sub)) return null;
  return sub;
}

export async function generateMetadata({
  params,
}: {
  params: { slug?: string };
}) {
  const supabase = supabaseServer;

  const h = await headers();
  const host = h.get("host") ?? "";
  const slugFromHost = getSubdomainSlugFromHost(host);

  const slug = params?.slug ?? slugFromHost;

  if (!slug) {
    return {
      title: "Citaya | Agenda",
      description: "Agenda online",
    };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, description")
    .eq("slug", slug)
    .single();

  if (!tenant) {
    return {
      title: "Citaya | Agenda",
      description: "Agenda online",
    };
  }

  return {
    title: `Agenda Citas | ${tenant.name}`,
    description:
      tenant.description ?? `Reserva online en ${tenant.name}`,
  };
}

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
