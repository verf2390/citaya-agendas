"use client";

import { supabase } from "@/lib/supabaseClient";
import {
  fetchWithClientTimeout,
  withClientTimeout,
} from "@/lib/client/async-timeout";

export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    const { data, error } = await withClientTimeout(
      supabase.auth.getSession(),
    );
    const token = data.session?.access_token;
    if (error || !token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return await fetchWithClientTimeout(input, { ...init, headers });
  } catch {
    return new Response(
      JSON.stringify({
        error: "La solicitud no pudo completarse. Inténtalo nuevamente.",
      }),
      {
        status: 504,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
