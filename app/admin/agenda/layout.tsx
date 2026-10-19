import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { supabaseServer } from "@/lib/supabaseServer";

const FALLBACK_TITLE = "Agenda | Citaya";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostname = forwardedHost || requestHeaders.get("host");
  const slug = getTenantSlugFromHostname(hostname);

  if (!slug) return { title: { absolute: FALLBACK_TITLE } };

  try {
    const { data, error } = await supabaseServer
      .from("tenants")
      .select("name")
      .eq("slug", slug)
      .eq("lifecycle_status", "active")
      .maybeSingle();

    const name = typeof data?.name === "string" ? data.name.trim() : "";
    if (error || !name) return { title: { absolute: FALLBACK_TITLE } };

    return { title: { absolute: `Agenda Citas | ${name}` } };
  } catch {
    return { title: { absolute: FALLBACK_TITLE } };
  }
}

export default function AgendaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
