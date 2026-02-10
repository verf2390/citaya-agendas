import { NextResponse } from "next/server";
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
  const norm = t.replace(/[^\d+]/g, "");
  return norm ? norm : null;
}

function cleanEmailOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (!t.includes("@") || !t.includes(".")) return null;
  return t;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const tenantId = cleanTextOrNull(body?.tenantId);
    const professionalId = cleanTextOrNull(body?.professionalId); // opcional
    const name = cleanTextOrNull(body?.name);
    const phone = cleanPhoneOrNull(body?.phone);
    const email = cleanEmailOrNull(body?.email);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ ok: false, error: "name requerido" }, { status: 400 });
    }
    if (!phone && !email) {
      return NextResponse.json(
        { ok: false, error: "phone o email requerido" },
        { status: 400 }
      );
    }

    // ✅ EN TU PROYECTO: supabaseServer ES EL CLIENTE (no función)
    const sb = supabaseServer;

    const tryFindByPhone = async () => {
      if (!phone) return null;
      const { data, error } = await sb
        .from("customers")
        .select("id, name, phone, email")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    };

    const tryFindByEmail = async () => {
      if (!email) return null;
      const { data, error } = await sb
        .from("customers")
        .select("id, name, phone, email")
        .eq("tenant_id", tenantId)
        .eq("email", email)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    };

    let existing = await tryFindByPhone();
    if (!existing) existing = await tryFindByEmail();

    if (existing) {
      // (Opcional) enriquecer datos
      const patch: Record<string, any> = {};
      if (name && existing.name !== name) patch.name = name;
      if (!existing.phone && phone) patch.phone = phone;
      if (!existing.email && email) patch.email = email;
      if (professionalId) patch.professional_id = professionalId;

      if (Object.keys(patch).length) {
        const { error: upErr } = await sb
          .from("customers")
          .update(patch)
          .eq("id", existing.id)
          .eq("tenant_id", tenantId);
        if (upErr) throw upErr;
      }

      return NextResponse.json({ ok: true, customerId: existing.id, reused: true });
    }

    // Crear nuevo
    const insertPayload: Record<string, any> = {
      tenant_id: tenantId,
      name,
      phone,
      email,
    };
    if (professionalId) insertPayload.professional_id = professionalId;

    const { data: created, error: insErr } = await sb
      .from("customers")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, customerId: created.id, reused: false });
  } catch (e: any) {
    console.error("[customers/create] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error inesperado" },
      { status: 500 }
    );
  }
}
