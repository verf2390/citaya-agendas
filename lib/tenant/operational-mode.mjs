/** @typedef {import("./operational-types").TenantLifecycleStatus} TenantLifecycleStatus */
/** @typedef {import("./operational-types").TenantOperationalMode} TenantOperationalMode */
/** @typedef {import("./operational-types").TenantOperationalCapabilities} TenantOperationalCapabilities */

/** @type {readonly TenantOperationalMode[]} */
export const TENANT_OPERATIONAL_MODES = Object.freeze([
  "unclassified", "demo", "live", "internal",
]);

const blocked = Object.freeze({
  informationalPage: false,
  demoSimulation: false,
  createAppointment: false,
  createPayment: false,
  confirmTransfer: false,
  acceptPaymentWebhook: false,
  sendExternalEmail: false,
  sendCampaign: false,
  callExternalAutomation: false,
  enqueueDte: false,
  runDteWorker: false,
  publicTaxDocument: false,
  taxAdministration: false,
  dteCertification: false,
  ordinaryAdmin: false,
  exceptionalPlatformAccess: false,
  classificationAdmin: false,
});

/**
 * @param {{ lifecycleStatus?: unknown, operationalMode?: unknown } | null | undefined} input
 * @returns {TenantOperationalCapabilities}
 */
export function resolveTenantOperationalCapabilities(input) {
  const lifecycleStatusIsKnown = input?.lifecycleStatus === "active" || input?.lifecycleStatus === "archived";
  /** @type {TenantLifecycleStatus} */
  const lifecycleStatus = input?.lifecycleStatus === "archived" ? "archived" : "active";
  /** @type {TenantOperationalMode} */
  let operationalMode = "unclassified";
  if (lifecycleStatusIsKnown && (
    input?.operationalMode === "unclassified" ||
    input?.operationalMode === "demo" ||
    input?.operationalMode === "live" ||
    input?.operationalMode === "internal"
  )) {
    operationalMode = input.operationalMode;
  }
  if (lifecycleStatus === "archived") {
    return { ...blocked, lifecycleStatus, operationalMode, exceptionalPlatformAccess: true, classificationAdmin: true };
  }
  if (operationalMode === "demo") {
    return { ...blocked, lifecycleStatus, operationalMode, informationalPage: true, demoSimulation: true, ordinaryAdmin: true };
  }
  if (operationalMode === "live") {
    return {
      ...blocked, lifecycleStatus, operationalMode, informationalPage: true,
      createAppointment: true, createPayment: true, confirmTransfer: true,
      acceptPaymentWebhook: true, sendExternalEmail: true, sendCampaign: true,
      callExternalAutomation: true, enqueueDte: true, runDteWorker: true,
      publicTaxDocument: true, taxAdministration: true, ordinaryAdmin: true,
    };
  }
  if (operationalMode === "internal") {
    return {
      ...blocked, lifecycleStatus, operationalMode, informationalPage: true, taxAdministration: true,
      dteCertification: true, ordinaryAdmin: true,
    };
  }
  return { ...blocked, lifecycleStatus, operationalMode, informationalPage: true, classificationAdmin: true };
}

export function createDemoSimulation() {
  return {
    ok: true,
    demoSimulation: true,
    ephemeralId: `demo_${crypto.randomUUID()}`,
    persisted: false,
    externalContact: false,
    summary: {
      title: "Simulación de reserva",
      message: "La demostración finalizó sin crear una reserva real ni guardar datos personales.",
    },
  };
}
