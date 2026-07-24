import type { TaxDocumentDraft } from "../types";

export const PRODUCTION_DTE_TYPES = [33, 56, 61] as const;
export type ProductionDteType = (typeof PRODUCTION_DTE_TYPES)[number];
export type ProductionDocumentStatus =
  | "draft"
  | "prepared"
  | "ready"
  | "submitting"
  | "submitted"
  | "rejected"
  | "ambiguous";
export type ProductionFolioStatus =
  | "reserved"
  | "issued"
  | "void"
  | "contingency";

export type ProductionIssuer = {
  rut: string;
  legalName: string;
  businessActivity: string;
  businessActivityCode?: string | null;
  address: string;
  commune: string;
  city: string;
  resolutionDate: string;
  resolutionNumber: string;
  siiOffice: string;
};

export type ProductionTenantSettings = {
  tenantId: string;
  enabled: boolean;
  issuer: ProductionIssuer;
  senderRut: string;
  certificatePath: string;
  privateKeyPath: string;
  certificateValidFrom: string;
  autoEmailDelivery: boolean;
  certificateValidTo: string;
};

export type ProductionCafMetadata = {
  id: string;
  tenantId: string;
  dteType: ProductionDteType;
  issuerRut: string;
  rangeFrom: number;
  rangeTo: number;
  authorizationDate: string;
  sha256: string;
  logicalIdentity: string;
  secureRef: string;
  trustStatus: "verified_official";
  active: boolean;
};

export type ProductionDraftInput = {
  tenantId: string;
  dteType: ProductionDteType;
  businessOperationId: string;
  recipient: {
    rut: string;
    legalName: string;
    businessActivity?: string | null;
    address?: string | null;
    commune?: string | null;
    city?: string | null;
    email: string;
  };
  lines: Array<{
    name: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    exempt?: boolean;
    discountPercent?: number | null;
  }>;
  references?: TaxDocumentDraft["references"];
};

export type ProductionDocument = {
  id: string;
  tenantId: string;
  dteType: ProductionDteType;
  businessOperationId: string;
  status: ProductionDocumentStatus;
  folio: number | null;
  cafId: string | null;
  recipient: ProductionDraftInput["recipient"];
  lines: ProductionDraftInput["lines"];
  references: NonNullable<ProductionDraftInput["references"]>;
  netAmount: number;
  exemptAmount: number;
  taxAmount: number;
  totalAmount: number;
  issueDate: string;
  trackId: string | null;
  siiStatus: string | null;
  finalResponseSha256: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductionArtifactKind = "dte_xml" | "envio_xml" | "pdf" | "sii_response";
export type ProductionArtifact = {
  id: string;
  tenantId: string;
  documentId: string;
  kind: ProductionArtifactKind;
  storageKey: string;
  sha256: string;
  byteLength: number;
  contentType: string;
  immutable: true;
  createdAt: string;
};

export type ProductionSubmissionAttempt = {
  id: string;
  tenantId: string;
  documentId: string;
  attemptNumber: 1;
  status: "persisted" | "uploading" | "submitted" | "rejected" | "ambiguous";
  requestSha256: string;
  responseSha256: string | null;
  responseSafe: Record<string, unknown> | null;
  trackId: string | null;
  beforeFetchAt: string | null;
  afterFetchAt: string | null;
  createdAt: string;
};

export type RecipientOutboxRecord = {
  id: string;
  tenantId: string;
  documentId: string;
  recipientEmail: string;
  idempotencyKey: string;
  status: "pending" | "delivering" | "delivered" | "failed";
  xmlArtifactId: string;
  pdfArtifactId: string;
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
};

export type SafeProductionAudit = {
  id: string;
  tenantId: string;
  documentId: string | null;
  action: string;
  actorId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};
