import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseAdminClient = SupabaseClient;

if (typeof window !== "undefined") {
  throw new Error("supabaseAdmin is server-only and cannot run in a browser");
}

let adminClient: SupabaseAdminClient | null = null;

function getSupabaseAdminClient(): SupabaseAdminClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) {
    throw new Error(
      "Cannot initialize supabaseAdmin: missing NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  if (!serviceRole) {
    throw new Error(
      "Cannot initialize supabaseAdmin: missing SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  // sanity check simple: service role suele ser bastante larga
  if (serviceRole.length < 60) {
    throw new Error(
      "Cannot initialize supabaseAdmin: SUPABASE_SERVICE_ROLE_KEY parece inválida (muy corta)",
    );
  }

  adminClient = createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}

export const supabaseAdmin = new Proxy({} as SupabaseAdminClient, {
  get(_target, property) {
    const client = getSupabaseAdminClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
