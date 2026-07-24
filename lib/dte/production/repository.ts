import { createHash, randomUUID } from "node:crypto";

import type {
  ProductionArtifact,
  ProductionArtifactKind,
  ProductionCafMetadata,
  ProductionDocument,
  ProductionDocumentStatus,
  ProductionDraftInput,
  ProductionDteType,
  ProductionSubmissionAttempt,
  ProductionTenantSettings,
  RecipientOutboxRecord,
  SafeProductionAudit,
} from "./types";

export type ReserveProductionFolioInput = {
  tenantId: string;
  dteType: ProductionDteType;
  documentId: string;
  businessOperationId: string;
};

export interface ProductionDteRepository {
  getTenantSettings(tenantId: string): Promise<ProductionTenantSettings | null>;
  importCaf(metadata: ProductionCafMetadata): Promise<void>;
  selectCaf(
    tenantId: string,
    dteType: ProductionDteType,
    folio: number,
  ): Promise<ProductionCafMetadata | null>;
  createDraft(
    input: ProductionDraftInput & {
      createdBy: string;
      issueDate: string;
      netAmount: number;
      exemptAmount: number;
      taxAmount: number;
      totalAmount: number;
    },
  ): Promise<ProductionDocument>;
  getDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionDocument | null>;
  reserveFolio(input: ReserveProductionFolioInput): Promise<{
    folio: number;
    cafId: string;
    reused: boolean;
  }>;
  transitionDocument(input: {
    tenantId: string;
    documentId: string;
    from: ProductionDocumentStatus[];
    to: ProductionDocumentStatus;
    patch?: Partial<Pick<
      ProductionDocument,
      "folio" | "cafId" | "trackId" | "siiStatus" | "finalResponseSha256"
    >>;
  }): Promise<ProductionDocument>;
  storeArtifact(
    artifact: Omit<ProductionArtifact, "id" | "createdAt" | "immutable">,
  ): Promise<ProductionArtifact>;
  listArtifacts(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionArtifact[]>;
  createSubmissionAttempt(
    input: Omit<ProductionSubmissionAttempt, "id" | "createdAt">,
  ): Promise<ProductionSubmissionAttempt>;
  updateSubmissionAttempt(
    tenantId: string,
    attemptId: string,
    patch: Partial<ProductionSubmissionAttempt>,
  ): Promise<ProductionSubmissionAttempt>;
  getSubmissionAttempt(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionSubmissionAttempt | null>;
  enqueueRecipientDelivery(
    input: Omit<RecipientOutboxRecord, "id" | "createdAt" | "deliveredAt" | "attempts" | "status">,
  ): Promise<RecipientOutboxRecord>;
  appendAudit(
    input: Omit<SafeProductionAudit, "id" | "createdAt">,
  ): Promise<SafeProductionAudit>;
  listAudit(
    tenantId: string,
    documentId: string,
  ): Promise<SafeProductionAudit[]>;
}

type FolioRow = {
  tenantId: string;
  dteType: ProductionDteType;
  folio: number;
  cafId: string;
  state: "available" | "reserved" | "issued" | "void" | "contingency";
  documentId: string | null;
  businessOperationId: string | null;
};

function identity(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryProductionDteRepository implements ProductionDteRepository {
  private settings = new Map<string, ProductionTenantSettings>();
  private cafs: ProductionCafMetadata[] = [];
  private folios: FolioRow[] = [];
  private documents: ProductionDocument[] = [];
  private artifacts: ProductionArtifact[] = [];
  private attempts: ProductionSubmissionAttempt[] = [];
  private outbox: RecipientOutboxRecord[] = [];
  private audit: SafeProductionAudit[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  seedTenantSettings(settings: ProductionTenantSettings): void {
    this.settings.set(settings.tenantId, clone(settings));
  }

  outboxRecords(): RecipientOutboxRecord[] {
    return clone(this.outbox);
  }

  folioRows(): FolioRow[] {
    return clone(this.folios);
  }

  async getTenantSettings(
    tenantId: string,
  ): Promise<ProductionTenantSettings | null> {
    return clone(this.settings.get(tenantId) ?? null);
  }

  async importCaf(metadata: ProductionCafMetadata): Promise<void> {
    await this.transaction(async () => {
      if (
        this.cafs.some(
          (caf) =>
            caf.tenantId === metadata.tenantId &&
            (caf.sha256 === metadata.sha256 ||
              caf.logicalIdentity === metadata.logicalIdentity),
        )
      )
        throw new Error("DTE_CAF_DUPLICATE");
      if (
        this.cafs.some(
          (caf) =>
            caf.tenantId === metadata.tenantId &&
            caf.dteType === metadata.dteType &&
            caf.rangeFrom <= metadata.rangeTo &&
            metadata.rangeFrom <= caf.rangeTo,
        )
      )
        throw new Error("DTE_CAF_RANGE_OVERLAP");
      this.cafs.push(clone(metadata));
      for (let folio = metadata.rangeFrom; folio <= metadata.rangeTo; folio += 1) {
        this.folios.push({
          tenantId: metadata.tenantId,
          dteType: metadata.dteType,
          folio,
          cafId: metadata.id,
          state: "available",
          documentId: null,
          businessOperationId: null,
        });
      }
    });
  }

  async selectCaf(
    tenantId: string,
    dteType: ProductionDteType,
    folio: number,
  ): Promise<ProductionCafMetadata | null> {
    const matches = this.cafs.filter(
      (caf) =>
        caf.active &&
        caf.tenantId === tenantId &&
        caf.dteType === dteType &&
        caf.rangeFrom <= folio &&
        caf.rangeTo >= folio,
    );
    if (matches.length > 1) throw new Error("DTE_CAF_COVERAGE_NOT_UNIQUE");
    return clone(matches[0] ?? null);
  }

  async createDraft(
    input: ProductionDraftInput & {
      createdBy: string;
      issueDate: string;
      netAmount: number;
      exemptAmount: number;
      taxAmount: number;
      totalAmount: number;
    },
  ): Promise<ProductionDocument> {
    const existing = this.documents.find(
      (document) =>
        document.tenantId === input.tenantId &&
        document.businessOperationId === input.businessOperationId,
    );
    if (existing) return clone(existing);
    const now = new Date().toISOString();
    const document: ProductionDocument = {
      id: `dte_${identity(input.tenantId, input.businessOperationId)}`,
      tenantId: input.tenantId,
      dteType: input.dteType,
      businessOperationId: input.businessOperationId,
      status: "draft",
      folio: null,
      cafId: null,
      recipient: clone(input.recipient),
      lines: clone(input.lines),
      references: clone(input.references ?? []),
      netAmount: input.netAmount,
      exemptAmount: input.exemptAmount,
      taxAmount: input.taxAmount,
      totalAmount: input.totalAmount,
      issueDate: input.issueDate,
      trackId: null,
      siiStatus: null,
      finalResponseSha256: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.documents.push(document);
    return clone(document);
  }

  async getDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionDocument | null> {
    return clone(
      this.documents.find(
        (document) =>
          document.tenantId === tenantId && document.id === documentId,
      ) ?? null,
    );
  }

  async reserveFolio(input: ReserveProductionFolioInput): Promise<{
    folio: number;
    cafId: string;
    reused: boolean;
  }> {
    return this.transaction(async () => {
      const reused = this.folios.find(
        (row) =>
          row.tenantId === input.tenantId &&
          row.dteType === input.dteType &&
          row.businessOperationId === input.businessOperationId,
      );
      if (reused) {
        if (
          reused.documentId !== input.documentId ||
          !["reserved", "issued"].includes(reused.state)
        )
          throw new Error("DTE_FOLIO_IDEMPOTENCY_CONFLICT");
        return { folio: reused.folio, cafId: reused.cafId, reused: true };
      }
      const next = this.folios
        .filter(
          (row) =>
            row.tenantId === input.tenantId &&
            row.dteType === input.dteType &&
            row.state === "available",
        )
        .sort((left, right) => left.folio - right.folio)[0];
      if (!next) throw new Error("DTE_FOLIO_EXHAUSTED");
      next.state = "reserved";
      next.documentId = input.documentId;
      next.businessOperationId = input.businessOperationId;
      return { folio: next.folio, cafId: next.cafId, reused: false };
    });
  }

  async transitionDocument(input: {
    tenantId: string;
    documentId: string;
    from: ProductionDocumentStatus[];
    to: ProductionDocumentStatus;
    patch?: Partial<Pick<
      ProductionDocument,
      "folio" | "cafId" | "trackId" | "siiStatus" | "finalResponseSha256"
    >>;
  }): Promise<ProductionDocument> {
    return this.transaction(async () => {
      const document = this.documents.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.id === input.documentId,
      );
      if (!document) throw new Error("DTE_DOCUMENT_NOT_FOUND");
      if (!input.from.includes(document.status))
        throw new Error("DTE_DOCUMENT_STATE_CONFLICT");
      if (document.status === "ambiguous" && input.to === "submitting")
        throw new Error("DTE_AMBIGUOUS_RETRY_BLOCKED");
      Object.assign(document, input.patch ?? {}, {
        status: input.to,
        updatedAt: new Date().toISOString(),
      });
      if (input.to === "submitting" && document.folio !== null) {
        const row = this.folios.find(
          (candidate) =>
            candidate.tenantId === document.tenantId &&
            candidate.dteType === document.dteType &&
            candidate.folio === document.folio,
        );
        if (!row || row.state !== "reserved")
          throw new Error("DTE_FOLIO_STATE_CONFLICT");
        row.state = "issued";
      }
      return clone(document);
    });
  }

  async storeArtifact(
    input: Omit<ProductionArtifact, "id" | "createdAt" | "immutable">,
  ): Promise<ProductionArtifact> {
    const duplicate = this.artifacts.find(
      (artifact) =>
        artifact.tenantId === input.tenantId &&
        artifact.documentId === input.documentId &&
        artifact.kind === input.kind,
    );
    if (duplicate) {
      if (duplicate.sha256 !== input.sha256)
        throw new Error("DTE_ARTIFACT_IMMUTABILITY_CONFLICT");
      return clone(duplicate);
    }
    const record: ProductionArtifact = {
      ...clone(input),
      id: randomUUID(),
      immutable: true,
      createdAt: new Date().toISOString(),
    };
    this.artifacts.push(record);
    return clone(record);
  }

  async listArtifacts(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionArtifact[]> {
    return clone(
      this.artifacts.filter(
        (artifact) =>
          artifact.tenantId === tenantId &&
          artifact.documentId === documentId,
      ),
    );
  }

  async createSubmissionAttempt(
    input: Omit<ProductionSubmissionAttempt, "id" | "createdAt">,
  ): Promise<ProductionSubmissionAttempt> {
    const existing = this.attempts.find(
      (attempt) =>
        attempt.tenantId === input.tenantId &&
        attempt.documentId === input.documentId,
    );
    if (existing) throw new Error("DTE_UPLOAD_ALREADY_ATTEMPTED");
    const record: ProductionSubmissionAttempt = {
      ...clone(input),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.attempts.push(record);
    return clone(record);
  }

  async updateSubmissionAttempt(
    tenantId: string,
    attemptId: string,
    patch: Partial<ProductionSubmissionAttempt>,
  ): Promise<ProductionSubmissionAttempt> {
    const attempt = this.attempts.find(
      (candidate) =>
        candidate.tenantId === tenantId && candidate.id === attemptId,
    );
    if (!attempt) throw new Error("DTE_SUBMISSION_ATTEMPT_NOT_FOUND");
    Object.assign(attempt, clone(patch), {
      id: attempt.id,
      tenantId: attempt.tenantId,
      documentId: attempt.documentId,
      attemptNumber: 1,
    });
    return clone(attempt);
  }

  async getSubmissionAttempt(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionSubmissionAttempt | null> {
    return clone(
      this.attempts.find(
        (attempt) =>
          attempt.tenantId === tenantId &&
          attempt.documentId === documentId,
      ) ?? null,
    );
  }

  async enqueueRecipientDelivery(
    input: Omit<RecipientOutboxRecord, "id" | "createdAt" | "deliveredAt" | "attempts" | "status">,
  ): Promise<RecipientOutboxRecord> {
    const existing = this.outbox.find(
      (record) =>
        record.tenantId === input.tenantId &&
        record.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return clone(existing);
    const record: RecipientOutboxRecord = {
      ...clone(input),
      id: randomUUID(),
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
    };
    this.outbox.push(record);
    return clone(record);
  }

  async appendAudit(
    input: Omit<SafeProductionAudit, "id" | "createdAt">,
  ): Promise<SafeProductionAudit> {
    const record: SafeProductionAudit = {
      ...clone(input),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.audit.push(record);
    return clone(record);
  }

  async listAudit(
    tenantId: string,
    documentId: string,
  ): Promise<SafeProductionAudit[]> {
    return clone(
      this.audit.filter(
        (record) =>
          record.tenantId === tenantId &&
          record.documentId === documentId,
      ),
    );
  }

  private async transaction<T>(action: () => Promise<T> | T): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

export function requiredArtifact(
  artifacts: ProductionArtifact[],
  kind: ProductionArtifactKind,
): ProductionArtifact {
  const matches = artifacts.filter((artifact) => artifact.kind === kind);
  if (matches.length !== 1) throw new Error(`DTE_ARTIFACT_${kind.toUpperCase()}_NOT_UNIQUE`);
  return matches[0];
}
