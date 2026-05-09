import type { DteDocumentType } from "./dte-types";

export type DteIssueMode =
  | "manual_mipyme"
  | "external_provider"
  | "citaya_own_dte";

export type TaxDocumentStatus =
  | "draft"
  | "pending_signature"
  | "signed"
  | "pending_send"
  | "sent_to_sii"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "error"
  | "pending_manual_issue"
  | "issued_manual";

export type TenantTaxProfile = {
  tenantId: string;
  rut: string;
  legalName: string;
  businessActivity: string;
  businessActivityCode?: string | null;
  address: string;
  commune: string;
  city: string;
  siiResolutionDate?: string | null;
  siiResolutionNumber?: string | null;
  dteEnvironment: "certification" | "production";
};

export type TaxDocumentRecipient = {
  rut: string;
  legalName: string;
  businessActivity?: string | null;
  address?: string | null;
  commune?: string | null;
  city?: string | null;
  email?: string | null;
};

export type TaxDocumentLine = {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  exempt?: boolean;
};

export type TaxDocumentDraft = {
  tenantId: string;
  issueMode: DteIssueMode;
  documentType: DteDocumentType;
  status: TaxDocumentStatus;
  folio: number;
  issueDate: string;
  issuer: TenantTaxProfile;
  recipient: TaxDocumentRecipient;
  lines: TaxDocumentLine[];
  netAmount?: number | null;
  taxAmount?: number | null;
  exemptAmount?: number | null;
  totalAmount: number;
  appointmentId?: string | null;
  paymentId?: string | null;
  customerId?: string | null;
};

export type DteGenerationResult = {
  ok: true;
  documentType: DteDocumentType;
  folio: number;
  status: TaxDocumentStatus;
  xml: string;
  warnings: string[];
};

export type DteGenerationError = {
  ok: false;
  status: "error";
  error: string;
};

