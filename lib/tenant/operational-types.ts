export type TenantLifecycleStatus = "active" | "archived";

export type TenantOperationalMode = "unclassified" | "demo" | "live" | "internal";

export type TenantOperationalCapabilities = {
  lifecycleStatus: TenantLifecycleStatus;
  operationalMode: TenantOperationalMode;
  informationalPage: boolean;
  demoSimulation: boolean;
  createAppointment: boolean;
  createPayment: boolean;
  confirmTransfer: boolean;
  acceptPaymentWebhook: boolean;
  sendExternalEmail: boolean;
  sendCampaign: boolean;
  callExternalAutomation: boolean;
  enqueueDte: boolean;
  runDteWorker: boolean;
  publicTaxDocument: boolean;
  taxAdministration: boolean;
  dteCertification: boolean;
  ordinaryAdmin: boolean;
  exceptionalPlatformAccess: boolean;
  classificationAdmin: boolean;
};
