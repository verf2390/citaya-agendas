import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import {
  requireHostTenantAdmin,
  requirePlatformAdmin,
} from "@/lib/api/requireTenantAdmin";
import { idempotencyKey, consumeRateLimit } from "@/lib/security/request";
import {
  callVideoStudio,
  removeStagedUpload,
  stageVideoUpload,
  VideoStudioError,
} from "@/lib/video/studioBridge";

export const runtime = "nodejs";

const VIDEO_STUDIO_TENANT_SLUG = "rg-spa";

function hostHeader(req: Request) {
  return (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
}

function mutationOriginAllowed(req: Request) {
  const origin = req.headers.get("origin");
  const host = hostHeader(req);
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function errorStatus(code: string) {
  if (code === "NOT_FOUND") return 404;
  if (code === "QUOTA_EXCEEDED") return 429;
  if (
    code === "PROJECT_BUSY" ||
    code === "FINAL_APPROVAL_REQUIRED" ||
    code === "PREVIEW_APPROVAL_INVALID" ||
    code === "STALE_CONFIG" ||
    code === "IDEMPOTENCY_CONFLICT"
  ) {
    return 409;
  }
  if (
    code === "VIDEO_STUDIO_UNAVAILABLE" ||
    code === "VIDEO_STUDIO_TIMEOUT" ||
    code === "VIDEO_STUDIO_INVALID_RESPONSE"
  ) {
    return 503;
  }
  return 400;
}

function safeError(error: unknown) {
  const code = error instanceof VideoStudioError ? error.code : "VIDEO_STUDIO_ERROR";
  return NextResponse.json({ ok: false, code }, { status: errorStatus(code) });
}

async function authorize(req: Request) {
  const access = await requireHostTenantAdmin(req);
  if (!access.ok) {
    return {
      response: NextResponse.json(
        { ok: false, error: access.error },
        { status: access.status },
      ),
    } as const;
  }
  if (access.tenantSlug !== VIDEO_STUDIO_TENANT_SLUG) {
    return {
      response: NextResponse.json(
        { ok: false, code: "NOT_FOUND" },
        { status: 404 },
      ),
    } as const;
  }

  const platform = await requirePlatformAdmin(req);
  if (!platform.ok || platform.userId !== access.userId) {
    return {
      response: NextResponse.json(
        { ok: false, code: "NOT_FOUND" },
        { status: 404 },
      ),
    } as const;
  }

  return { access } as const;
}

export async function GET(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { access } = auth;

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";
    if (action === "list") {
      const projects = await callVideoStudio<unknown[]>({
        action: "list_projects",
        tenantId: access.tenantId,
        userId: access.userId,
      });
      return NextResponse.json({ ok: true, projects });
    }
    if (action === "project") {
      const projectId = String(url.searchParams.get("projectId") ?? "").trim();
      if (!projectId) return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
      const project = await callVideoStudio<unknown>({
        action: "project_detail",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { projectId },
      });
      return NextResponse.json({ ok: true, project });
    }
    if (action === "usage") {
      const usage = await callVideoStudio<unknown>({
        action: "usage",
        tenantId: access.tenantId,
        userId: access.userId,
      });
      return NextResponse.json({ ok: true, usage });
    }
    if (action === "download") {
      const outputId = String(url.searchParams.get("outputId") ?? "").trim();
      if (!outputId) return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
      const result = await callVideoStudio<{
        path: string;
        outputType: string;
        sizeBytes: number;
      }>({
        action: "download_path",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { outputId },
      });
      const fileStat = await stat(result.path);
      if (!fileStat.isFile() || fileStat.size !== result.sizeBytes) {
        throw new VideoStudioError("NOT_FOUND");
      }
      const extension = extname(result.path).toLowerCase();
      const mime =
        extension === ".mp4"
          ? "video/mp4"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : extension === ".json"
              ? "application/json; charset=utf-8"
              : "text/plain; charset=utf-8";
      const body = Readable.toWeb(createReadStream(result.path)) as ReadableStream<Uint8Array>;
      const filename = basename(result.outputType + extension).replace(/[^A-Za-z0-9._-]/g, "_");
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(fileStat.size),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return NextResponse.json({ ok: false, code: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    console.error("[admin/videos] GET failed", {
      tenantId: access.tenantId,
      code: error instanceof VideoStudioError ? error.code : "unknown",
    });
    return safeError(error);
  }
}

export async function POST(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { access } = auth;

  if (!mutationOriginAllowed(req)) {
    return NextResponse.json({ ok: false, code: "INVALID_ORIGIN" }, { status: 403 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.startsWith("multipart/form-data")) {
      const allowed = await consumeRateLimit({
        scope: "admin-video-upload",
        key: `${access.tenantId}:${access.userId}`,
        limit: 12,
        windowSeconds: 60,
      });
      if (!allowed) return NextResponse.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });

      const form = await req.formData();
      if (form.get("action") !== "upload") {
        return NextResponse.json({ ok: false, code: "INVALID_ACTION" }, { status: 400 });
      }
      const projectId = String(form.get("projectId") ?? "").trim();
      const file = form.get("file");
      if (!projectId || !(file instanceof File)) {
        return NextResponse.json({ ok: false, code: "INVALID_UPLOAD" }, { status: 400 });
      }
      const stagedPath = await stageVideoUpload(file);
      try {
        const result = await callVideoStudio<{ assetId: string }>({
          action: "upload",
          tenantId: access.tenantId,
          userId: access.userId,
          payload: { projectId, stagedPath },
        });
        return NextResponse.json({ ok: true, ...result });
      } finally {
        await removeStagedUpload(stagedPath);
      }
    }

    const body = (await req.json().catch(() => null)) as
      | { action?: unknown; [key: string]: unknown }
      | null;
    const action = typeof body?.action === "string" ? body.action : "";

    const allowed = await consumeRateLimit({
      scope: "admin-video-studio",
      key: `${access.tenantId}:${access.userId}:${action}`,
      limit: 30,
      windowSeconds: 60,
    });
    if (!allowed) return NextResponse.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });

    if (action === "create_from_brief") {
      const result = await callVideoStudio<Record<string, unknown>>({
        action: "create_from_brief",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: {
          title: body?.title,
          brief: body?.brief,
          businessName: body?.businessName,
          niche: body?.niche,
          nicheLabel: body?.nicheLabel,
          style: body?.style,
          durationSeconds: body?.durationSeconds,
          videoType: body?.videoType,
          productContext: body?.productContext,
          mediaPolicy: { mediaFirst: body?.mediaPolicy?.mediaFirst ?? false },
        },
      });
      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    }
    if (action === "prepare_direction" || action === "direction_analysis_status") {
      const result = await callVideoStudio<Record<string, unknown>>({
        action,
        tenantId: access.tenantId,
        userId: access.userId,
        payload: {
          projectId: body?.projectId,
          assetIds: body?.assetIds,
          analysisConsent: body?.analysisConsent,
          analysisJobId: body?.analysisJobId,
        },
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "direct") {
      const projectId = String(body?.projectId ?? "").trim();
      const brief = String(body?.brief ?? "").trim();
      if (!projectId || !brief) {
        return NextResponse.json(
          { ok: false, code: "INVALID_REQUEST" },
          { status: 400 },
        );
      }
      const result = await callVideoStudio<Record<string, unknown>>({
        action: "direct_project",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { projectId, brief },
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "create") {
      const project = await callVideoStudio<unknown>({
        action: "create_project",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { title: body?.title, config: body?.config },
      });
      return NextResponse.json({ ok: true, project }, { status: 201 });
    }
    if (action === "update") {
      const project = await callVideoStudio<unknown>({
        action: "update_project",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { projectId: body?.projectId, config: body?.config },
      });
      return NextResponse.json({ ok: true, project });
    }
    if (action === "validate") {
      const result = await callVideoStudio<Record<string, unknown>>({
        action: "validate",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { projectId: body?.projectId },
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "preview" || action === "final") {
      const key = idempotencyKey(req);
      if (!key) return NextResponse.json({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
      const result = await callVideoStudio<Record<string, unknown>>({
        action: "enqueue",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: {
          projectId: body?.projectId,
          mode: action,
          idempotencyKey: key,
        },
      });
      return NextResponse.json({ ok: true, ...result }, { status: 202 });
    }
    if (action === "approve") {
      const result = await callVideoStudio<Record<string, unknown>>({
        action: "approve",
        tenantId: access.tenantId,
        userId: access.userId,
        payload: { previewJobId: body?.previewJobId },
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, code: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    console.error("[admin/videos] POST failed", {
      tenantId: access.tenantId,
      code: error instanceof VideoStudioError ? error.code : "unknown",
    });
    return safeError(error);
  }
}
