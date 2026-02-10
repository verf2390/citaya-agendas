import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRole) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

// sanity check simple: service role suele ser bastante larga
if (serviceRole.length < 60) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY parece inválida (muy corta)");
}

export const supabaseAdmin = createClient(url, serviceRole, {
  auth: { persistSession: false },
});
