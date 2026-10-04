export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireM2M } from "@/lib/api/requireM2M";
import { AIError, safeAIErrorCode } from "@/lib/ai/errors";
import { runN8NAI } from "@/lib/ai/server/n8n-ai";
import { loadAITenantPolicy } from "@/lib/ai/server/tenant-policy";
import { consumeRateLimit } from "@/lib/security/request";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

const WORKFLOW_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const OPERATIONS = new Set(["classify", "summarize", "draft"]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function publicError(error: unknown) {
  const code = safeAIErrorCode(error);
  if (code === "AI_DISABLED" || code === "AI_PROVIDER_CONFIG") {
    return json({ ok: false, code, error: "AI unavailable" }, 503);
  }
  if (code === "AI_DAILY_TOKEN_LIMIT") {
    return json({ ok: false, code, error: "AI daily limit reached" }, 429);
  }
  if (code === "AI_TIMEOUT") {
    return json({ ok: false, code, error: "AI timeout" }, 504);
  }
  if (code === "AI_INVALID_REQUEST") {
    return json({ ok: false, code, error: "Invalid AI request" }, 400);
  }
  return json({ ok: false, code, error: "AI request failed" }, 502);
}

function parseLabels(value: unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) return null;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const label = raw.trim();
    const key = label.toLocaleLowerCase("es");
    if (!label || label.length > 60 || seen.has(key)) return null;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

export async function POST(req: Request) {
  const access = await requireM2M(req);
  if (!access.ok) {
    return json(
      {
        ok: false,
        error: access.status === 401 ? "Unauthorized" : "Forbidden",
      },
      access.status,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const record = body as Record<string, unknown>;
  const workflowId = String(record.workflowId ?? "").trim();
  const operation = String(record.operation ?? "").trim();
  const source = String(record.input ?? "").trim();
  const instruction =
    record.instruction === undefined
      ? undefined
      : String(record.instruction ?? "").trim();

  if (!WORKFLOW_RE.test(workflowId) || !OPERATIONS.has(operation)) {
    return json({ ok: false, error: "Invalid workflow or operation" }, 400);
  }
  if (!source || source.length > 6_000) {
    return json({ ok: false, error: "Input must contain 1 to 6000 characters" }, 400);
  }
  if (instruction !== undefined && (!instruction || instruction.length > 1_000)) {
    return json({ ok: false, error: "Invalid instruction" }, 400);
  }

  const labels =
    operation === "classify" ? parseLabels(record.labels) : undefined;
  if (operation === "classify" && !labels) {
    return json({ ok: false, error: "Classification labels are required" }, 400);
  }
  if (operation !== "classify" && record.labels !== undefined) {
    return json({ ok: false, error: "Labels are only valid for classification" }, 400);
  }

  try {
    const policy = await loadAITenantPolicy(access.tenantId);
    if (!policy.enabled) {
      throw new AIError("AI_DISABLED", "AI disabled");
    }

    const allowed = await consumeRateLimit({
      scope: "ai_n8n_minute",
      key: `${access.tenantId}:n8n`,
      limit: policy.requestsPerMinute,
      windowSeconds: 60,
    });
    if (!allowed) {
      return json(
        { ok: false, code: "AI_RATE_LIMIT", error: "AI rate limit reached" },
        429,
      );
    }

    const result = await runN8NAI({
      tenantId: access.tenantId,
      tenantSlug: access.tenantSlug,
      serviceId: "n8n",
      workflowId,
      operation: operation as "classify" | "summarize" | "draft",
      source,
      instruction,
      labels,
      policy,
    });

    return json({
      ok: true,
      workflowId,
      operation,
      result: result.text,
      usage: result.usage,
      route: {
        effectiveProvider: result.route.effectiveProvider,
        effectiveModel: result.route.effectiveModel,
        fallbackUsed: result.route.fallbackUsed,
      },
    });
  } catch (error) {
    console.error("[integrations/ai] request failed", {
      tenantId: access.tenantId,
      workflowId,
      operation,
      code: safeAIErrorCode(error),
    });
    return publicError(error);
  }
}
