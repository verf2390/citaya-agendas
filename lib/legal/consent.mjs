export const REQUIRED_BOOKING_DOCUMENTS = [
  "consumer_terms",
  "privacy_notice",
  "cancellation_refund_policy",
];

const HASH = /^[a-f0-9]{64}$/;

export function validatePublicLegalConsent({ tenantId, bundle, consent }) {
  if (!tenantId || bundle?.tenantId !== tenantId || !bundle?.identity?.complete) {
    return { ok: false, error: "LEGAL_TENANT_NOT_READY" };
  }

  const required = [...REQUIRED_BOOKING_DOCUMENTS];
  if (bundle.handlesSensitiveData) required.push("sensitive_data_authorization");

  for (const type of required) {
    const published = bundle.documents?.[type];
    const accepted = consent?.[type];
    if (
      !published ||
      accepted?.accepted !== true ||
      accepted.documentId !== published.id ||
      accepted.version !== published.version ||
      accepted.hash !== published.hash ||
      !HASH.test(String(accepted.hash ?? "")) ||
      String(accepted.declaration ?? "").trim().length < 10
    ) {
      return { ok: false, error: `LEGAL_ACCEPTANCE_REQUIRED:${type}` };
    }
  }

  const marketing = consent?.marketing;
  if (marketing?.accepted === true) {
    if (
      marketing.channel !== "email" ||
      String(marketing.purpose ?? "").trim().length < 10
    ) {
      return { ok: false, error: "MARKETING_CONSENT_INVALID" };
    }
  }

  return { ok: true, value: consent };
}
