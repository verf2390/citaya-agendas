import { canRunAppointmentOperationalEffects } from "../../lib/tenant/operational-mode.mjs";

/**
 * @typedef {{ ok: boolean, status: number }} WebhookResponse
 * @typedef {(url: string, init: RequestInit) => Promise<WebhookResponse>} WebhookFetch
 */

/**
 * @param {import("../../lib/tenant/operational-types").TenantOperationalCapabilities} capabilities
 * @param {unknown} duplicate
 */
export function shouldDispatchAppointmentCreatedEvent(capabilities, duplicate) {
  return duplicate === false && canRunAppointmentOperationalEffects(capabilities);
}

/**
 * @param {string} publicBaseUrl
 * @param {string} manageToken
 */
export function buildAppointmentManageUrl(publicBaseUrl, manageToken) {
  try {
    const base = new URL(publicBaseUrl);
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    const manageUrl = new URL("/reservar/gestionar", base.origin);
    manageUrl.searchParams.set("token", manageToken);
    return manageUrl.toString();
  } catch {
    return null;
  }
}

/**
 * Runs an appointment effect only after its booking mutation has committed.
 * The effect is best-effort and cannot turn that mutation into an HTTP failure.
 *
 * @param {() => Promise<{called: boolean, ok: boolean, status: number, reason: string | null}>} effect
 */
export async function runPostPersistedAppointmentEffect(effect) {
  try {
    return await effect();
  } catch (error) {
    return {
      called: false,
      ok: false,
      status: 0,
      reason: error instanceof Error ? error.name : "operational_effect_failed",
    };
  }
}

/**
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   payload: Record<string, unknown>,
 *   fetchImpl?: WebhookFetch,
 *   timeoutMs?: number,
 * }} input
 */
async function dispatchWebhook(input) {
  if (!input.webhookUrl || !input.webhookSecret) {
    return { called: false, ok: false, status: 0, reason: "not_configured" };
  }

  let targetUrl;
  try {
    targetUrl = new URL(input.webhookUrl);
  } catch {
    return { called: false, ok: false, status: 0, reason: "invalid_webhook_url" };
  }
  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return { called: false, ok: false, status: 0, reason: "invalid_webhook_url" };
  }

  const headers = {
    "content-type": "application/json",
    "x-citaya-secret": input.webhookSecret,
  };

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, input.timeoutMs ?? 5000),
  );
  try {
    const response = await fetchImpl(targetUrl.toString(), {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
    return {
      called: true,
      ok: response.ok,
      status: response.status,
      reason: response.ok ? null : "webhook_rejected",
    };
  } catch (error) {
    return {
      called: true,
      ok: false,
      status: 0,
      reason: error instanceof Error ? error.name : "webhook_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Appointment workflows authenticate with x-citaya-secret. The
 * manage token is supplied by the creation request and is never read back
 * from the appointment row.
 *
 * @param {{ appointmentId: string, manageToken: string, publicBaseUrl: string }} input
 * @param {{ webhookUrl?: string | null, webhookSecret?: string | null, fetchImpl?: WebhookFetch, timeoutMs?: number }} [options]
 */
export async function dispatchAppointmentCreatedEvent(input, options = {}) {
  const manageUrl = buildAppointmentManageUrl(input.publicBaseUrl, input.manageToken);
  if (!manageUrl) {
    return { called: false, ok: false, status: 0, reason: "public_base_url_unavailable" };
  }
  return dispatchWebhook({
    webhookUrl: String(options.webhookUrl ?? process.env.N8N_WEBHOOK_URL ?? "").trim(),
    webhookSecret: String(options.webhookSecret ?? process.env.N8N_WEBHOOK_SECRET ?? "").trim(),
    payload: {
      appointment_id: input.appointmentId,
      manage_token: input.manageToken,
      public_base_url: input.publicBaseUrl,
      manage_url: manageUrl,
    },
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * @param {{ appointmentId: string, tenantId: string, source: string }} input
 * @param {{ webhookUrl?: string | null, webhookSecret?: string | null, fetchImpl?: WebhookFetch, timeoutMs?: number }} [options]
 */
export async function dispatchAppointmentCanceledEvent(input, options = {}) {
  return dispatchWebhook({
    webhookUrl: String(options.webhookUrl ?? process.env.N8N_CANCEL_WEBHOOK_URL ?? "").trim(),
    webhookSecret: String(options.webhookSecret ?? process.env.CITAYA_SECRET ?? "").trim(),
    payload: {
      appointment_id: input.appointmentId,
      tenant_id: input.tenantId,
      reason: input.source,
      source: input.source,
    },
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * @param {{
 *   appointmentId: string,
 *   tenantId: string,
 *   oldStartAt: string,
 *   oldEndAt: string,
 *   newStartAt: string,
 *   newEndAt: string,
 *   manageToken: string,
 *   source: string,
 * }} input
 * @param {{ webhookUrl?: string | null, webhookSecret?: string | null, fetchImpl?: WebhookFetch, timeoutMs?: number }} [options]
 */
export async function dispatchAppointmentRescheduledEvent(input, options = {}) {
  return dispatchWebhook({
    webhookUrl: String(options.webhookUrl ?? process.env.N8N_RESCHEDULE_WEBHOOK_URL ?? "").trim(),
    webhookSecret: String(options.webhookSecret ?? process.env.CITAYA_SECRET ?? "").trim(),
    payload: {
      kind: "reschedule",
      appointment_id: input.appointmentId,
      tenant_id: input.tenantId,
      old: { start_at: input.oldStartAt, end_at: input.oldEndAt },
      new: { start_at: input.newStartAt, end_at: input.newEndAt },
      manage_token: input.manageToken,
      source: input.source,
    },
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
}
