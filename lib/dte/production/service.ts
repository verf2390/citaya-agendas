import { createHash } from "node:crypto";

import { calculateDteTaxTotals } from "../certification/dte-tax-engine";
import type { ImportedCaf } from "../certification/caf-secure-import";
import { validateRut } from "../rut";
import type { PrivateDteArtifactStore } from "./artifact-store";
import {
  assertExactProductionConfirmation,
  assertProductionConfig,
  type ProductionRuntimeConfig,
} from "./config";
import type {
  ProductionDteGenerator,
  ProductionGeneratedArtifacts,
} from "./generator";
import type { ProductionDteRepository } from "./repository";
import {
  assertValidProductionIssuerActivityCode,
  assertValidProductionIssuerResolution,
} from "./issuer-settings";
import {
  type IProductionSiiClient,
  type ProductionSiiMilestone,
  type ProductionStatusResult,
} from "./sii-client";
import type {
  ProductionDocument,
  ProductionDraftInput,
  ProductionDteType,
  ProductionIssuer,
  ProductionTenantSettings,
} from "./types";

export type ProductionCafLoader = (input: {
  settings: ProductionTenantSettings;
  dteType: ProductionDteType;
  expectedSha256: string;
}) => ImportedCaf;

export type ProductionSiiClientFactory = (
  config: ProductionRuntimeConfig,
  dteType?: ProductionDteType,
) => IProductionSiiClient;

export type ManualStatusTokenProvider = (input: {
  settings: ProductionTenantSettings;
  dteType: ProductionDteType;
  milestone: (event: ProductionSiiMilestone) => Promise<void>;
}) => Promise<string>;

export type ProductionPreparationFailureStage =
  | "runtime_config"
  | "tenant_settings"
  | "issuer_resolution"
  | "issuer_activity_code"
  | "document_load"
  | "material_preflight"
  | "folio_reservation"
  | "document_transition"
  | "caf_load"
  | "artifact_generation"
  | "artifact_persistence"
  | "ready_transition";

export type ProductionPreparationPreflight = (input: {
  tenantId: string;
  dteType: ProductionDteType;
  settings: ProductionTenantSettings;
  document: ProductionDocument;
}) => Promise<void>;

function safePreparationCode(error: unknown): string {
  if (error instanceof ProductionPreparationError) return error.code;
  const message = error instanceof Error ? error.message : "";
  return message.match(/^([A-Z][A-Z0-9_]{2,180})/)?.[1] ??
    "DTE_PRODUCTION_PREPARATION_FAILED";
}

export class ProductionPreparationError extends Error {
  readonly code: string;
  readonly failureStage: ProductionPreparationFailureStage;

  constructor(
    failureStage: ProductionPreparationFailureStage,
    cause: unknown,
  ) {
    const code = safePreparationCode(cause);
    super(code, { cause });
    this.name = "ProductionPreparationError";
    this.code = code;
    this.failureStage = failureStage;
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeBusinessOperationId(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(trimmed))
    throw new Error("DTE_BUSINESS_OPERATION_ID_INVALID");
  return trimmed;
}

function validateRecipient(input: ProductionDraftInput["recipient"]): void {
  if (!validateRut(input.rut)) throw new Error("DTE_RECIPIENT_RUT_INVALID");
  if (!input.legalName.trim()) throw new Error("DTE_RECIPIENT_NAME_REQUIRED");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    input.email.length > 254
  )
    throw new Error("DTE_RECIPIENT_EMAIL_INVALID");
}

function validateReferences(input: ProductionDraftInput): void {
  const references = input.references ?? [];
  if ([56, 61].includes(input.dteType) && references.length < 1)
    throw new Error("DTE_REFERENCE_REQUIRED");
  if (references.length > 40) throw new Error("DTE_REFERENCES_LIMIT_EXCEEDED");
  for (const reference of references) {
    if (
      !String(reference.documentType ?? "").trim() ||
      !String(reference.folio ?? "").trim() ||
      !/^\d{4}-\d{2}-\d{2}(?![\s\S])/.test(String(reference.date ?? "")) ||
      !reference.reason.trim() ||
      reference.reason.length > 90 ||
      reference.code.length > 2
    )
      throw new Error("DTE_REFERENCE_INVALID");
  }
}

function assertSupportedType(type: number): asserts type is ProductionDteType {
  if (![33, 39, 56, 61].includes(type))
    throw new Error("DTE_PRODUCTION_TYPE_UNSUPPORTED");
}

function safeDocument(document: ProductionDocument) {
  return {
    id: document.id,
    tenantId: document.tenantId,
    dteType: document.dteType,
    businessOperationId: document.businessOperationId,
    status: document.status,
    folio: document.folio,
    totalAmount: document.totalAmount,
    issueDate: document.issueDate,
    siiStatus: document.siiStatus,
    hasTrackId: Boolean(document.trackId),
    trackIdFingerprint: document.trackId
      ? sha256(document.trackId).slice(0, 12)
      : null,
    updatedAt: document.updatedAt,
  };
}

function mergeIssuerSnapshot(
  inputIssuer: ProductionIssuer | null | undefined,
  settingsIssuer: ProductionIssuer,
): ProductionIssuer {
  const input = inputIssuer ?? ({} as Partial<ProductionIssuer>);
  return {
    rut: String(input.rut ?? "").trim() || settingsIssuer.rut,
    legalName: String(input.legalName ?? "").trim() || settingsIssuer.legalName,
    businessActivity:
      String(input.businessActivity ?? "").trim() || settingsIssuer.businessActivity,
    businessActivityCode:
      String(input.businessActivityCode ?? "").trim() || settingsIssuer.businessActivityCode || null,
    address: String(input.address ?? "").trim() || settingsIssuer.address,
    commune: String(input.commune ?? "").trim() || settingsIssuer.commune,
    city: String(input.city ?? "").trim() || settingsIssuer.city,
    resolutionDate:
      String(input.resolutionDate ?? "").trim() || settingsIssuer.resolutionDate,
    resolutionNumber:
      String(input.resolutionNumber ?? "").trim() || settingsIssuer.resolutionNumber,
    siiOffice: String(input.siiOffice ?? "").trim() || settingsIssuer.siiOffice || null,
  };
}

export class ProductionDteService {
  constructor(
    private readonly repository: ProductionDteRepository,
    private readonly artifactStore: PrivateDteArtifactStore,
    private readonly generator: ProductionDteGenerator,
    private readonly cafLoader: ProductionCafLoader,
    private readonly siiClientFactory: ProductionSiiClientFactory,
    private readonly manualStatusTokenProvider: ManualStatusTokenProvider,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly repoRoot = process.cwd(),
    private readonly preparationPreflight: ProductionPreparationPreflight =
      async () => {},
  ) {}

  async createDraft(
    input: ProductionDraftInput,
    actorId: string,
    assertMutationLease?: () => Promise<void>,
  ): Promise<ReturnType<typeof safeDocument>> {
    assertSupportedType(input.dteType);
    validateRecipient(input.recipient);
    validateReferences(input);
    safeBusinessOperationId(input.businessOperationId);
    const settings = await this.requireTenantSettings(input.tenantId, false);
    const tax = calculateDteTaxTotals({
      lines: input.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        exempt: line.exempt,
        discountPercent: line.discountPercent,
      })),
    });
    await assertMutationLease?.();
    const draft = await this.repository.createDraft({
      ...input,
      tenantId: settings.tenantId,
      issuerSnapshot: mergeIssuerSnapshot(input.issuerSnapshot, settings.issuer),
      taxSnapshotAt: input.taxSnapshotAt ?? new Date().toISOString(),
      businessOperationId: safeBusinessOperationId(input.businessOperationId),
      createdBy: actorId,
      issueDate: new Date().toISOString().slice(0, 10),
      netAmount: tax.netAmount,
      exemptAmount: tax.exemptAmount,
      taxAmount: tax.vatAmount,
      totalAmount: tax.totalAmount,
    });
    await assertMutationLease?.();
    await this.repository.appendAudit({
      tenantId: draft.tenantId,
      documentId: draft.id,
      action: "production_draft_created",
      actorId,
      metadata: {
        dteType: draft.dteType,
        totalAmount: draft.totalAmount,
      },
    });
    return safeDocument(draft);
  }

  async prepare(
    tenantId: string,
    documentId: string,
    actorId: string,
    assertMutationLease?: () => Promise<void>,
  ): Promise<ReturnType<typeof safeDocument>> {
    let failureStage: ProductionPreparationFailureStage = "runtime_config";
    try {
      this.config();
      failureStage = "document_load";
      const current = await this.requireDocument(tenantId, documentId);
      if (current.status === "ready") return safeDocument(current);
      if (!["draft", "prepared"].includes(current.status))
        throw new Error("DTE_PREPARE_STATE_INVALID");
      if (!current.issuerSnapshot || !current.taxSnapshotAt)
        throw new Error("DTE_TAX_SNAPSHOT_REQUIRED");
      failureStage = "tenant_settings";
      const settings = await this.requireOperationalSettings(
        tenantId,
        current.issuerSnapshot,
        true,
      );
      const effectiveIssuer = mergeIssuerSnapshot(current.issuerSnapshot, settings.issuer);
      current.issuerSnapshot = effectiveIssuer;
      failureStage = "issuer_resolution";
      assertValidProductionIssuerResolution(effectiveIssuer);
      failureStage = "issuer_activity_code";
      assertValidProductionIssuerActivityCode(effectiveIssuer);
      validateRecipient(current.recipient);

      // Read-only material checks deliberately precede the first folio lock.
      failureStage = "material_preflight";
      await this.preparationPreflight({
        tenantId,
        dteType: current.dteType,
        settings,
        document: current,
      });

      failureStage = "folio_reservation";
      await assertMutationLease?.();
      const reservation =
        current.folio === null
          ? await this.repository.reserveFolio({
              tenantId,
              dteType: current.dteType,
              documentId,
              businessOperationId: current.businessOperationId,
            })
          : {
              folio: current.folio,
              cafId: String(current.cafId),
              reused: true,
            };
      if (!reservation || !reservation.folio || reservation.folio <= 0) {
        throw new Error("DTE_FOLIO_NOT_AVAILABLE");
      }
      failureStage = "document_transition";
      await assertMutationLease?.();
      const prepared =
        current.status === "prepared"
          ? current
          : await this.repository.transitionDocument({
              tenantId,
              documentId,
              from: ["draft"],
              to: "prepared",
              patch: { folio: reservation.folio, cafId: reservation.cafId },
            });
      failureStage = "caf_load";
      const cafMetadata = await this.repository.selectCaf(
        tenantId,
        prepared.dteType,
        reservation.folio,
      );
      if (!cafMetadata || cafMetadata.id !== reservation.cafId)
        throw new Error("DTE_CAF_COVERAGE_NOT_UNIQUE");
      const caf = this.cafLoader({
        settings,
        dteType: prepared.dteType,
        expectedSha256: cafMetadata.sha256,
      });
      failureStage = "artifact_generation";
      const generated = await this.generator.generate({
        document: prepared,
        settings,
        caf,
        env: this.env,
      });
      failureStage = "artifact_persistence";
      await assertMutationLease?.();
      await this.persistGeneratedArtifacts(prepared, generated);
      failureStage = "ready_transition";
      await assertMutationLease?.();
      const ready = await this.repository.transitionDocument({
        tenantId,
        documentId,
        from: ["prepared"],
        to: "ready",
      });
      await assertMutationLease?.();
      await this.repository.appendAudit({
        tenantId,
        documentId,
        action: "production_document_ready",
        actorId,
        metadata: {
          dteType: ready.dteType,
          folio: ready.folio,
          xsd: generated.metadata.xsd,
          xmlsec1: generated.metadata.xmlsec1,
          frmt: generated.metadata.frmt,
        },
      });
      return safeDocument(ready);
    } catch (error) {
      if (error instanceof Error && error.message === "DTE_AUTOMATIC_CLAIM_FENCED") {
        throw error;
      }
      if (error instanceof ProductionPreparationError) throw error;
      throw new ProductionPreparationError(failureStage, error);
    }
  }

  async preflight(
    tenantId: string,
    documentId: string,
  ): Promise<{
    ready: boolean;
    document: ReturnType<typeof safeDocument>;
    artifacts: string[];
    automaticRetryAllowed: false;
    statusAutomatic: false;
  }> {
    this.config();
    const document = await this.requireDocument(tenantId, documentId);
    if (!document.issuerSnapshot) throw new Error("DTE_TAX_SNAPSHOT_REQUIRED");
    await this.requireOperationalSettings(tenantId, document.issuerSnapshot, true);
    const artifacts = await this.repository.listArtifacts(tenantId, documentId);
    return {
      ready:
        document.status === "ready" &&
        ["dte_xml", "envio_xml", "pdf"].every((kind) =>
          artifacts.some((artifact) => artifact.kind === kind),
        ),
      document: safeDocument(document),
      artifacts: artifacts.map((artifact) => artifact.kind).sort(),
      automaticRetryAllowed: false,
      statusAutomatic: false,
    };
  }

  async emitOnce(input: {
    tenantId: string;
    documentId: string;
    confirmation: string;
    actorId: string;
    assertMutationLease?: () => Promise<void>;
    beforeNetworkAttempt?: (input: {
      milestone: "seed_before_fetch" | "token_before_fetch" | "upload_before_fetch";
      submissionAttemptId: string;
    }) => Promise<void>;
  }): Promise<ReturnType<typeof safeDocument>> {
    const config = this.config();
    assertExactProductionConfirmation(input.documentId, input.confirmation);
    const document = await this.requireDocument(
      input.tenantId,
      input.documentId,
    );
    if (!document.issuerSnapshot) throw new Error("DTE_TAX_SNAPSHOT_REQUIRED");
    const settings = await this.requireOperationalSettings(
      input.tenantId,
      document.issuerSnapshot,
      true,
    );
    if (document.status === "ambiguous")
      throw new Error("DTE_AMBIGUOUS_RETRY_BLOCKED");
    if (document.status !== "ready")
      throw new Error("DTE_EMIT_STATE_INVALID");
    const existingAttempt = await this.repository.getSubmissionAttempt(
      input.tenantId,
      input.documentId,
    );
    if (
      existingAttempt &&
      (existingAttempt.status === "submitted" || Boolean(document.trackId))
    ) {
      throw new Error("DTE_UPLOAD_ALREADY_ATTEMPTED");
    }
    const envelopeArtifact = await this.repository.getCurrentArtifact(
      input.tenantId,
      input.documentId,
      "envio_xml",
    );
    if (!envelopeArtifact) throw new Error("DTE_ARTIFACT_ENVIO_XML_CURRENT_MISSING");
    const envelope = await this.artifactStore.getPrivate(
      input.tenantId,
      envelopeArtifact.storageKey,
    );
    if (sha256(envelope.bytes) !== envelopeArtifact.sha256)
      throw new Error("DTE_ARTIFACT_HASH_MISMATCH");
    await input.assertMutationLease?.();
    const attempt = await this.repository.createSubmissionAttempt({
      tenantId: input.tenantId,
      documentId: input.documentId,
      attemptNumber: 1,
      status: "persisted",
      requestSha256: envelopeArtifact.sha256,
      responseSha256: null,
      responseSafe: null,
      trackId: null,
      beforeFetchAt: null,
      afterFetchAt: null,
    });
    await input.assertMutationLease?.();
    await this.repository.transitionDocument({
      tenantId: input.tenantId,
      documentId: input.documentId,
      from: ["ready"],
      to: "submitting",
    });
    const milestone = async (event: ProductionSiiMilestone) => {
      if (
        event === "seed_before_fetch" ||
        event === "token_before_fetch" ||
        event === "upload_before_fetch"
      ) {
        await input.beforeNetworkAttempt?.({
          milestone: event,
          submissionAttemptId: attempt.id,
        });
      }
      const now = new Date().toISOString();
      await this.repository.appendAudit({
        tenantId: input.tenantId,
        documentId: input.documentId,
        action: `sii_${event}`,
        actorId: input.actorId,
        metadata: { attempt: 1 },
      });
      if (event === "upload_before_fetch" && !input.beforeNetworkAttempt)
        await this.repository.updateSubmissionAttempt(
          input.tenantId,
          attempt.id,
          { status: "uploading", beforeFetchAt: now },
        );
      if (event === "upload_after_fetch")
        await this.repository.updateSubmissionAttempt(
          input.tenantId,
          attempt.id,
          { afterFetchAt: now },
        );
    };
    let result;
    try {
      const uploadFileName = [39, 41].includes(Number(document.dteType))
        ? "EnvioBoleta.xml"
        : "EnvioDTE.xml";
      result = await this.siiClientFactory(config, document.dteType).uploadExactlyOnce({
        envelope: envelope.bytes,
        fileName: uploadFileName,
        issuerRut: document.issuerSnapshot.rut,
        senderRut: settings.senderRut,
        certificatePath: settings.certificatePath,
        privateKeyPath: settings.privateKeyPath,
        milestone,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "DTE_AUTOMATIC_CLAIM_FENCED") {
        throw error;
      }
      await input.assertMutationLease?.();
      await this.repository.updateSubmissionAttempt(
        input.tenantId,
        attempt.id,
        {
          status: "rejected",
          responseSafe: { category: "auth_or_configuration" },
        },
      );
      await this.repository.transitionDocument({
        tenantId: input.tenantId,
        documentId: input.documentId,
        from: ["submitting"],
        to: "rejected",
      });
      throw error;
    }
    await input.assertMutationLease?.();
    if (result.responseBytes?.length)
      await this.persistSiiResponseArtifact(
        document,
        result.responseBytes,
        result.responseSha256,
      );
    await input.assertMutationLease?.();
    await this.repository.updateSubmissionAttempt(
      input.tenantId,
      attempt.id,
      {
        status: result.status,
        responseSha256: result.responseSha256,
        responseSafe: result.responseSafe,
        trackId: result.trackId,
      },
    );
    await input.assertMutationLease?.();
    const final = await this.repository.transitionDocument({
      tenantId: input.tenantId,
      documentId: input.documentId,
      from: ["submitting"],
      to: result.status,
      patch: {
        trackId: result.trackId,
        siiStatus: result.status,
        finalResponseSha256: result.responseSha256,
      },
    });
    return safeDocument(final);
  }

  async queryStatusManually(input: {
    tenantId: string;
    documentId: string;
    actorId: string;
  }): Promise<ProductionStatusResult> {
    const config = this.config();
    const document = await this.requireDocument(
      input.tenantId,
      input.documentId,
    );
    if (!document.issuerSnapshot) throw new Error("DTE_TAX_SNAPSHOT_REQUIRED");
    const settings = await this.requireOperationalSettings(
      input.tenantId,
      document.issuerSnapshot,
      true,
    );
    const recoveryAttempt = document.trackId
      ? null
      : await this.repository.getSubmissionAttempt(
          input.tenantId,
          input.documentId,
        );
    const trackId = document.trackId ?? recoveryAttempt?.trackId ?? null;
    if (
      !trackId ||
      !["submitting", "submitted", "ambiguous"].includes(document.status)
    )
      throw new Error("DTE_MANUAL_STATUS_NOT_AVAILABLE");
    const milestone = async (event: ProductionSiiMilestone) => {
      await this.repository.appendAudit({
        tenantId: input.tenantId,
        documentId: input.documentId,
        action: `sii_${event}`,
        actorId: input.actorId,
        metadata: { manual: true },
      });
    };
    const token = await this.manualStatusTokenProvider({
      settings,
      dteType: document.dteType,
      milestone,
    });
    const result = await this.siiClientFactory(config, document.dteType).queryStatusManually({
      trackId,
      token,
      milestone,
      companyRut: document.issuerSnapshot.rut,
      document: document.dteType === 39 && document.folio !== null
        ? {
            dteType: 39,
            folio: document.folio,
            recipientRut: "66666666-6",
            amount: document.totalAmount,
            issueDate: document.issueDate,
          }
        : undefined,
    });
    const reconciled = await this.repository.transitionDocument({
      tenantId: input.tenantId,
      documentId: input.documentId,
      from: [document.status],
      to:
        result.siiStatus === "rejected"
          ? "rejected"
          : ["accepted", "accepted_with_observations", "sent", "processing"].includes(result.siiStatus)
            ? "submitted"
            : document.status,
      patch: {
        trackId,
        siiStatus: result.siiStatus,
        finalResponseSha256: result.responseSha256,
      },
    });
    if (["accepted", "accepted_with_observations"].includes(result.siiStatus) && settings.autoEmailDelivery) {
      const [xml, pdf] = await Promise.all([
        this.repository.getCurrentArtifact(
          input.tenantId,
          input.documentId,
          "dte_xml",
        ),
        this.repository.getCurrentArtifact(
          input.tenantId,
          input.documentId,
          "pdf",
        ),
      ]);
      if (!xml || !pdf) throw new Error("DTE_DELIVERY_CURRENT_ARTIFACT_MISSING");
      await this.repository.enqueueRecipientDelivery({
        tenantId: input.tenantId,
        documentId: input.documentId,
        recipientEmail: reconciled.recipient.email,
        idempotencyKey: "recipient:" + input.documentId,
        xmlArtifactId: xml.id,
        pdfArtifactId: pdf.id,
      });
    }
    return result;
  }

  async getSafeDetail(tenantId: string, documentId: string) {
    const document = await this.requireDocument(tenantId, documentId);
    const artifacts = await this.repository.listArtifacts(tenantId, documentId);
    const audit = await this.repository.listAudit(tenantId, documentId);
    return {
      document: safeDocument(document),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        version: artifact.version ?? 1,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
      })),
      audit: audit.map((record) => ({
        action: record.action,
        metadata: record.metadata,
        createdAt: record.createdAt,
      })),
    };
  }

  async download(
    tenantId: string,
    documentId: string,
    kind: "dte_xml" | "pdf",
  ): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
    const document = await this.requireDocument(tenantId, documentId);
    const artifact = await this.repository.getCurrentArtifact(
      tenantId,
      documentId,
      kind,
    );
    if (!artifact) throw new Error(`DTE_ARTIFACT_${kind.toUpperCase()}_CURRENT_MISSING`);
    const value = await this.artifactStore.getPrivate(
      tenantId,
      artifact.storageKey,
    );
    if (sha256(value.bytes) !== artifact.sha256)
      throw new Error("DTE_ARTIFACT_HASH_MISMATCH");
    return {
      ...value,
      fileName: `${document.dteType}-${document.folio}.${kind === "pdf" ? "pdf" : "xml"}`,
    };
  }

  private config(): ProductionRuntimeConfig {
    return assertProductionConfig(this.env, this.repoRoot);
  }

  private async requireTenantSettings(
    tenantId: string,
    requireEnabled: boolean,
  ): Promise<ProductionTenantSettings> {
    const settings = await this.repository.getTenantSettings(tenantId);
    if (!settings || settings.tenantId !== tenantId)
      throw new Error("DTE_TENANT_SETTINGS_MISSING");
    if (requireEnabled && !settings.enabled)
      throw new Error("DTE_TENANT_PRODUCTION_DISABLED");
    const now = Date.now();
    if (
      requireEnabled &&
      (new Date(settings.certificateValidFrom).valueOf() > now ||
        new Date(settings.certificateValidTo).valueOf() <= now)
    )
      throw new Error("DTE_CERTIFICATE_NOT_CURRENT");
    return settings;
  }

  private async requireOperationalSettings(
    tenantId: string,
    issuerSnapshot: ProductionTenantSettings["issuer"],
    requireEnabled: boolean,
  ): Promise<ProductionTenantSettings> {
    const settings = await this.repository.getOperationalSettings(
      tenantId,
      issuerSnapshot,
    );
    if (!settings || settings.tenantId !== tenantId)
      throw new Error("DTE_TENANT_SETTINGS_MISSING");
    if (requireEnabled && !settings.enabled)
      throw new Error("DTE_TENANT_PRODUCTION_DISABLED");
    const now = Date.now();
    if (
      requireEnabled &&
      (new Date(settings.certificateValidFrom).valueOf() > now ||
        new Date(settings.certificateValidTo).valueOf() <= now)
    )
      throw new Error("DTE_CERTIFICATE_NOT_CURRENT");
    return settings;
  }

  private async requireDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionDocument> {
    const document = await this.repository.getDocument(tenantId, documentId);
    if (!document) throw new Error("DTE_DOCUMENT_NOT_FOUND");
    return document;
  }

  private async persistSiiResponseArtifact(
    document: ProductionDocument,
    bytes: Buffer,
    expectedSha256: string | null,
  ): Promise<void> {
    const digest = sha256(bytes);
    if (!expectedSha256 || digest !== expectedSha256)
      throw new Error("DTE_SII_RESPONSE_HASH_MISMATCH");
    const stored = await this.artifactStore.putImmutable({
      tenantId: document.tenantId,
      documentId: document.id,
      fileName: String(document.dteType) + "-" + String(document.folio) + "-sii-response.xml",
      contentType: "application/octet-stream",
      bytes,
    });
    await this.repository.storeArtifact({
      tenantId: document.tenantId,
      documentId: document.id,
      kind: "sii_response",
      contentType: "application/octet-stream",
      ...stored,
    });
  }

  private async persistGeneratedArtifacts(
    document: ProductionDocument,
    generated: ProductionGeneratedArtifacts,
  ): Promise<void> {
    for (const item of [
      {
        kind: "dte_xml" as const,
        fileName: `${document.dteType}-${document.folio}.xml`,
        contentType: "text/xml; charset=ISO-8859-1",
        bytes: generated.dteXml,
      },
      {
        kind: "envio_xml" as const,
        fileName: `${document.dteType}-${document.folio}-envio.xml`,
        contentType: "text/xml; charset=ISO-8859-1",
        bytes: generated.envioXml,
      },
      {
        kind: "pdf" as const,
        fileName: `${document.dteType}-${document.folio}.pdf`,
        contentType: "application/pdf",
        bytes: generated.pdf,
      },
    ]) {
      const stored = await this.artifactStore.putImmutable({
        tenantId: document.tenantId,
        documentId: document.id,
        fileName: item.fileName,
        contentType: item.contentType,
        bytes: item.bytes,
      });
      await this.repository.storeArtifact({
        tenantId: document.tenantId,
        documentId: document.id,
        kind: item.kind,
        contentType: item.contentType,
        ...stored,
      });
    }
  }
}
