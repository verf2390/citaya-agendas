export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

function cleanTextOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t : null;
}

function cleanPhoneOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.replace(/[^\d+]/g, "") || null;
}

function cleanEmailOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

export async function POST(req: Request) {
  try {
    /**
     * ✅ GUARD DE SESIÓN (muy importante)
     * OJO: supabaseServer usa SERVICE ROLE, entonces NO tiene sesión/cookies.
     * Para el guard, usamos el header Authorization del request (Bearer <access_token>).
     * En el front, al llamar fetch, debes mandar ese token.
     */
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Validamos token con ANON (no con service role)
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const tenantId = cleanTextOrNull(body?.tenantId);
    const professionalId = cleanTextOrNull(body?.professionalId);
    const full_name = cleanTextOrNull(body?.name); // front manda "name"
    const phone = cleanPhoneOrNull(body?.phone);
    const email = cleanEmailOrNull(body?.email);
    const notes = cleanTextOrNull(body?.notes);

    // ✅ soporte edición directa (si viene)
    const customerId = typeof body?.customerId === "string" ? body.customerId : null;

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }

    if (!full_name) {
      return NextResponse.json({ ok: false, error: "name requerido" }, { status: 400 });
    }

    if (!phone && !email) {
      return NextResponse.json({ ok: false, error: "phone o email requerido" }, { status: 400 });
    }

    // ✅ UPDATE directo por ID (edición desde modal)
    if (customerId) {
      const patch: Record<string, any> = {
        full_name,
        phone,
        email,
      };
      if (professionalId) patch.professional_id = professionalId;
      if (notes) patch.notes = notes;

      const { error: upErr } = await supabaseAdmin
        .from("customers")
        .update(patch)
        .eq("id", customerId)
        .eq("tenant_id", tenantId);

      if (upErr) throw upErr;

      return NextResponse.json({ ok: true, customerId, reused: true });
    }

    // 🔥 Usamos SERVICE ROLE SOLO después de validar sesión (token válido)
    let existing: { id: string; phone: string | null; email: string | null } | null = null;

    if (phone) {
      const { data, error } = await supabaseAdmin
        .from("customers")
        .select("id, phone, email")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .maybeSingle();

      if (error) throw error;
      if (data) existing = data;
    }

    if (!existing && email) {
      const { data, error } = await supabaseAdmin
        .from("customers")
        .select("id, phone, email")
        .eq("tenant_id", tenantId)
        .eq("email", email)
        .maybeSingle();

      if (error) throw error;
      if (data) existing = data;
    }

    // update por match (reusar cliente existente)
    if (existing) {
      const patch: Record<string, any> = { full_name };
      if (!existing.phone && phone) patch.phone = phone;
      if (!existing.email && email) patch.email = email;
      if (professionalId) patch.professional_id = professionalId;
      if (notes) patch.notes = notes;

      const { error: upErr } = await supabaseAdmin
        .from("customers")
        .update(patch)
        .eq("id", existing.id)
        .eq("tenant_id", tenantId);

      if (upErr) throw upErr;

      return NextResponse.json({ ok: true, customerId: existing.id, reused: true });
    }

    // insert
    const { data: created, error: insErr } = await supabaseAdmin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        professional_id: professionalId,
        full_name,
        phone,
        email,
        notes,
      })
      .select("id")
      .single();

    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, customerId: created.id, reused: false });
  } catch (e: any) {
    console.error("[customers/create] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error inesperado" },
      { status: 500 }
    );
  }
}
