import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const ROOT_DOMAIN = "citaya.online";

// Subdominios reservados (no son tenants)
const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);

// Paths que NO deben pasar por /tenants/<slug>/...
// (porque son globales o necesarios para que Next funcione bien)
function isGlobalPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/logout" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

// Rutas públicas que NO quieres tenant-scope (ajusta según tu MVP)
function isPublicNonTenantPath(pathname: string) {
  return pathname.startsWith("/reservar");
}

function isIpHost(hostname: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function getSubdomainFromHost(hostNoPort: string) {
  // Solo aplicar para *.citaya.online
  if (!hostNoPort.endsWith(`.${ROOT_DOMAIN}`)) return null;

  const left = hostNoPort.slice(0, -(`.${ROOT_DOMAIN}`.length)); // queda "fajaspaola" o "foo.bar"
  if (!left) return null;

  // Tomamos el primer label como slug principal (futuro: si quieres permitir foo.bar -> slug "foo")
  const sub = left.split(".")[0]?.trim().toLowerCase();
  if (!sub) return null;

  if (RESERVED.has(sub)) return null;

  return sub;
}

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const pathname = url.pathname;

  // Response base (para cookies SSR)
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Ignorar global paths / assets / api / login, etc.
  // ✅ clave: evita que /login se reescriba a /tenants/<slug>/login
  if (isGlobalPath(pathname)) {
    return response;
  }

  // SSR client (para mantener auth en /admin)
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

      // ✅ preserva path + querystring completo
      const redirectTo = pathname + (url.search || "");
      loginUrl.searchParams.set("redirectTo", redirectTo);

      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // === 2) SWITCH SaaS por subdominio (rewrite) ===
  const host = request.headers.get("host") || "";
  const hostNoPort = host.split(":")[0]?.trim().toLowerCase();

  // 🚫 IP o localhost => no aplicar subdominio
  if (!hostNoPort || hostNoPort === "localhost" || isIpHost(hostNoPort)) {
    return response;
  }

  const subdomain = getSubdomainFromHost(hostNoPort);
  if (!subdomain) {
    // app.citaya.online, n8n.citaya.online, etc.
    return response;
  }

  // Evitar loops: si ya estás dentro de /tenants/<slug>, no re-reescribir
  if (pathname.startsWith("/tenants/")) return response;

  // Rutas públicas que NO quieres dentro del esquema /tenants/*
  if (isPublicNonTenantPath(pathname)) return response;

  // ✅ Reescribe a /tenants/<slug> + path
  const rewriteUrl = url.clone();
  rewriteUrl.pathname = `/tenants/${subdomain}${pathname === "/" ? "" : pathname}`;

  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: ["/:path*"],
};
