export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeRut, validateRut } from "@/lib/dte/rut";

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
    const full_name = 
      body.fullName ?? body.name ?? null;
    const phone = cleanPhoneOrNull(body?.phone);
    const email = cleanEmailOrNull(body?.email);
    const notes = cleanTextOrNull(body?.notes);
    const customerRutRaw = cleanTextOrNull(body?.customerRut);
    const customerRut = customerRutRaw && validateRut(customerRutRaw) ? normalizeRut(customerRutRaw) : null;

    // ✅ soporte edición directa (si viene)
    const customerId = typeof body?.customerId === "string" ? body.customerId : null;

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }

    if (!isUuid(tenantId)) {
      return NextResponse.json({ ok: false, error: "tenantId inválido" }, { status: 400 });
    }

    const access = await requireTenantAdmin({ req, tenantId });
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

    if (!customerId && !customerRut) {
      return NextResponse.json({ ok: false, error: "RUT válido requerido" }, { status: 400 });
    }

    if (!full_name) {
      return NextResponse.json({ ok: false, error: "name requerido" }, { status: 400 });
    }

    if (professionalId && !isUuid(professionalId)) {
      return NextResponse.json({ ok: false, error: "professionalId inválido" }, { status: 400 });
    }

    if (!phone && !email) {
      return NextResponse.json({ ok: false, error: "phone o email requerido" }, { status: 400 });
    }

    // ✅ UPDATE directo por ID (edición desde modal)
    if (customerId) {
      if (!isUuid(customerId)) {
        return NextResponse.json({ ok: false, error: "customerId inválido" }, { status: 400 });
      }

      const patch: Record<string, unknown> = {
        full_name,
        phone,
        email,
      };
      if (professionalId) patch.professional_id = professionalId;
      if (notes) patch.notes = notes;
      if (customerRut) patch.rut_normalized = customerRut;

      const { error: upErr } = await supabaseAdmin
        .from("customers")
        .update(patch)
        .eq("id", customerId)
        .eq("tenant_id", tenantId);

      if (upErr) throw upErr;

      return NextResponse.json({ ok: true, customerId, reused: true });
    }

    // 🔥 Usamos SERVICE ROLE SOLO después de validar sesión (token válido)
    let existing: { id: string; phone: string | null; email: string | null; rut_normalized: string | null } | null = null;

    if (customerRut) {
      const { data, error } = await supabaseAdmin
        .from("customers")
        .select("id, phone, email, rut_normalized")
        .eq("tenant_id", tenantId)
        .eq("rut_normalized", customerRut)
        .maybeSingle();
      if (error) throw error;
      if (data) existing = data;
    }

    if (!existing && phone) {
      const { data, error } = await supabaseAdmin
        .from("customers")
        .select("id, phone, email, rut_normalized")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .maybeSingle();

      if (error) throw error;
      if (data) existing = data;
    }

    if (!existing && email) {
      const { data, error } = await supabaseAdmin
        .from("customers")
        .select("id, phone, email, rut_normalized")
        .eq("tenant_id", tenantId)
        .eq("email", email)
        .maybeSingle();

      if (error) throw error;
      if (data) existing = data;
    }

    // update por match (reusar cliente existente)
    if (existing) {
      if (existing.rut_normalized && existing.rut_normalized !== customerRut) {
        return NextResponse.json({ ok: false, error: "Los datos corresponden a otro RUT" }, { status: 409 });
      }
      const patch: Record<string, unknown> = { full_name };
      if (!existing.phone && phone) patch.phone = phone;
      if (!existing.email && email) patch.email = email;
      if (customerRut) patch.rut_normalized = customerRut;
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
        full_name,
        phone,
        email,
        notes,
        rut_normalized: customerRut,
      })
      .select("id")
      .single();

    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, customerId: created.id, reused: false });
  } catch (e: unknown) {
    console.error("[customers/create] error", { name: e instanceof Error ? e.name : "UnknownError" });
    return NextResponse.json(
      { ok: false, error: "Error inesperado" },
      { status: 500 }
    );
  }
}
