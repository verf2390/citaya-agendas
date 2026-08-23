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
import type { ProductionDteType, ProductionTenantSettings } from "./types";

export async function assertServerPreparationMaterials(input: {
  tenantId: string;
  dteType: ProductionDteType;
  settings: ProductionTenantSettings;
}) {
  const config = assertProductionConfig(process.env, process.cwd());
  loadValidatedProductionSigningMaterial({
    certificatePath: input.settings.certificatePath,
    privateKeyPath: input.settings.privateKeyPath,
    config,
  });
  const [{ data: folio, error: folioError }, { data: gates, error: gateError }] =
    await Promise.all([
      supabaseAdmin
        .from("dte_production_folio_ledger")
        .select("folio,caf_id")
        .eq("tenant_id", input.tenantId)
        .eq("dte_type", input.dteType)
        .eq("state", "available")
        .order("folio", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin.rpc("dte_activation_gate_report", {
        p_tenant_id: input.tenantId,
        p_dte_type: input.dteType,
        p_global_feature_enabled: true,
      }),
    ]);
  if (folioError || !folio) throw new Error("DTE_FOLIO_PREFLIGHT_FAILED");
  if (gateError || gates?.privateStorage !== true) throw new Error("DTE_PRIVATE_STORAGE_PREFLIGHT_FAILED");
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
    async ({ tenantId, dteType, settings }) =>
      assertServerPreparationMaterials({
        tenantId, dteType, settings,
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
