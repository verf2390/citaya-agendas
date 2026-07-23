import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  verifyKhipuSignature,
  verifyKhipuPayment,
  verifyWebpayCommit,
} from "../../lib/security/payment-verification.mjs";

const intent = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  appointment_id: "33333333-3333-4333-8333-333333333333",
  provider_payment_id: "pay123456789",
  buy_order: "CTY1111111111114111811111",
  session_id: "tenant:session",
  amount: 12500,
  currency: "CLP",
};
const khipuPayment = {
  payment_id: intent.provider_payment_id,
  transaction_id: intent.id,
  amount: intent.amount,
  currency: intent.currency,
  receiver_id: "999",
  status: "done",
  status_detail: "normal",
  conciliation_date: "2026-07-23T12:00:00Z",
  custom: JSON.stringify({ tenantId: intent.tenant_id, appointmentId: intent.appointment_id }),
};

function signature(raw, secret, timestamp) {
  return createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("base64");
}

test("Khipu rejects missing/invalid/stale authentication", () => {
  const raw = JSON.stringify(khipuPayment);
  const now = 1_800_000_000_000;
  assert.equal(verifyKhipuSignature({ rawBody: raw, signatureHeader: "", secret: "secret", now }), false);
  assert.equal(verifyKhipuSignature({ rawBody: raw, signatureHeader: `t=${now},s=bad`, secret: "secret", now }), false);
  const old = now - 600_000;
  assert.equal(verifyKhipuSignature({ rawBody: raw, signatureHeader: `t=${old},s=${signature(raw, "secret", old)}`, secret: "secret", now }), false);
  assert.equal(verifyKhipuSignature({ rawBody: raw, signatureHeader: `t=${now},s=${signature(raw, "secret", now)}`, secret: "secret", now }), true);
});

test("Khipu binds payment, amount, currency, receiver, tenant and appointment", () => {
  assert.deepEqual(verifyKhipuPayment(intent, null, "999"), { ok: false, reason: "missing_payment" });
  assert.equal(verifyKhipuPayment(intent, { ...khipuPayment, amount: 1 }, "999").reason, "amount_mismatch");
  assert.equal(verifyKhipuPayment(intent, { ...khipuPayment, payment_id: "other" }, "999").reason, "payment_id_mismatch");
  assert.equal(verifyKhipuPayment(intent, { ...khipuPayment, custom: JSON.stringify({ tenantId: "other", appointmentId: intent.appointment_id }) }, "999").reason, "binding_mismatch");
  assert.equal(verifyKhipuPayment(intent, { ...khipuPayment, custom: JSON.stringify({ tenantId: intent.tenant_id, appointmentId: "other" }) }, "999").reason, "binding_mismatch");
  assert.equal(verifyKhipuPayment(intent, khipuPayment, "999").ok, true);
});

test("Webpay rejects unknown/manipulated critical fields and accepts exact transaction", () => {
  const transaction = {
    buy_order: intent.buy_order,
    session_id: intent.session_id,
    amount: intent.amount,
    status: "AUTHORIZED",
    response_code: 0,
  };
  assert.equal(verifyWebpayCommit(null, transaction, intent.provider_payment_id).reason, "missing_transaction");
  assert.equal(verifyWebpayCommit(intent, transaction, "unknown").reason, "token_mismatch");
  assert.equal(verifyWebpayCommit(intent, { ...transaction, buy_order: "other" }, intent.provider_payment_id).reason, "buy_order_mismatch");
  assert.equal(verifyWebpayCommit(intent, { ...transaction, session_id: "other" }, intent.provider_payment_id).reason, "session_id_mismatch");
  assert.equal(verifyWebpayCommit(intent, { ...transaction, amount: 1 }, intent.provider_payment_id).reason, "amount_mismatch");
  assert.equal(verifyWebpayCommit(intent, transaction, intent.provider_payment_id).ok, true);
});

test("financial transition is locked and returns false on replay", () => {
  const sql = readFileSync(new URL("../../migrations/202607230001_security_hardening.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.activate_payment_intent/);
  assert.match(sql, /from public\.payment_intents[\s\S]*for update;/);
  assert.match(sql, /if v_intent\.status = 'succeeded' then return false;/);
  assert.match(sql, /update public\.appointments[\s\S]*coalesce\(payment_status, ''\) <> 'paid'/);
  assert.match(sql, /return true;/);
  assert.doesNotMatch(sql, /language plpgsql\nlanguage plpgsql/);
});
