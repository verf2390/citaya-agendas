import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { SupabasePrivateDteArtifactStore } from "./artifact-store";
import {
  buildProductionTrustStore,
  importProductionCaf,
  loadProductionCafForTenant,
  type ProductionCafImportInput,
} from "./caf-import";
import { assertProductionConfig } from "./config";
import { CertifiedProductionDteGenerator } from "./generator";
import { loadValidatedProductionSigningMaterial } from "./signing-material";
import { ProductionDteService } from "./service";
import { SiiBoletaApiTransport } from "./boleta-api-transport";
import { ProductionSiiClient } from "./sii-client";
import { requestProductionStatusTokenForDteType } from "./status-auth";
import { SupabaseProductionDteRepository } from "./supabase-repository";
import type {
  ProductionDocument,
  ProductionDteType,
  ProductionTenantSettings,
} from "./types";

export type PreparationFolioRow = {
  tenant_id: string;
  dte_type: number;
  folio: number;
  caf_id: string;
  state: string;
  document_id: string | null;
  business_operation_id: string | null;
};

function uniquePreparationRelations(
  ...groups: Array<PreparationFolioRow[] | null>
) {
  const unique = new Map<string, PreparationFolioRow>();
  for (const row of groups.flatMap((group) => group ?? [])) {
    unique.set(`${row.tenant_id}:${row.dte_type}:${row.folio}`, row);
  }
  return [...unique.values()];
}

function reusableOwnedPreparationFolio(
  document: ProductionDocument,
  relations: PreparationFolioRow[],
): { folio: number; caf_id: string } | null {
  if (!relations.length) return null;
  const businessOperationId = document.businessOperationId.trim();
  if (!businessOperationId || relations.length !== 1) {
    throw new Error("DTE_OWNED_FOLIO_PREFLIGHT_FAILED");
  }
  const relation = relations[0];
  const exactOwner =
    relation.tenant_id === document.tenantId &&
    relation.dte_type === document.dteType &&
    relation.document_id === document.id &&
    relation.business_operation_id === businessOperationId &&
    relation.state === "reserved" &&
    Number.isSafeInteger(Number(relation.folio)) &&
    Number(relation.folio) > 0 &&
    typeof relation.caf_id === "string" &&
    relation.caf_id.length > 0;
  const documentMatches = document.status === "draft"
    ? (document.folio === null || document.folio === Number(relation.folio)) &&
      (document.cafId === null || document.cafId === relation.caf_id)
    : ["prepared", "ready"].includes(document.status) &&
      document.folio === Number(relation.folio) &&
      document.cafId === relation.caf_id;
  if (!exactOwner || !documentMatches) {
    throw new Error("DTE_OWNED_FOLIO_PREFLIGHT_FAILED");
  }
  return { folio: Number(relation.folio), caf_id: relation.caf_id };
}

export function resolvePreparationFolioPreflight(
  document: ProductionDocument,
  relations: PreparationFolioRow[],
): { folio: number; caf_id: string } | null {
  const owned = reusableOwnedPreparationFolio(document, relations);
  if (owned) return owned;
  const cleanUnrelatedDraft =
    document.status === "draft" &&
    document.folio === null &&
    document.cafId === null &&
    relations.length === 0;
  if (!cleanUnrelatedDraft) {
    throw new Error("DTE_OWNED_FOLIO_PREFLIGHT_FAILED");
  }
  return null;
}

export async function assertServerPreparationMaterials(input: {
  tenantId: string;
  dteType: ProductionDteType;
  settings: ProductionTenantSettings;
  document: ProductionDocument;
}) {
  const config = assertProductionConfig(process.env, process.cwd());
  loadValidatedProductionSigningMaterial({
    certificatePath: input.settings.certificatePath,
    privateKeyPath: input.settings.privateKeyPath,
    config,
  });
  const businessOperationId = input.document.businessOperationId.trim();
  if (
    input.document.tenantId !== input.tenantId ||
    input.document.dteType !== input.dteType ||
    !businessOperationId
  ) {
    throw new Error("DTE_OWNED_FOLIO_PREFLIGHT_FAILED");
  }
  const [
    documentRelationsResult,
    operationRelationsResult,
    { data: gates, error: gateError },
  ] = await Promise.all([
    supabaseAdmin
      .from("dte_production_folio_ledger")
      .select("tenant_id,dte_type,folio,caf_id,state,document_id,business_operation_id")
      .eq("document_id", input.document.id)
      .limit(2),
    supabaseAdmin
      .from("dte_production_folio_ledger")
      .select("tenant_id,dte_type,folio,caf_id,state,document_id,business_operation_id")
      .eq("tenant_id", input.tenantId)
      .eq("business_operation_id", businessOperationId)
      .limit(2),
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: input.tenantId,
      p_dte_type: input.dteType,
      p_global_feature_enabled: true,
    }),
  ]);
  if (documentRelationsResult.error || operationRelationsResult.error) {
    throw new Error("DTE_FOLIO_PREFLIGHT_FAILED");
  }
  if (gateError || gates?.privateStorage !== true) {
    throw new Error("DTE_PRIVATE_STORAGE_PREFLIGHT_FAILED");
  }
  const relations = uniquePreparationRelations(
    documentRelationsResult.data as PreparationFolioRow[] | null,
    operationRelationsResult.data as PreparationFolioRow[] | null,
  );
  let folio = resolvePreparationFolioPreflight(input.document, relations);
  if (!folio) {
    const { data, error } = await supabaseAdmin
      .from("dte_production_folio_ledger")
      .select("folio,caf_id")
      .eq("tenant_id", input.tenantId)
      .eq("dte_type", input.dteType)
      .eq("state", "available")
      .order("folio", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) throw new Error("DTE_FOLIO_PREFLIGHT_FAILED");
    folio = data;
  }
  const { data: caf, error: cafError } = await supabaseAdmin
    .from("dte_production_cafs")
    .select("id,sha256,range_from,range_to,trust_status,active")
    .eq("tenant_id", input.tenantId)
    .eq("dte_type", input.dteType)
    .eq("id", folio.caf_id)
    .eq("active", true)
    .eq("trust_status", "verified_official")
    .maybeSingle();
  if (cafError || !caf) throw new Error("DTE_CAF_PREFLIGHT_FAILED");
  const selectedFolio = Number(folio.folio);
  if (
    !Number.isSafeInteger(selectedFolio) ||
    selectedFolio < Number(caf.range_from) ||
    selectedFolio > Number(caf.range_to) ||
    !/^[a-f0-9]{64}$/.test(String(caf.sha256))
  ) {
    throw new Error("DTE_CAF_PREFLIGHT_FAILED");
  }
  loadProductionCafForTenant({
    cafRoot: config.cafRoot,
    repoRoot: process.cwd(),
    settings: input.settings,
    dteType: input.dteType,
    expectedSha256: caf.sha256,
    expectedRange: { from: caf.range_from, to: caf.range_to },
    trustStore: buildProductionTrustStore(process.env),
    expectedOwnerUid: process.getuid?.(),
  });
}

export function createServerProductionRepository() {
  return new SupabaseProductionDteRepository(
    supabaseAdmin as never,
    process.env,
  );
}

export function createServerProductionDteService(): ProductionDteService {
  const repository = createServerProductionRepository();
  const bucket =
    String(process.env.DTE_PRODUCTION_STORAGE_BUCKET ?? "").trim() ||
    "dte-production-private";
  return new ProductionDteService(
    repository,
    new SupabasePrivateDteArtifactStore(supabaseAdmin as never, bucket),
    new CertifiedProductionDteGenerator(),
    ({ settings, dteType, expectedSha256 }) => {
      const config = assertProductionConfig(process.env, process.cwd());
      return loadProductionCafForTenant({
        cafRoot: config.cafRoot,
        repoRoot: process.cwd(),
        settings,
        dteType,
        expectedSha256,
        trustStore: buildProductionTrustStore(process.env),
        expectedOwnerUid: process.getuid?.(),
      });
    },
    (config, dteType) =>
      dteType && [39, 41].includes(Number(dteType))
        ? new SiiBoletaApiTransport(config)
        : new ProductionSiiClient(config),
    async ({ settings, dteType, milestone }) =>
      requestProductionStatusTokenForDteType({
        config: assertProductionConfig(process.env, process.cwd()),
        settings,
        dteType,
        milestone,
      }),
    process.env,
    process.cwd(),
    async ({ tenantId, dteType, settings, document }) =>
      assertServerPreparationMaterials({
        tenantId, dteType, settings, document,
      }),
  );
}

export async function importServerProductionCaf(
  request: ProductionCafImportInput,
) {
  const config = assertProductionConfig(process.env, process.cwd(), {
    requireEnabled: false,
  });
  const repository = createServerProductionRepository();
  const settings = await repository.getTenantSettings(request.tenantId);
  if (!settings) throw new Error("DTE_TENANT_SETTINGS_MISSING");
  return importProductionCaf({
    request,
    cafRoot: config.cafRoot,
    repoRoot: process.cwd(),
    settings,
    trustStore: buildProductionTrustStore(process.env),
    repository,
    expectedOwnerUid: process.getuid?.(),
  });
}
