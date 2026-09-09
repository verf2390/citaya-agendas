export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { validateCampaignMedia } from "@/lib/security/upload-validation.mjs";

const BUCKET_NAME = process.env.SUPABASE_CAMPAIGN_ASSETS_BUCKET?.trim() || "campaign-assets";
const ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;

function fail(status = 400, error = "Archivo no permitido") {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) return fail(access.status, access.status === 401 ? "Unauthorized" : "Forbidden");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > ABSOLUTE_MAX_BYTES) {
      return fail();
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateCampaignMedia({
      bytes,
      declaredMime: file.type,
      originalName: file.name,
    });
    if (!validation.ok) return fail();

    const serverName = `${randomUUID()}.${validation.extension}`;
    const storagePath = `campaigns/${access.tenantId}/drafts/${serverName}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(
      storagePath,
      Buffer.from(bytes),
      {
        cacheControl: "31536000",
        contentType: String(validation.mimeType),
        upsert: false,
      },
    );
    if (uploadError) {
      console.error("[campaign-upload] storage failed", { code: uploadError.name ?? null });
      return fail(500, "No se pudo guardar el archivo");
    }
    const mediaUrl = new URL(
      `/api/media/campaigns/${access.tenantId}/${serverName}`,
      req.url,
    ).toString();
    return NextResponse.json({
      ok: true,
      mediaUrl,
      mediaType: validation.mediaType,
      fileName: serverName,
      size: bytes.byteLength,
      mimeType: validation.mimeType,
    });
  } catch (error) {
    console.error("[campaign-upload] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return fail(500, "No se pudo procesar el archivo");
  }
}
