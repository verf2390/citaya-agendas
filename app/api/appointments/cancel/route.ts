import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = body?.token;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({ status: "canceled" })
      .eq("manage_token", token)
      .select("id, status")
      .maybeSingle();

    if (error) {
      console.error(error);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, appointment: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
