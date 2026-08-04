import { createHash } from "node:crypto";

export const IMPLEMENTED_PRODUCTION_TYPES = Object.freeze([33, 39]);
export const ISSUANCE_STATES = Object.freeze([
  "PENDING", "BLOCKED", "PREPARING", "READY", "SUBMITTING", "SUBMITTED",
  "ACCEPTED", "REJECTED", "AMBIGUOUS", "DELIVERY_PENDING", "DELIVERED",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function validRut(value) {
  const normalized = clean(value).replace(/\./g, "").toUpperCase();
  if (!/^\d{7,8}-[0-9K]$/.test(normalized)) return false;
  const [body, verifier] = normalized.split("-");
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return verifier === expected;
}

function blocked(reason, documentType = null) {
  return { status: "BLOCKED", reason, documentType, mayContactSii: false };
}

export function resolveAutomaticIssuance(input) {
  const appointment = input.appointment;
  const payment = input.payment;
  const config = input.config;
  if (!appointment || !payment) return blocked("WAITING_FOR_APPOINTMENT_AND_PAYMENT");
  if (!payment.verified) return blocked("PAYMENT_NOT_VERIFIED");
  if (appointment.canceled) return blocked("APPOINTMENT_CANCELED");
  if (clean(payment.currency).toUpperCase() !== "CLP") return blocked("CURRENCY_NOT_SUPPORTED");
  const serverAmount = Number(appointment.serverAmount);
  const verifiedAmount = Number(payment.verifiedAmount);
  if (!Number.isSafeInteger(serverAmount) || serverAmount < 0 || serverAmount !== verifiedAmount) {
    return blocked("PAYMENT_AMOUNT_MISMATCH");
  }
  if (!input.globalProductionEnabled) return blocked("GLOBAL_PRODUCTION_DISABLED");
  if (!config) return blocked("TENANT_DTE_NOT_CONFIGURED");
  if (config.issuanceMode !== "automatic_on_verified_payment") return blocked("AUTOMATION_DISABLED");
  if (!config.productionEnabled) return blocked("TENANT_PRODUCTION_DISABLED");
  if (config.siiAuthorizationStatus !== "approved") return blocked("TENANT_NOT_AUTHORIZED");
  if (!config.certificateReady || !config.certificateCurrent) return blocked("CERTIFICATE_NOT_READY");
  if (!config.cafReady) return blocked("CAF_NOT_READY");
  if (!config.folioReady) return blocked("FOLIO_NOT_READY");
  if (!config.endpointsReady || !config.storageReady || !config.workerReady || !config.readinessTestsGreen) {
    return blocked("PRODUCTION_GATES_INCOMPLETE");
  }
  if (!clean(appointment.taxTreatmentSnapshot)) return blocked("TAX_TREATMENT_SNAPSHOT_REQUIRED");

  let documentType;
  if (appointment.invoiceRequested) {
    documentType = 33;
    if (!config.invoiceOnRequest) return blocked("INVOICE_ON_REQUEST_DISABLED", documentType);
    const receiver = appointment.receiver ?? {};
    if (
      !validRut(receiver.rut) ||
      !clean(receiver.legalName) ||
      !clean(receiver.activity) ||
      !clean(receiver.address) ||
      !clean(receiver.commune)
    ) return blocked("INVOICE_RECEIVER_DATA_INCOMPLETE", documentType);
  } else {
    documentType = Number(config.consumerDocumentType);
    if (![39, 41].includes(documentType)) return blocked("CONSUMER_DOCUMENT_UNSUPPORTED");
  }

  if (documentType === 39) {
    return blocked("BOLETA39_AUTOMATIC_ISSUANCE_DISABLED", documentType);
  }

  if (!IMPLEMENTED_PRODUCTION_TYPES.includes(documentType)) {
    return blocked("DOCUMENT_TYPE_UNSUPPORTED", documentType);
  }
  return {
    status: "PENDING",
    reason: null,
    documentType,
    amount: serverAmount,
    currency: "CLP",
    mayContactSii: true,
  };
}

function keyFor(tenantId, paymentKey, appointmentId, documentType) {
  return createHash("sha256")
    .update([tenantId, paymentKey, appointmentId, documentType ?? "unsupported"].join("|"))
    .digest("hex");
}

export class InMemoryIssuanceCoordinator {
  #facts = new Map();
  #intents = new Map();

  recordAppointment(appointment, context) {
    const aggregateKey = `${appointment.tenantId}:${appointment.id}`;
    const facts = this.#facts.get(aggregateKey) ?? { context };
    facts.appointment = structuredClone(appointment);
    facts.context = context;
    this.#facts.set(aggregateKey, facts);
    return this.#reconcile(aggregateKey);
  }

  recordPayment(payment, context) {
    const aggregateKey = `${payment.tenantId}:${payment.appointmentId}`;
    const facts = this.#facts.get(aggregateKey) ?? { context };
    facts.payment = structuredClone(payment);
    facts.context = context;
    this.#facts.set(aggregateKey, facts);
    return this.#reconcile(aggregateKey);
  }

  cancel(tenantId, appointmentId) {
    const prefix = `${tenantId}:`;
    let changed = 0;
    for (const intent of this.#intents.values()) {
      if (intent.tenantId === tenantId && intent.appointmentId === appointmentId &&
          ["PENDING", "BLOCKED", "PREPARING", "READY"].includes(intent.status)) {
        intent.status = "CANCELED";
        intent.reason = "APPOINTMENT_CANCELED_BEFORE_ISSUANCE";
        changed += 1;
      }
    }
    const facts = this.#facts.get(`${prefix}${appointmentId}`);
    if (facts?.appointment) facts.appointment.canceled = true;
    return changed;
  }

  intents() {
    return [...this.#intents.values()].map((value) => structuredClone(value));
  }

  #reconcile(aggregateKey) {
    const facts = this.#facts.get(aggregateKey);
    if (!facts?.appointment || !facts?.payment) return null;
    if (facts.appointment.tenantId !== facts.payment.tenantId) return blocked("CROSS_TENANT_SIGNAL");
    const decision = resolveAutomaticIssuance({
      appointment: facts.appointment,
      payment: facts.payment,
      ...facts.context,
    });
    const idempotencyKey = keyFor(
      facts.appointment.tenantId,
      facts.payment.paymentKey,
      facts.appointment.id,
      decision.documentType,
    );
    const existing = this.#intents.get(idempotencyKey);
    if (existing) return structuredClone(existing);
    const intent = {
      idempotencyKey,
      tenantId: facts.appointment.tenantId,
      appointmentId: facts.appointment.id,
      paymentKey: facts.payment.paymentKey,
      status: decision.status,
      reason: decision.reason,
      documentType: decision.documentType,
      networkAttempts: 0,
      deterministicRetries: 0,
    };
    this.#intents.set(idempotencyKey, intent);
    return structuredClone(intent);
  }
}

export function tenantStorageKey(tenantId, documentId, fileName) {
  const safe = (value) => clean(value).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!clean(tenantId) || !clean(documentId) || !clean(fileName)) throw new Error("DTE_STORAGE_KEY_INVALID");
  return `${safe(tenantId)}/${safe(documentId)}/${safe(fileName)}`;
}

export function assertTenantStorageAccess(tenantId, storageKey) {
  if (!clean(storageKey).startsWith(`${clean(tenantId)}/`)) throw new Error("DTE_STORAGE_TENANT_MISMATCH");
  return true;
}

export function shouldDeliverEmail(status, autoEmailDelivery) {
  return Boolean(autoEmailDelivery) && ["ACCEPTED", "DELIVERY_PENDING"].includes(status);
}

export async function processOutboxItem(input) {
  if (!input.globalProductionEnabled) {
    await input.markBlocked("GLOBAL_PRODUCTION_DISABLED");
    return { status: "BLOCKED", networkAttempts: 0, automaticRetries: 0 };
  }
  try {
    await input.prepare();
  } catch {
    const retries = Math.min(Number(input.deterministicRetries ?? 0) + 1, 3);
    await input.markDeterministicFailure(retries);
    return { status: "BLOCKED", networkAttempts: 0, automaticRetries: retries };
  }
  try {
    const result = await input.submitExactlyOnce();
    if (result.status === "AMBIGUOUS") {
      await input.markAmbiguous("AMBIGUOUS_REQUIRES_RECONCILIATION");
      return { status: "AMBIGUOUS", networkAttempts: 1, automaticRetries: 0 };
    }
    return { status: result.status, networkAttempts: 1, automaticRetries: 0 };
  } catch {
    await input.markAmbiguous("NETWORK_RESULT_UNKNOWN");
    return { status: "AMBIGUOUS", networkAttempts: 1, automaticRetries: 0 };
  }
}
