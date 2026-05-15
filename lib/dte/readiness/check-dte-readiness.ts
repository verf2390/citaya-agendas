import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  getDteModeFromEnv,
  validateDteConfig,
  type DteConfigValidationStatus,
} from "../config/validate-dte-config";

export type DteReadinessStatus =
  | "OK"
  | "WARNING"
  | "MISSING"
  | "LAB_ONLY"
  | "PENDING_REAL_SII";

export type DteReadinessSeverity = "info" | "warning" | "critical";

export type DteReadinessItem = {
  category: string;
  status: DteReadinessStatus;
  message: string;
  severity: DteReadinessSeverity;
  nextAction: string;
};

export type DteReadinessResult = {
  mode: "lab" | "xsd-structure" | "certification";
  labScore: number;
  certificationScore: number;
  productionTechnicalScore: number;
  readinessScore: number;
  globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO";
  items: DteReadinessItem[];
  blockers: string[];
  importantPending: string[];
  nextActions: string[];
  hasDangerousConfig: boolean;
  hasCriticalMissing: boolean;
};

type CheckOptions = {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
};

function exists(repoRoot: string, path: string): boolean {
  return existsSync(resolve(repoRoot, path));
}

function item(
  category: string,
  status: DteReadinessStatus,
  message: string,
  severity: DteReadinessSeverity,
  nextAction: string,
): DteReadinessItem {
  return { category, status, message, severity, nextAction };
}

function mapConfigStatus(status: DteConfigValidationStatus): DteReadinessStatus {
  if (status === "OK") return "OK";
  if (status === "DANGEROUS") return "MISSING";
  if (status === "MISSING") return "MISSING";
  return "WARNING";
}

function score(items: DteReadinessItem[], categories: string[]): number {
  const relevant = items.filter((readinessItem) =>
    categories.includes(readinessItem.category),
  );
  if (relevant.length === 0) return 0;

  const points = relevant.reduce((total, readinessItem) => {
    if (readinessItem.status === "OK") return total + 1;
    if (readinessItem.status === "WARNING") return total + 0.8;
    if (readinessItem.status === "LAB_ONLY") {
      return total + 0.75;
    }
    if (readinessItem.status === "PENDING_REAL_SII") return total + 0.75;
    return total;
  }, 0);

  return Math.round((points / relevant.length) * 100) / 10;
}

export function checkDteReadiness(options: CheckOptions = {}): DteReadinessResult {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const mode = getDteModeFromEnv(env);
  const items: DteReadinessItem[] = [];

  items.push(
    item("mode", "OK", `Modo actual: ${mode}`, "info", "Mantener LAB separado de certification y production."),
    item(
      "xsd",
      ["EnvioDTE_v10.xsd", "DTE_v10.xsd", "SiiTypes_v10.xsd", "xmldsignature_v10.xsd"].every(
        (file) => exists(repoRoot, `docs/dte-sii/xsd/${file}`),
      )
        ? "OK"
        : "MISSING",
      "XSD oficiales SII requeridos para validacion estructural.",
      "critical",
      "Restaurar los XSD oficiales en docs/dte-sii/xsd/.",
    ),
    item(
      "xsd_validation",
      exists(repoRoot, "scripts/dte/validate-xsd.mjs") ? "OK" : "MISSING",
      "Script de validacion XSD local.",
      "critical",
      "Mantener validate-xsd.mjs y xmllint disponible en entorno local/CI.",
    ),
    item(
      "xml_generation",
      exists(repoRoot, "scripts/dte/generate-lab-xml.mjs") ? "OK" : "MISSING",
      "Generador XML LAB/xsd-structure/certification.",
      "critical",
      "Mantener generador con falla segura en certification si faltan secretos.",
    ),
  );

  for (const configItem of validateDteConfig({ env, repoRoot })) {
    items.push(
      item(
        `config:${configItem.key}`,
        mapConfigStatus(configItem.status),
        configItem.message,
        configItem.status === "DANGEROUS" || configItem.status === "MISSING"
          ? "critical"
          : "warning",
        configItem.status === "OK"
          ? "No exponer contenido; validar permisos del archivo fuera del repo."
          : "Configurar variable fuera del repo antes de ejecutar certification.",
      ),
    );
  }

  items.push(
    item(
      "issuer",
      "WARNING",
      "RUT emisor, razon social, giro, direccion y comuna deben venir por tenant.",
      "warning",
      "Persistir tenant_dte_settings por tenant antes de emision real.",
    ),
    item(
      "folios",
      "WARNING",
      "Hay base LAB/controlada; falta ledger transaccional conectado a DB.",
      "warning",
      "Aplicar schema futuro y reservar folios por transaccion.",
    ),
    item(
      "frmt",
      mode === "certification" ? "WARNING" : "LAB_ONLY",
      "FRMT real/controlado preparado, pero requiere CAF y llave CAF reales para evidencia.",
      "warning",
      "Probar FRMT con CAF real de certificacion fuera del repo.",
    ),
    item(
      "xmldsig",
      mode === "certification" ? "WARNING" : "LAB_ONLY",
      "XMLDSig real/controlado preparado; xsd-structure usa firma sintetica.",
      "warning",
      "Firmar XML con certificado real y validar canonicalizacion contra SII.",
    ),
    item(
      "sii_client",
      "PENDING_REAL_SII",
      "Cliente SII de certificacion esta bloqueado hasta integrar endpoints reales.",
      "critical",
      "Implementar seed/token/upload/status contra ambiente certificacion SII.",
    ),
    item(
      "track_id",
      "PENDING_REAL_SII",
      "No existe track_id real porque no hay envio a SII.",
      "critical",
      "Enviar set de pruebas al ambiente de certificacion y guardar track_id.",
    ),
    item(
      "sii_status_query",
      "PENDING_REAL_SII",
      "Consulta de estado real SII pendiente.",
      "critical",
      "Consultar estado por track_id y mapear respuesta a estado interno.",
    ),
    item(
      "printed_sample",
      exists(repoRoot, "lib/dte/pdf/build-dte-print-view.ts") ? "OK" : "WARNING",
      "Base de muestra impresa/PDF LAB disponible, sin validez tributaria.",
      "warning",
      "Agregar PDF417/TED real solo despues de CAF/firma validada.",
    ),
    item(
      "db_schema",
      exists(repoRoot, "docs/dte-sii/DTE_PRODUCTION_SCHEMA.sql")
        ? "OK"
        : "WARNING",
      "Schema DTE productivo documentado, no aplicado automaticamente.",
      "warning",
      "Revisar y migrar con RLS antes de certification real.",
    ),
    item(
      "multi_tenant",
      exists(repoRoot, "docs/dte-sii/DTE_MULTI_TENANT_SECURITY.md")
        ? "OK"
        : "WARNING",
      "Enfoque citaya_own_dte por tenant requiere RLS, aislamiento de secretos y auditoria.",
      "critical",
      "Aplicar reglas multi-tenant antes de activar emision por tenant.",
    ),
    item(
      "agenda_payments",
      exists(repoRoot, "docs/dte-sii/AGENDA_PAYMENTS_DTE_INTEGRATION_PLAN.md")
        ? "OK"
        : "WARNING",
      "Integracion agenda/pagos queda como plan, no activa emision automatica.",
      "warning",
      "Conectar eventos solo despues de certificacion y folios transaccionales.",
    ),
  );

  const blockers = items
    .filter(
      (readinessItem) =>
        readinessItem.severity === "critical" &&
        (readinessItem.status === "MISSING" ||
          readinessItem.status === "PENDING_REAL_SII"),
    )
    .map((readinessItem) => `${readinessItem.category}: ${readinessItem.message}`);

  const importantPending = items
    .filter(
      (readinessItem) =>
        readinessItem.status === "WARNING" || readinessItem.status === "LAB_ONLY",
    )
    .map((readinessItem) => `${readinessItem.category}: ${readinessItem.message}`);

  const nextActions = Array.from(new Set(items.map((readinessItem) => readinessItem.nextAction))).slice(
    0,
    10,
  );

  const labCategories = ["mode", "xsd", "xsd_validation", "xml_generation", "printed_sample"];
  const certificationCategories = [
    ...labCategories,
    "frmt",
    "xmldsig",
    "sii_client",
    "track_id",
    "sii_status_query",
    "db_schema",
    "multi_tenant",
  ];
  const productionCategories = [
    ...certificationCategories,
    "issuer",
    "folios",
    "agenda_payments",
  ];

  return {
    mode,
    labScore: score(items, labCategories),
    certificationScore: score(items, certificationCategories),
    productionTechnicalScore: score(items, productionCategories),
    readinessScore: score(items, productionCategories),
    globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
    items,
    blockers,
    importantPending,
    nextActions,
    hasDangerousConfig: items.some((readinessItem) =>
      readinessItem.message.includes("Ruta de secreto sospechosa"),
    ),
    hasCriticalMissing: items.some(
      (readinessItem) =>
        readinessItem.severity === "critical" && readinessItem.status === "MISSING",
    ),
  };
}
