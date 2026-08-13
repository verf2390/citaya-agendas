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
  appointmentOperationalCommunication: false,
  sendExternalEmail: false,
  sendCampaign: false,
  callExternalAutomation: false,
  enqueueDte: false,
  manualDteEnqueue: false,
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
  /** @type {TenantLifecycleStatus} */
  const lifecycleStatus = input?.lifecycleStatus === "active" ||
    input?.lifecycleStatus === "archived" ||
    input?.lifecycleStatus === "suspended"
    ? input.lifecycleStatus
    : "unknown";
  /** @type {TenantOperationalMode} */
  let operationalMode = "unclassified";
  if (lifecycleStatus !== "unknown" && (
    input?.operationalMode === "unclassified" ||
    input?.operationalMode === "demo" ||
    input?.operationalMode === "live" ||
    input?.operationalMode === "internal"
  )) {
    operationalMode = input.operationalMode;
  }
  if (lifecycleStatus !== "active") {
    return {
      ...blocked,
      lifecycleStatus,
      operationalMode,
      exceptionalPlatformAccess: lifecycleStatus === "archived",
      classificationAdmin: true,
    };
  }
  if (operationalMode === "demo") {
    return {
      ...blocked,
      lifecycleStatus,
      operationalMode,
      informationalPage: true,
      demoSimulation: true,
      createAppointment: true,
      appointmentOperationalCommunication: true,
      ordinaryAdmin: true,
    };
  }
  if (operationalMode === "live") {
    return {
      ...blocked, lifecycleStatus, operationalMode, informationalPage: true,
      createAppointment: true, createPayment: true, confirmTransfer: true,
      acceptPaymentWebhook: true, appointmentOperationalCommunication: true,
      sendExternalEmail: true, sendCampaign: true,
      callExternalAutomation: true, enqueueDte: true, manualDteEnqueue: true, runDteWorker: true,
      publicTaxDocument: true, taxAdministration: true, ordinaryAdmin: true,
    };
  }
  if (operationalMode === "internal") {
    return {
      ...blocked, lifecycleStatus, operationalMode, informationalPage: true, taxAdministration: true,
      dteCertification: true, ordinaryAdmin: true, manualDteEnqueue: true,
    };
  }
  return { ...blocked, lifecycleStatus, operationalMode, informationalPage: true, classificationAdmin: true };
}

/**
 * Allows persisted demo appointments only while every financial, tax and
 * general external-effect capability remains fail-closed.
 *
 * @param {Partial<TenantOperationalCapabilities> | null | undefined} capabilities
 */
export function isSafeDemoAppointmentMode(capabilities) {
  if (!capabilities) return false;
  return capabilities.lifecycleStatus === "active" &&
    capabilities.operationalMode === "demo" &&
    capabilities.demoSimulation === true &&
    capabilities.createAppointment === true &&
    capabilities.appointmentOperationalCommunication === true &&
    capabilities.createPayment === false &&
    capabilities.confirmTransfer === false &&
    capabilities.acceptPaymentWebhook === false &&
    capabilities.sendExternalEmail === false &&
    capabilities.sendCampaign === false &&
    capabilities.callExternalAutomation === false &&
    capabilities.enqueueDte === false &&
    capabilities.manualDteEnqueue === false &&
    capabilities.runDteWorker === false &&
    capabilities.publicTaxDocument === false &&
    capabilities.taxAdministration === false &&
    capabilities.dteCertification === false;
}
