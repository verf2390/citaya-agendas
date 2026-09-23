export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  extractMetaWebhookEvents,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "@/lib/whatsapp/meta-webhook";
import {
  recordWhatsAppWebhookEvent,
  resolveWhatsAppTenantByPhoneNumberId,
} from "@/lib/whatsapp/repository";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET(req: Request) {
  const verifyToken = process.env.CITAYA_WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
  if (!verifyToken) {
    return new Response("Webhook not configured", {
      status: 503,
      headers: NO_STORE,
    });
  }

  const url = new URL(req.url);
  const challenge = verifyMetaWebhookChallenge({
    mode: url.searchParams.get("hub.mode"),
    verifyToken: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
    expectedVerifyToken: verifyToken,
  });

  if (challenge == null) {
    return new Response("Forbidden", { status: 403, headers: NO_STORE });
  }

  return new Response(challenge, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function POST(req: Request) {
  const appSecret = process.env.CITAYA_WHATSAPP_APP_SECRET?.trim() ?? "";
  if (!appSecret) {
    return NextResponse.json(
      { ok: false, error: "Webhook not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) {
    return NextResponse.json(
      { ok: false, error: "Payload too large" },
      { status: 413, headers: NO_STORE },
    );
  }
  if (
    !verifyMetaWebhookSignature({
      rawBody,
      signatureHeader: req.headers.get("x-hub-signature-256"),
      appSecret,
    })
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 401, headers: NO_STORE },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid payload" },
      { status: 400, headers: NO_STORE },
    );
  }

  const events = extractMetaWebhookEvents(payload);

  try {
    for (const event of events) {
      const tenant = await resolveWhatsAppTenantByPhoneNumberId(
        event.phoneNumberId,
      );
      if (!tenant) continue;

      await recordWhatsAppWebhookEvent({
        tenantId: tenant.tenantId,
        event,
      });
    }
  } catch (error) {
    console.error("[whatsapp/webhook] processing failed", {
      code: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: "Temporary processing failure" },
      { status: 503, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE },
  );
}
