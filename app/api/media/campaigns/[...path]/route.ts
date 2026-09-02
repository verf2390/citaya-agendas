export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BUCKET_NAME =
  process.env.SUPABASE_CAMPAIGN_ASSETS_BUCKET?.trim() || "campaign-assets";
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVER_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp|gif|mp4|webm)$/i;

function unavailable() {
  return NextResponse.json(
    { ok: false, error: "Archivo no disponible" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path;
    if (!Array.isArray(path) || path.length !== 2) return unavailable();
    const [tenantId, fileName] = path;
    const match = SERVER_FILE.exec(fileName ?? "");
    if (!UUID.test(tenantId ?? "") || !match) return unavailable();
    const extension = match[2].toLowerCase();
    const contentType = TYPES[extension];
    if (!contentType) return unavailable();

    const storagePath = `campaigns/${tenantId}/drafts/${fileName}`;
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .download(storagePath);
    if (error || !data) return unavailable();
    const bytes = await data.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) {
      return unavailable();
    }

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return unavailable();
  }
}
