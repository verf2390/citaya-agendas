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
  dteEnvironment: "lab" | "certification" | "production";
};

export type DteIssuerLab = TenantTaxProfile;

export type DteLabIssuer = {
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  comuna: string;
  ciudad: string;
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

export type DteRecipientLab = TaxDocumentRecipient;

export type DteLabRecipient = {
  rut: string;
  razonSocial: string;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  email?: string | null;
};

export type TaxDocumentLine = {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  exempt?: boolean;
  unitOfMeasure?: string | null;
  discountPercent?: number | null;
  discountAmount?: number | null;
};

export type TaxDocumentReference = {
  code: string;
  reason: string;
  documentType?: string | null;
  folio?: string | null;
  date?: string | null;
  isGlobal?: boolean | null;
};

export type DteDocumentDetailLab = TaxDocumentLine;

export type DteLabDetail = {
  nombre: string;
  descripcion?: string | null;
  cantidad: number;
  precioUnitario: number;
  montoItem: number;
};

export type DteDocumentTotalsLab = {
  netAmount?: number | null;
  exemptAmount?: number | null;
  taxAmount?: number | null;
  totalAmount: number;
};

export type DteLabTotals = {
  montoNeto?: number | null;
  montoExento?: number | null;
  iva?: number | null;
  montoTotal: number;
};

export type DteDocumentIdentificationLab = {
  documentType: DteDocumentType;
  folio: number;
  issueDate: string;
};

export type DteLabDocumentIdentification = {
  tipoDte: DteDocumentType;
  folio: number;
  fechaEmision: string;
};

export type DteDocumentHeaderLab = DteDocumentIdentificationLab &
  DteDocumentTotalsLab & {
    issuer: DteIssuerLab;
    recipient: DteRecipientLab;
  };

export type DteLabHeader = DteLabDocumentIdentification &
  DteLabTotals & {
    emisor: DteLabIssuer;
    receptor: DteLabRecipient;
  };

export type DteLabDocument = DteLabHeader & {
  detalles: DteLabDetail[];
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
  references?: TaxDocumentReference[];
  globalDiscount?: { discountType: "D" | "R"; valueType: "%" | "$"; value: number; appliesTo: "affected" | "exempt" } | null;
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

export type DteXmlBuildMode = "lab" | "xsd-structure" | "certification";

export type DteEnvelopeBuildOptions = {
  mode?: DteXmlBuildMode;
  tedXml?: string | null;
  documentSignatureXml?: string | null;
  envioSignatureXml?: string | null;
  documentSignedAt?: string | null;
  rutEnvia?: string | null;
  setDteId?: string | null;
  perDocumentXml?: Record<string, { tedXml?: string | null; documentSignatureXml?: string | null; documentSignedAt?: string | null; fullDteXml?: string | null }> | null;
  globalDiscount?: { discountType: "D" | "R"; valueType: "%" | "$"; value: number; appliesTo: "affected" | "exempt" } | null;
  preserveTedWhitespace?: boolean | null;
};

export type DteXmlLabResult = DteGenerationResult;

export type DteGenerationError = {
  ok: false;
  status: "error";
  error: string;
};

export type SigningCertificateInput = {
  tenantId: string;
  certificateRut?: string | null;
  certificateSubject?: string | null;
  certificateBuffer?: Buffer | null;
  certificatePem?: string | null;
  privateKeyPem?: string | null;
  password?: string | null;
};

export type XmlSignatureOptions = {
  signatureTarget: string;
  canonicalizationMethod: string;
  signatureMethod: string;
  digestMethod: string;
  includeKeyInfo: boolean;
  mode: "mock" | "lab";
};

export type SignedXmlResult = {
  signedXml: string;
  signatureId: string;
  signedAt: string;
  mode: "mock" | "lab";
  warnings: string[];
  xsdReference: "xmldsignature_v10.xsd";
  isProductionValid: false;
};

export type RealXmlSigningConfig = {
  tenantId: string;
  mode: "lab" | "certification" | "production";
  certificatePath?: string | null;
  certificatePassword?: string | null;
  privateKeyPath?: string | null;
  publicCertificatePath?: string | null;
  signatureTarget: string;
};

export type RealXmlSigningPreparationResult = {
  ok: false;
  status: "pending_dependency" | "missing_secret" | "unsafe_repo_path" | "unsupported_certificate_format" | "failed" | "blocked";
  mode: "lab" | "certification" | "production";
  isProductionValid: false;
  missing: string[];
  warnings: string[];
};

export type CafLabData = {
  tenantId: string;
  issuerRut: string;
  documentType: DteDocumentType;
  rangeFrom: number;
  rangeTo: number;
  issuedAt: string;
  expiresAt?: string | null;
  authorizationDate?: string | null;
  rawXmlHash?: string | null;
  mode: "lab";
  isProductionValid: false;
};

export type CafRealData = {
  tenantId: string;
  issuerRut: string;
  issuerLegalName?: string | null;
  documentType: DteDocumentType;
  rangeFrom: number;
  rangeTo: number;
  authorizationDate: string;
  cafXmlHash: string;
  cafXml?: string | null;
  publicKeyAlgorithm?: string | null;
  publicKeyModulus?: string | null;
  publicKeyExponent?: string | null;
  keyId?: string | null;
  cafSignature?: string | null;
  mode: "controlled";
  isProductionValid: false;
};

export type TedInput = {
  issuerRut: string;
  documentTypeCode: number;
  folio: number;
  issueDate: string;
  recipientRut: string;
  recipientLegalName: string;
  totalAmount: number;
  firstItemName: string;
  cafXml: string;
  timestamp?: string;
  frmtXml?: string | null;
  frmtStatus?: "synthetic_lab" | "pending_real_signature" | "real_controlled";
  compact?: boolean;
};

export type TedBuildResult = {
  tedXml: string;
  ddXml: string;
  frmtStatus: "synthetic_lab" | "pending_real_signature" | "real_controlled";
  warnings: string[];
  isProductionValid: false;
};

export type FrmtSignatureInput = {
  ddXml: string;
  inputEncoding?: "utf8" | "latin1";
  privateKeyPem?: string | null;
  privateKeyPath?: string | null;
  mode: "lab" | "xsd-structure" | "certification" | "production";
};

export type FrmtSignatureResult =
  | {
      ok: true;
      frmtXml: string;
      mode: "xsd-structure" | "certification";
      isProductionValid: false;
      warnings: string[];
    }
  | {
      ok: false;
      status: "missing_secret" | "unsafe_repo_path" | "unsupported_certificate_format" | "failed" | "blocked";
      mode: "lab" | "xsd-structure" | "certification" | "production";
      isProductionValid: false;
      missing: string[];
      warnings: string[];
    };

export type XmlDsigBuildInput = {
  referenceUri: string;
  signedXmlFragment: string;
  mode: "xsd-structure" | "certification";
  signatureId?: string;
};

export type XmlSignatureStatus =
  | "ready_controlled"
  | "verified_controlled"
  | "pending_real_certification"
  | "missing_external_file"
  | "unsafe_repo_path"
  | "unsupported_certificate_format"
  | "xsd_failed"
  | "verification_failed"
  | "failed";

export type XmlDsigBuildResult = {
  signatureXml: string;
  mode: "xsd-structure" | "certification";
  isProductionValid: false;
  warnings: string[];
  signed?: boolean;
  xmlSignatureStatus?: XmlSignatureStatus;
  canonicalizationMethod?: string;
  digestMethod?: string;
  signatureMethod?: string;
  transforms?: string[];
  referenceUri?: string;
  digestValueSha256?: string;
  signatureValueSha256?: string;
  verification?: {
    attempted: boolean;
    ok: boolean;
    reason?: string;
  };
  reason?: string | null;
};

export type SiiEnvironment = "lab" | "certification" | "production";

export type SiiClientConfig = {
  environment: SiiEnvironment;
  baseUrl?: string | null;
  rutEmpresa?: string | null;
  rutUsuario?: string | null;
  timeoutMs?: number;
};

export type SiiRejectReason = {
  code: string;
  message: string;
  field?: string | null;
};

export type SiiSendResult = {
  ok: boolean;
  environment: SiiEnvironment;
  trackId?: string | null;
  status: "pending" | "sent_to_sii" | "rejected" | "error";
  errors: SiiRejectReason[];
  isProductionValid: false;
};

export type SiiTrackStatusResult = {
  ok: boolean;
  environment: SiiEnvironment;
  trackId: string;
  siiStatus: "pending" | "accepted" | "rejected" | "unknown" | "error";
  errors: SiiRejectReason[];
  checkedAt: string;
  isProductionValid: false;
};

export type FolioReservation = {
  tenantId: string;
  documentType: DteDocumentType;
  folio: number;
  status: "reserved" | "used" | "released" | "voided";
  reservedAt: string;
  usedAt?: string | null;
  documentId?: string | null;
};

export type FolioState = {
  tenantId: string;
  documentType: DteDocumentType;
  currentFolio: number;
  rangeFrom: number;
  rangeTo: number;
  availableCount: number;
  usedCount: number;
  reservations: FolioReservation[];
};
