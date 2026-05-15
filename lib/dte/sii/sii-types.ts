import type { DteOperationalStatus } from "../status/dte-status";

export type SiiCertificationEnvironment = "certification";

export type SiiCertificationConfig = {
  environment: SiiCertificationEnvironment;
  seedUrl: string;
  tokenUrl: string;
  submitUrl: string;
  statusUrl: string;
  certPath?: string | null;
  privateKeyPath?: string | null;
  cafPath?: string | null;
  cafPrivateKeyPath?: string | null;
  rutEmpresa?: string | null;
  rutUsuario?: string | null;
  timeoutMs: number;
  enableSubmit: boolean;
};

export type SiiCertificationStatus =
  | "sent"
  | "processing"
  | "accepted"
  | "accepted_with_observations"
  | "rejected"
  | "unknown"
  | "failed";

export type SiiCertificationStepStatus =
  | "ready"
  | "pending_config"
  | "blocked"
  | "pending_real_certification";

export type SiiSeedResult = {
  ok: boolean;
  seed?: string;
  status: SiiCertificationStepStatus;
  message: string;
  requestedAt: string;
  environment: SiiCertificationEnvironment;
};

export type SiiSignedSeedResult = {
  ok: boolean;
  signedSeed?: string;
  status: SiiCertificationStepStatus;
  message: string;
  signedAt: string;
  environment: SiiCertificationEnvironment;
};

export type SiiTokenResult = {
  ok: boolean;
  token?: string;
  redactedToken?: string | null;
  status: SiiCertificationStepStatus;
  message: string;
  requestedAt: string;
  environment: SiiCertificationEnvironment;
};

export type SiiSubmitCertificationResult = {
  ok: boolean;
  trackId?: string | null;
  rawStatus?: string | null;
  internalStatus: DteOperationalStatus;
  siiStatus: SiiCertificationStatus;
  message: string;
  submittedAt: string;
  environment: SiiCertificationEnvironment;
};

export type SiiStatusCertificationResult = {
  ok: boolean;
  trackId: string;
  rawStatus?: string | null;
  internalStatus: DteOperationalStatus;
  siiStatus: SiiCertificationStatus;
  message: string;
  checkedAt: string;
  environment: SiiCertificationEnvironment;
};

export type SiiParsedResponse = {
  trackId: string | null;
  status: SiiCertificationStatus;
  rawStatus: string | null;
  message: string | null;
};

export type SiiCertificationSmokeResult = {
  ok: boolean;
  dryRun: boolean;
  environment: "certification";
  steps: Array<{
    name: string;
    status: SiiCertificationStepStatus;
    message: string;
  }>;
};
