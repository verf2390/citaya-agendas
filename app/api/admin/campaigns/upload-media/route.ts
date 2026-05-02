export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type CampaignMediaType = "image" | "gif" | "video";

const BUCKET_NAME =
  process.env.SUPABASE_CAMPAIGN_ASSETS_BUCKET?.trim() || "campaign-assets";

const ALLOWED_TYPES: Record<string, { mediaType: CampaignMediaType; extensions: string[] }> = {
  "image/jpeg": { mediaType: "image", extensions: ["jpg", "jpeg"] },
  "image/png": { mediaType: "image", extensions: ["png"] },
  "image/webp": { mediaType: "image", extensions: ["webp"] },
  "image/gif": { mediaType: "gif", extensions: ["gif"] },
  "video/mp4": { mediaType: "video", extensions: ["mp4"] },
  "video/quicktime": { mediaType: "video", extensions: ["mov"] },
  "video/webm": { mediaType: "video", extensions: ["webm"] },
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function getTenantSlug(req: Request, fallbackSlug: unknown) {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  const fromHost = getTenantSlugFromHostname(host);
  if (fromHost) return fromHost;

  return String(fallbackSlug ?? "").trim();
}

function extensionFromName(fileName: string) {
  const cleanName = fileName.trim().toLowerCase();
  const parts = cleanName.split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function sanitizeFileName(fileName: string) {
  const extension = extensionFromName(fileName);
  const rawBase = fileName.replace(/\.[^.]+$/, "") || "campaign-media";
  const safeBase =
    rawBase
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "campaign-media";

  return extension ? `${safeBase}.${extension}` : safeBase;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonError("Selecciona un archivo para subir.");
    }

    const tenantSlug = getTenantSlug(req, formData.get("tenantSlug"));
    if (!tenantSlug) return jsonError("No se pudo detectar el negocio actual.");

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .select("id, slug")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (tenantError || !tenant?.id) {
      return jsonError("No se pudo validar el negocio actual.", 404);
    }

    const rule = ALLOWED_TYPES[file.type];
    if (!rule) {
      return jsonError("Formato no permitido. Usa JPG, PNG, WebP, GIF, MP4, MOV o WebM.");
    }

    const extension = extensionFromName(file.name);
    if (!extension || !rule.extensions.includes(extension)) {
      return jsonError("La extensión del archivo no coincide con el formato permitido.");
    }

    const maxSize = rule.mediaType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxSize) {
      return jsonError(
        rule.mediaType === "video"
          ? "Los videos pueden pesar hasta 25 MB."
          : "Las imágenes y GIF pueden pesar hasta 5 MB.",
      );
    }

    const safeFileName = sanitizeFileName(file.name);
    const storagePath = `campaigns/${tenant.slug}/drafts/${Date.now()}-${safeFileName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[api/admin/campaigns/upload-media] upload error:", uploadError);
      return jsonError(
        `No se pudo subir el archivo. Revisa que exista el bucket ${BUCKET_NAME}.`,
        500,
      );
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      ok: true,
      mediaUrl: publicData.publicUrl,
      mediaType: rule.mediaType,
      fileName: safeFileName,
      size: file.size,
      mimeType: file.type,
    });
  } catch (e: any) {
    console.error("[api/admin/campaigns/upload-media] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "No se pudo subir el archivo" },
      { status: 500 },
    );
  }
}
