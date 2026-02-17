// app/demo/[slug]/reservar/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  const sb = supabaseServer;

  const { data: demo, error } = await sb
    .from("demo_tenants")
    .select("tenant_id, is_active")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !demo?.tenant_id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // ✅ Redirige al flujo real
  const url = new URL("/reservar", req.url);
  url.searchParams.set("demo", "1");

  const res = NextResponse.redirect(url);

  res.cookies.set("citaya_demo_tenant", demo.tenant_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 2,
    domain: ".citaya.online", // ✅ clave para subdominios
  });

  return res;
}
