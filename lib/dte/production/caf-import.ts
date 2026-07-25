import { createHash, randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";

import {
  loadProductionCafAuthorization,
  type CafTrustStore,
  type ImportedCaf,
} from "../certification/caf-secure-import";
import { normalizeRut } from "../rut";
import {
  isOfficialSiiTrustAnchorProvenance,
  isPinnedSha256,
  isValidSiiTrustAnchorIdk,
} from "../trust-anchor-contract";
import type { ProductionDteRepository } from "./repository";
import type {
  ProductionCafMetadata,
  ProductionDteType,
  ProductionTenantSettings,
} from "./types";

export type ProductionCafImportInput = {
  tenantId: string;
  dteType: ProductionDteType;
  expectedSha256: string;
  actorId: string;
  expectedRange?: { from: number; to: number };
};

function opaqueId(...values: string[]): string {
  return createHash("sha256").update(values.join("|")).digest("hex").slice(0, 32);
}

function resolveCafPath(
  cafRoot: string,
  tenantId: string,
  dteType: ProductionDteType,
): string {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(tenantId))
    throw new Error("DTE_CAF_TENANT_INVALID");
  const root = resolve(cafRoot);
  const path = resolve(root, tenantId, `${dteType}.xml`);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("DTE_CAF_PATH_INVALID");
  return path;
}

export function loadProductionCafForTenant(input: {
  cafRoot: string;
  repoRoot: string;
  settings: ProductionTenantSettings;
  dteType: ProductionDteType;
  expectedSha256: string;
  trustStore: CafTrustStore;
  expectedRange?: { from: number; to: number };
  expectedOwnerUid?: number;
}): ImportedCaf & {
  materialKind: "production_real";
  trustStatus: "verified_official";
  realUseBlocked: false;
} {
  return loadProductionCafAuthorization(
    resolveCafPath(input.cafRoot, input.settings.tenantId, input.dteType),
    {
      repoRoot: input.repoRoot,
      expectedIssuerRut: input.settings.issuer.rut,
      expectedType: input.dteType,
      minimumAvailable: 1,
      trustStore: input.trustStore,
      expectedSha256: input.expectedSha256,
      expectedRange: input.expectedRange,
      expectedOwnerUid: input.expectedOwnerUid,
    },
  );
}

export async function importProductionCaf(input: {
  request: ProductionCafImportInput;
  cafRoot: string;
  repoRoot: string;
  settings: ProductionTenantSettings;
  trustStore: CafTrustStore;
  repository: ProductionDteRepository;
  expectedOwnerUid?: number;
}): Promise<ProductionCafMetadata> {
  if (input.request.tenantId !== input.settings.tenantId)
    throw new Error("DTE_CAF_TENANT_MISMATCH");
  if (!input.settings.enabled) throw new Error("DTE_TENANT_PRODUCTION_DISABLED");
  const imported = loadProductionCafForTenant({
    cafRoot: input.cafRoot,
    repoRoot: input.repoRoot,
    settings: input.settings,
    dteType: input.request.dteType,
    expectedSha256: input.request.expectedSha256,
    trustStore: input.trustStore,
    expectedRange: input.request.expectedRange,
    expectedOwnerUid: input.expectedOwnerUid,
  });
  if (
    normalizeRut(imported.issuerRut) !== normalizeRut(input.settings.issuer.rut) ||
    imported.typeCode !== input.request.dteType
  )
    throw new Error("DTE_CAF_IDENTITY_MISMATCH");
  const metadata: ProductionCafMetadata = {
    id: randomUUID(),
    tenantId: input.settings.tenantId,
    dteType: imported.typeCode,
    issuerRut: imported.issuerRut,
    rangeFrom: imported.rangeFrom,
    rangeTo: imported.rangeTo,
    authorizationDate: imported.authorizationDate,
    sha256: imported.sha256,
    logicalIdentity: imported.logicalIdentity,
    secureRef: `caf:${opaqueId(input.settings.tenantId, imported.sha256)}`,
    trustStatus: "verified_official",
    active: true,
  };
  await input.repository.importCaf(metadata);
  await input.repository.appendAudit({
    tenantId: metadata.tenantId,
    documentId: null,
    action: "production_caf_imported",
    actorId: input.request.actorId,
    metadata: {
      dteType: metadata.dteType,
      rangeFrom: metadata.rangeFrom,
      rangeTo: metadata.rangeTo,
      sha256Prefix: metadata.sha256.slice(0, 12),
    },
  });
  return metadata;
}

export function buildProductionTrustStore(env: NodeJS.ProcessEnv): CafTrustStore {
  const idk = String(env.DTE_PRODUCTION_TRUST_ANCHOR_IDK ?? "").trim();
  const path = String(env.DTE_PRODUCTION_TRUST_ANCHOR_PATH ?? "").trim();
  const provenance = String(
    env.DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE ?? "",
  ).trim();
  const sha256 = String(
    env.DTE_PRODUCTION_TRUST_ANCHOR_SHA256 ?? "",
  ).trim().toLowerCase();
  if (
    !isValidSiiTrustAnchorIdk(idk) ||
    !path ||
    !isOfficialSiiTrustAnchorProvenance(provenance) ||
    !isPinnedSha256(sha256)
  )
    throw new Error("DTE_PRODUCTION_TRUST_ANCHOR_INCOMPLETE");
  return new Map([
    [
      idk,
      {
        idk,
        mode: "real" as const,
        publicKeyPath: path,
        provenance,
        sha256,
      },
    ],
  ]);
}
