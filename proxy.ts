import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const pathname = url.pathname;

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  // SSR client (para mantener tu auth de /admin)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // === 1) PROTEGER /admin ===
  if (pathname.startsWith("/admin")) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const loginUrl = url.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Ignorar assets/api
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return response;
  }

  // === 2) SWITCH SaaS por subdominio (rewrite) ===
  const host = request.headers.get("host") || "";
  const hostNoPort = host.split(":")[0]; // saca puerto si existe
  const parts = hostNoPort.split(".");

  // Necesitamos que sea un host con subdominio real, ej: paola.citaya.online (3+ partes)
  if (parts.length < 3) return response;

  const subdomain = parts[0];

  // Si es subdominio reservado, no tocar
  if (!subdomain || RESERVED.has(subdomain)) return response;

  // Si ya estás dentro de /tenants/<slug>, no re-reescribir (evita loops)
  if (pathname.startsWith("/tenants/")) return response;

  // ✅ Reescribe a /tenants/<slug> + path
  const rewriteUrl = url.clone();
  rewriteUrl.pathname = `/tenants/${subdomain}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: ["/:path*"],
};
