import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseKhipuSignature(header) {
  const parts = new Map(
    String(header ?? "")
      .split(",")
      .map((part) => part.trim().split(/=(.*)/s).slice(0, 2)),
  );
  return { timestamp: parts.get("t") ?? "", signature: parts.get("s") ?? "" };
}

export function verifyKhipuSignature({
  rawBody,
  signatureHeader,
  secret,
  now = Date.now(),
  toleranceMs = 5 * 60 * 1000,
}) {
  if (!secret || typeof rawBody !== "string") return false;
  const { timestamp, signature } = parseKhipuSignature(signatureHeader);
  if (!/^\d{10,16}$/.test(timestamp) || !signature) return false;
  if (Math.abs(now - Number(timestamp)) > toleranceMs) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("base64");
  return safeEqualText(expected, signature);
}

function sameMoney(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return (
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    Math.abs(leftNumber - rightNumber) < 0.0001
  );
}

export function verifyMercadoPagoPayment(intent, payment, expectedPaymentId) {
  if (!intent || !payment) return { ok: false, reason: "missing_payment" };
  if (!safeEqualText(payment.id, expectedPaymentId)) {
    return { ok: false, reason: "payment_id_mismatch" };
  }

  const currencyMatches =
    String(payment.currency_id ?? "").toUpperCase() ===
    String(intent.currency ?? "").toUpperCase();
  const referenceMatches = safeEqualText(payment.external_reference, intent.id);
  const approved = String(payment.status ?? "").toLowerCase() === "approved";
  const amountMatches = sameMoney(payment.transaction_amount, intent.amount);

  if (!currencyMatches) return { ok: false, reason: "currency_mismatch" };
  if (!referenceMatches) return { ok: false, reason: "external_reference_mismatch" };
  if (!approved) return { ok: false, reason: "not_approved" };
  if (!amountMatches) return { ok: false, reason: "amount_mismatch" };
  return { ok: true };
}

export function verifyKhipuPayment(intent, payment, expectedReceiverId) {
  if (!intent || !payment) return { ok: false, reason: "missing_payment" };
  if (!safeEqualText(payment.payment_id, intent.provider_payment_id)) {
    return { ok: false, reason: "payment_id_mismatch" };
  }
  if (!safeEqualText(payment.transaction_id, intent.id)) {
    return { ok: false, reason: "transaction_mismatch" };
  }
  if (!sameMoney(payment.amount, intent.amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (
    String(payment.currency ?? "").toUpperCase() !==
    String(intent.currency ?? "").toUpperCase()
  ) {
    return { ok: false, reason: "currency_mismatch" };
  }
  if (
    expectedReceiverId &&
    String(payment.receiver_id ?? "") !== String(expectedReceiverId)
  ) {
    return { ok: false, reason: "receiver_mismatch" };
  }

  let custom = null;
  try {
    custom = JSON.parse(String(payment.custom ?? ""));
  } catch {
    return { ok: false, reason: "custom_invalid" };
  }
  if (
    !safeEqualText(custom?.tenantId, intent.tenant_id) ||
    !safeEqualText(custom?.appointmentId, intent.appointment_id)
  ) {
    return { ok: false, reason: "binding_mismatch" };
  }
  if (
    String(payment.status ?? "").toLowerCase() !== "done" ||
    String(payment.status_detail ?? "").toLowerCase() !== "normal" ||
    !payment.conciliation_date
  ) {
    return { ok: false, reason: "not_confirmed" };
  }
  return { ok: true };
}

export function verifyWebpayCommit(intent, transaction, token) {
  if (!intent || !transaction) return { ok: false, reason: "missing_transaction" };
  if (!safeEqualText(intent.provider_payment_id, token)) {
    return { ok: false, reason: "token_mismatch" };
  }
  if (!safeEqualText(transaction.buy_order, intent.buy_order)) {
    return { ok: false, reason: "buy_order_mismatch" };
  }
  if (!safeEqualText(transaction.session_id, intent.session_id)) {
    return { ok: false, reason: "session_id_mismatch" };
  }
  if (!sameMoney(transaction.amount, intent.amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (
    String(transaction.status ?? "").toUpperCase() !== "AUTHORIZED" ||
    Number(transaction.response_code) !== 0
  ) {
    return { ok: false, reason: "not_authorized" };
  }
  return { ok: true };
}

export function safePaymentAuditMetadata(provider, external) {
  if (provider === "mercadopago") {
    return {
      payment_id: String(external?.id ?? external?.payment_id ?? "").slice(0, 64),
      status: String(external?.status ?? "").slice(0, 32),
      date_approved: external?.date_approved ?? null,
      transaction_amount: Number.isFinite(Number(external?.transaction_amount))
        ? Number(external.transaction_amount)
        : null,
      currency_id: String(external?.currency_id ?? "").slice(0, 8),
      external_reference: String(external?.external_reference ?? "").slice(0, 64),
    };
  }
  if (provider === "khipu") {
    return {
      payment_id: String(external?.payment_id ?? "").slice(0, 64),
      transaction_id: String(external?.transaction_id ?? "").slice(0, 128),
      status: String(external?.status ?? "").slice(0, 32),
      status_detail: String(external?.status_detail ?? "").slice(0, 64),
      conciliation_date: external?.conciliation_date ?? null,
    };
  }
  return {
    buy_order: String(external?.buy_order ?? "").slice(0, 64),
    session_id: String(external?.session_id ?? "").slice(0, 128),
    status: String(external?.status ?? "").slice(0, 32),
    response_code: Number.isInteger(external?.response_code)
      ? external.response_code
      : null,
    transaction_date: external?.transaction_date ?? null,
  };
}
