import type { TaxDocumentDraft } from "../types";

export type DtePrintEnvironment = "LAB" | "CERTIFICATION" | "PRODUCTION";

export type DtePrintDocument = Pick<
  TaxDocumentDraft,
  | "documentType"
  | "folio"
  | "issueDate"
  | "issuer"
  | "recipient"
  | "lines"
  | "netAmount"
  | "taxAmount"
  | "exemptAmount"
  | "totalAmount"
> & {
  environment: DtePrintEnvironment;
  statusLabel: string;
  tedStatus: "pending" | "real";
  trackId?: string | null;
};

export type DtePdfBuildResult = {
  ok: true;
  fileName: string;
  dataUri: string;
  warnings: string[];
  isProductionValid: false;
};

