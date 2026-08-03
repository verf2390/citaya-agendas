export type CertificationEnvironment = "certification";
export type CertificationFrmaStatus =
  "not_independently_verified_missing_official_idk100_anchor";

export type CertificationCafImport = {
  tenantId: string;
  environment: CertificationEnvironment;
  documentType: 39;
  issuerRut: string;
  cafSha256: string;
  securePath: string;
  idk: "100";
  rangeFrom: 1;
  rangeTo: 5;
  authorizationDate: string;
  frmaVerificationStatus: CertificationFrmaStatus;
  exceptionReason: string;
  exceptionActorId: string;
  exceptionAuthorizedAt: string;
};

export type CertificationArtifactMetadata = {
  kind:
    | "boleta_xml"
    | "envelope_xml"
    | "rcof_xml"
    | "sanitized_report"
    | "sha256_manifest";
  caseId?: "CASO-1" | "CASO-2" | "CASO-3" | "CASO-4" | "CASO-5";
  path: string;
  sha256: string;
  byteLength: number;
};

type RpcResult = { data: unknown; error: { message?: string } | null };
export type CertificationRpcClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

function fail(error: RpcResult["error"]): never {
  throw new Error(error?.message || "DTE_CERTIFICATION_REPOSITORY_FAILED");
}

export function assertCertificationBoundary(input: {
  environment: string;
  documentType: number;
  securePath?: string;
}): void {
  if (input.environment !== "certification")
    throw new Error("DTE_CERTIFICATION_ENVIRONMENT_REQUIRED");
  if (input.documentType !== 39)
    throw new Error("DTE_CERTIFICATION_TYPE39_REQUIRED");
  if (
    input.securePath &&
    (!input.securePath.startsWith("/home/verf/secure/") ||
      input.securePath.includes("/../"))
  )
    throw new Error("DTE_CERTIFICATION_CAF_PATH_INVALID");
}

function row(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object")
    throw new Error("DTE_CERTIFICATION_REPOSITORY_EMPTY_RESULT");
  return value as Record<string, unknown>;
}

export class SupabaseBoleta39CertificationRepository {
  constructor(private readonly client: CertificationRpcClient) {}

  async importCaf(input: CertificationCafImport): Promise<{
    cafId: string;
    replayed: boolean;
    folioCount: number;
  }> {
    assertCertificationBoundary(input);
    const result = await this.client.rpc("import_dte_certification_caf", {
      p_tenant_id: input.tenantId,
      p_environment: input.environment,
      p_document_type: input.documentType,
      p_issuer_rut: input.issuerRut,
      p_caf_sha256: input.cafSha256,
      p_secure_path: input.securePath,
      p_idk: input.idk,
      p_range_from: input.rangeFrom,
      p_range_to: input.rangeTo,
      p_authorization_date: input.authorizationDate,
      p_frma_verification_status: input.frmaVerificationStatus,
      p_exception_reason: input.exceptionReason,
      p_exception_actor_id: input.exceptionActorId,
      p_exception_authorized_at: input.exceptionAuthorizedAt,
      p_caller: "offline_certification_cli",
    });
    if (result.error) fail(result.error);
    const data = row(result.data);
    return {
      cafId: String(data.caf_id),
      replayed: data.replayed === true,
      folioCount: Number(data.folio_count),
    };
  }

  async beginRun(input: {
    tenantId: string;
    cafId: string;
    idempotencyKey: string;
    actorId: string;
  }): Promise<{ runId: string; replayed: boolean; status: string }> {
    const result = await this.client.rpc("begin_dte_certification_run", {
      p_tenant_id: input.tenantId,
      p_environment: "certification",
      p_document_type: 39,
      p_caf_id: input.cafId,
      p_idempotency_key: input.idempotencyKey,
      p_case_folio_map: {
        "CASO-1": 1,
        "CASO-2": 2,
        "CASO-3": 3,
        "CASO-4": 4,
        "CASO-5": 5,
      },
      p_actor_id: input.actorId,
      p_caller: "offline_certification_cli",
    });
    if (result.error) fail(result.error);
    const data = row(result.data);
    return {
      runId: String(data.run_id),
      replayed: data.replayed === true,
      status: String(data.status),
    };
  }

  async validateRun(input: {
    tenantId: string;
    runId: string;
    artifacts: CertificationArtifactMetadata[];
    finalHashes: Record<string, string>;
  }): Promise<void> {
    const result = await this.client.rpc("validate_dte_certification_run", {
      p_tenant_id: input.tenantId,
      p_run_id: input.runId,
      p_artifacts: input.artifacts,
      p_final_hashes: input.finalHashes,
      p_caller: "offline_certification_cli",
    });
    if (result.error) fail(result.error);
  }

  async failRun(tenantId: string, runId: string, code: string): Promise<void> {
    const result = await this.client.rpc("fail_dte_certification_run", {
      p_tenant_id: tenantId,
      p_run_id: runId,
      p_failure_code: code,
      p_caller: "offline_certification_cli",
    });
    if (result.error) fail(result.error);
  }

  async inventory(tenantId: string): Promise<Record<string, unknown>> {
    const result = await this.client.rpc("dte_certification_inventory", {
      p_tenant_id: tenantId,
    });
    if (result.error) fail(result.error);
    return row(result.data);
  }
}

export class InMemoryBoleta39CertificationRepository {
  private caf: CertificationCafImport | null = null;
  private folios = new Map<number, "available" | "reserved" | "generated" | "failed">();
  private run: { key: string; status: "preparing" | "validated"; id: string } | null = null;

  importCaf(input: CertificationCafImport): { replayed: boolean; folioCount: number } {
    assertCertificationBoundary(input);
    if (this.caf) {
      if (JSON.stringify(this.caf) !== JSON.stringify(input))
        throw new Error(
          this.caf.cafSha256 === input.cafSha256
            ? "DTE_CERTIFICATION_CAF_REPLAY_METADATA_MISMATCH"
            : "DTE_CERTIFICATION_CAF_RANGE_OVERLAP",
        );
      return { replayed: true, folioCount: this.folios.size };
    }
    this.caf = structuredClone(input);
    for (let folio = input.rangeFrom; folio <= input.rangeTo; folio += 1)
      this.folios.set(folio, "available");
    return { replayed: false, folioCount: this.folios.size };
  }

  beginRun(key: string): { replayed: boolean; status: string } {
    if (!this.caf) throw new Error("DTE_CERTIFICATION_CAF_INVALID");
    if (this.run) {
      if (this.run.key !== key) throw new Error("DTE_CERTIFICATION_FOLIO_NOT_AVAILABLE");
      return { replayed: true, status: this.run.status };
    }
    if ([...this.folios.values()].some((state) => state !== "available"))
      throw new Error("DTE_CERTIFICATION_FOLIO_NOT_AVAILABLE");
    this.run = { key, status: "preparing", id: "run-certification-39" };
    for (const folio of this.folios.keys()) this.folios.set(folio, "reserved");
    return { replayed: false, status: "preparing" };
  }

  validateRun(): void {
    if (!this.run || this.run.status !== "preparing")
      throw new Error("DTE_CERTIFICATION_RUN_NOT_PREPARING");
    for (const folio of this.folios.keys()) this.folios.set(folio, "generated");
    this.run.status = "validated";
  }

  forceTransition(folio: number, state: "available" | "generated"): void {
    if (this.folios.get(folio) === "generated" && state === "available")
      throw new Error("DTE_CERTIFICATION_GENERATED_FOLIO_IMMUTABLE");
    this.folios.set(folio, state);
  }

  counts(): Record<string, number> {
    return {
      cafs: this.caf ? 1 : 0,
      folios: this.folios.size,
      available: [...this.folios.values()].filter((s) => s === "available").length,
      reserved: [...this.folios.values()].filter((s) => s === "reserved").length,
      generated: [...this.folios.values()].filter((s) => s === "generated").length,
    };
  }
}
