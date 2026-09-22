import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import type {
  WhatsAppDeliveryStatus,
  WhatsAppWebhookEvent,
} from "@/lib/whatsapp/types";

const STATUS_SET = new Set<WhatsAppDeliveryStatus>([
  "sent",
  "delivered",
  "read",
  "failed",
]);

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMetaWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}) {
  const signature = input.signatureHeader?.trim() ?? "";
  const secret = input.appSecret.trim();
  if (!secret || !signature.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(input.rawBody, "utf8").digest("hex");
  return safeEqual(signature, expected);
}

export function verifyMetaWebhookChallenge(input: {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
  expectedVerifyToken: string;
}) {
  const expected = input.expectedVerifyToken.trim();
  if (
    input.mode !== "subscribe" ||
    !expected ||
    !input.verifyToken ||
    !input.challenge
  ) {
    return null;
  }
  return safeEqual(input.verifyToken, expected) ? input.challenge : null;
}

function safeTimestamp(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return new Date().toISOString();
  }
  return new Date(Math.floor(seconds) * 1000).toISOString();
}

function hashEventKey(parts: string[]) {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

export function extractMetaWebhookEvents(payload: unknown): WhatsAppWebhookEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) {
    return [];
  }

  const events: WhatsAppWebhookEvent[] = [];

  for (const entry of root.entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const changes = (entry as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!change || typeof change !== "object" || Array.isArray(change)) continue;
      const row = change as Record<string, unknown>;
      if (row.field !== "messages") continue;

      const value = row.value;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const messageValue = value as Record<string, unknown>;
      const metadata = messageValue.metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        continue;
      }
      const phoneNumberId = String(
        (metadata as Record<string, unknown>).phone_number_id ?? "",
      ).trim();
      if (!phoneNumberId || phoneNumberId.length > 64) continue;

      if (Array.isArray(messageValue.messages)) {
        for (const message of messageValue.messages) {
          if (!message || typeof message !== "object" || Array.isArray(message)) {
            continue;
          }
          const item = message as Record<string, unknown>;
          const providerMessageId = String(item.id ?? "").trim();
          if (!providerMessageId || providerMessageId.length > 255) continue;
          const occurredAt = safeTimestamp(item.timestamp);
          events.push({
            eventKey: hashEventKey([
              phoneNumberId,
              "inbound",
              providerMessageId,
            ]),
            phoneNumberId,
            providerMessageId,
            direction: "inbound",
            eventType: "message",
            occurredAt,
          });
        }
      }

      if (Array.isArray(messageValue.statuses)) {
        for (const status of messageValue.statuses) {
          if (!status || typeof status !== "object" || Array.isArray(status)) {
            continue;
          }
          const item = status as Record<string, unknown>;
          const providerMessageId = String(item.id ?? "").trim();
          const eventType = String(item.status ?? "").trim() as WhatsAppDeliveryStatus;
          if (
            !providerMessageId ||
            providerMessageId.length > 255 ||
            !STATUS_SET.has(eventType)
          ) {
            continue;
          }
          const occurredAt = safeTimestamp(item.timestamp);
          events.push({
            eventKey: hashEventKey([
              phoneNumberId,
              "status",
              providerMessageId,
              eventType,
              occurredAt,
            ]),
            phoneNumberId,
            providerMessageId,
            direction: "status",
            eventType,
            occurredAt,
          });
        }
      }
    }
  }

  return events.slice(0, 200);
}
