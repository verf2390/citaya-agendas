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
import { ProductionDteService } from "./service";
import { ProductionSiiClient } from "./sii-client";
import { requestProductionStatusToken } from "./status-auth";
import { SupabaseProductionDteRepository } from "./supabase-repository";

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
    (config) => new ProductionSiiClient(config),
    async ({ settings, milestone }) =>
      requestProductionStatusToken({
        config: assertProductionConfig(process.env, process.cwd()),
        settings,
        milestone,
      }),
    process.env,
    process.cwd(),
  );
}

export async function importServerProductionCaf(
  request: ProductionCafImportInput,
) {
  const config = assertProductionConfig(process.env, process.cwd());
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
