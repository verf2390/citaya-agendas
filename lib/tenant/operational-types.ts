export type TenantLifecycleStatus = "active" | "archived" | "suspended" | "unknown";

export type TenantOperationalMode = "unclassified" | "demo" | "live" | "internal";

export type TenantTaxDocumentMode = "unconfigured" | "citaya_dte" | "external_bhe";

export type TenantOperationalCapabilities = {
  lifecycleStatus: TenantLifecycleStatus;
  operationalMode: TenantOperationalMode;
  informationalPage: boolean;
  demoSimulation: boolean;
  createAppointment: boolean;
  createPayment: boolean;
  confirmTransfer: boolean;
  acceptPaymentWebhook: boolean;
  appointmentOperationalCommunication: boolean;
  sendExternalEmail: boolean;
  sendCampaign: boolean;
  callExternalAutomation: boolean;
  bheAutomation: boolean;
  enqueueDte: boolean;
  manualDteEnqueue: boolean;
  runDteWorker: boolean;
  publicTaxDocument: boolean;
  taxAdministration: boolean;
  dteCertification: boolean;
  ordinaryAdmin: boolean;
  exceptionalPlatformAccess: boolean;
  classificationAdmin: boolean;
};
