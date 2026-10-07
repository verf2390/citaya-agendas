import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";

export type VideoStudioAction =
  | "list_projects"
  | "create_from_brief"
  | "project_detail"
  | "create_project"
  | "update_project"
  | "upload"
  | "validate"
  | "enqueue"
  | "approve"
  | "usage"
  | "download_path";

export class VideoStudioError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "VideoStudioError";
    this.code = code;
  }
}

const ROOT = process.cwd();
const VIDEO_RUNTIME_ROOT = resolve(
  process.env.CITAYA_VIDEO_RUNTIME_ROOT?.trim() ||
    resolve(ROOT, "video-production"),
);
const BRIDGE_PATH = resolve(VIDEO_RUNTIME_ROOT, "backend/bridge.py");
const STAGING_ROOT = resolve(VIDEO_RUNTIME_ROOT, "storage/staging");
const BRIDGE_TIMEOUT_MS = 15_000;
const BRIEF_BRIDGE_TIMEOUT_MS = 80_000;
const MAX_BRIDGE_OUTPUT_BYTES = 2_000_000;

function pythonBin() {
  return process.env.CITAYA_VIDEO_PYTHON?.trim() || "python3";
}

export async function callVideoStudio<T>(input: {
  action: VideoStudioAction;
  tenantId: string;
  userId: string;
  payload?: Record<string, unknown>;
}): Promise<T> {
  return await new Promise<T>((resolvePromise, rejectPromise) => {
    const child = spawn(pythonBin(), [BRIDGE_PATH], {
      cwd: ROOT,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    const timeoutMs =
      input.action === "create_from_brief"
        ? BRIEF_BRIDGE_TIMEOUT_MS
        : BRIDGE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finishError(new VideoStudioError("VIDEO_STUDIO_TIMEOUT"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_BRIDGE_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finishError(new VideoStudioError("VIDEO_STUDIO_RESPONSE_TOO_LARGE"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.on("error", () => finishError(new VideoStudioError("VIDEO_STUDIO_UNAVAILABLE")));
    child.on("close", () => {
      clearTimeout(timer);
      if (settled) return;
      let parsed: { ok?: boolean; result?: T; code?: string } | null = null;
      try {
        const line = stdout.trim().split("\n").at(-1) ?? "";
        parsed = JSON.parse(line) as { ok?: boolean; result?: T; code?: string };
      } catch {
        console.error("[video-studio/bridge] invalid response", { stderr });
        finishError(new VideoStudioError("VIDEO_STUDIO_INVALID_RESPONSE"));
        return;
      }
      if (!parsed?.ok) {
        finishError(new VideoStudioError(parsed?.code || "VIDEO_STUDIO_ERROR"));
        return;
      }
      settled = true;
      resolvePromise(parsed.result as T);
    });

    child.stdin.end(
      JSON.stringify({
        action: input.action,
        tenantId: input.tenantId,
        userId: input.userId,
        payload: input.payload ?? {},
      }),
    );
  });
}

function uploadLimitBytes() {
  const parsed = Number(process.env.CITAYA_VIDEO_UPLOAD_MAX_BYTES ?? 250_000_000);
  return Number.isSafeInteger(parsed) && parsed >= 1_000_000
    ? Math.min(parsed, 1_000_000_000)
    : 250_000_000;
}

export async function stageVideoUpload(file: File) {
  if (!(file instanceof File) || file.size <= 0 || file.size > uploadLimitBytes()) {
    throw new VideoStudioError("INVALID_UPLOAD");
  }

  const suffix = extname(file.name).toLowerCase().slice(0, 10);
  if (!/^\.[a-z0-9]{2,9}$/.test(suffix)) {
    throw new VideoStudioError("INVALID_UPLOAD");
  }

  await mkdir(STAGING_ROOT, { recursive: true, mode: 0o700 });
  const stagedPath = resolve(STAGING_ROOT, randomUUID() + suffix);
  const source = Readable.fromWeb(file.stream() as never);
  await pipeline(source, createWriteStream(stagedPath, { mode: 0o600, flags: "wx" }));
  return stagedPath;
}

export async function removeStagedUpload(path: string) {
  await rm(path, { force: true }).catch(() => undefined);
}
