import { randomUUID } from "node:crypto";

import { sha256String } from "./dte-hash";
import { fingerprintToken, redactSiiResponse } from "./dte-redaction";
import type {
  DtePersistenceEnvironment,
  DteSiiStatus,
  TaxDocumentSubmissionRecord,
} from "./dte-persistence-types";

export type BuildSubmissionInput = {
  id?: string;
  tenantId: string;
  taxDocumentId: string;
  environment: DtePersistenceEnvironment;
  trackId?: string | null;
  submissionStatus: TaxDocumentSubmissionRecord["submissionStatus"];
  siiStatus: DteSiiStatus;
  requestXml?: string | null;
  response?: unknown;
  token?: string | null;
  submittedAt?: string | null;
  checkedAt?: string | null;
  now?: string;
};

export function buildSubmissionRecord(
  input: BuildSubmissionInput,
): TaxDocumentSubmissionRecord {
  const responseRedacted =
    input.response === undefined ? null : redactSiiResponse(input.response);

  return {
    id: input.id ?? randomUUID(),
    tenantId: input.tenantId,
    taxDocumentId: input.taxDocumentId,
    environment: input.environment,
    trackId: input.trackId ?? null,
    submissionStatus: input.submissionStatus,
    siiStatus: input.siiStatus,
    requestXmlSha256: input.requestXml ? sha256String(input.requestXml) : null,
    responseSha256: responseRedacted?.sha256 ?? null,
    rawResponseRedacted: responseRedacted,
    tokenFingerprint: fingerprintToken(input.token),
    submittedAt: input.submittedAt ?? null,
    checkedAt: input.checkedAt ?? null,
    createdAt: input.now ?? new Date().toISOString(),
  };
}
