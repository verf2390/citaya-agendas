export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { validateCampaignMedia } from "@/lib/security/upload-validation.mjs";

const BUCKET_NAME = process.env.SUPABASE_CAMPAIGN_ASSETS_BUCKET?.trim() || "campaign-assets";
const ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;
const MAX_PNG_PIXELS = 32_000_000;

const VALIDATION_ERRORS: Record<string, string> = {
  empty: "El archivo está vacío.",
  too_large: "El archivo supera el límite de 5 MB para imágenes y GIF o 25 MB para videos.",
  mime_not_allowed: "Usa un archivo JPG, PNG, WebP, GIF, MP4 o WebM.",
  magic_mismatch: "El archivo no coincide con su formato. Ábrelo y expórtalo de nuevo desde tu editor.",
  extension_mismatch: "La extensión del archivo no coincide con su formato. Vuelve a exportarlo con la extensión correcta.",
  invalid_png: "No se pudo leer la imagen PNG. Vuelve a exportarla desde tu editor.",
  active_content: "El archivo contiene código o texto incrustado incompatible. Vuelve a exportarlo desde tu editor.",
};

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) return fail(access.status, access.status === 401 ? "Unauthorized" : "Forbidden");

    const form = await req.formData();
    const file = form.get("file");
    if (file === null || typeof file === "string") return fail(400, "Selecciona un archivo para subir.");
    if (file.size === 0) return fail(400, VALIDATION_ERRORS.empty);
    if (file.size > ABSOLUTE_MAX_BYTES) return fail(400, VALIDATION_ERRORS.too_large);
    let bytes: Buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateCampaignMedia({
      bytes,
      declaredMime: file.type,
      originalName: file.name,
    });
    if (!validation.ok) return fail(400, VALIDATION_ERRORS[validation.reason] ?? "Archivo no permitido");

    if (validation.normalizePng) {
      try {
        // Store only raster data produced by the decoder, without the original metadata.
        bytes = await sharp(bytes, { failOn: "warning", limitInputPixels: MAX_PNG_PIXELS })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch {
        return fail(400, VALIDATION_ERRORS.invalid_png);
      }
      if (bytes.byteLength > validation.maxBytes) return fail(400, VALIDATION_ERRORS.too_large);
    }

    const serverName = `${randomUUID()}.${validation.extension}`;
    const storagePath = `campaigns/${access.tenantId}/drafts/${serverName}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(
      storagePath,
      bytes,
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
