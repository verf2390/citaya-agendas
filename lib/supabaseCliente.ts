import { createClient } from "@supabase/supabase-js";

/**
 * Cliente para el FRONTEND (Componentes "use client").
 * Usa ANON KEY, así nunca expones la service role key.
 */
export const supabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
