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
    if (readinessItem.status === "WARNING") return total + 0.85;
    if (readinessItem.status === "LAB_ONLY") {
      return total + 0.8;
    }
    if (readinessItem.status === "PENDING_REAL_SII") return total + 0.78;
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
      exists(repoRoot, "lib/dte/sii/sii-auth.ts") &&
        exists(repoRoot, "lib/dte/sii/sii-submit.ts") &&
        exists(repoRoot, "lib/dte/sii/sii-status.ts")
        ? "WARNING"
        : "PENDING_REAL_SII",
      "Cliente SII certification separado por seed/token/submit/status; envio real sigue bloqueado sin credenciales.",
      "critical",
      "Configurar endpoints SII certification y probar smoke --dry-run antes de submit real.",
    ),
    item(
      "sii_auth",
      exists(repoRoot, "lib/dte/sii/sii-auth.ts") ? "WARNING" : "PENDING_REAL_SII",
      "Flujo seed/token preparado con firma local de seed; requiere certificado real y endpoint SII.",
      "critical",
      "Probar seed/token con certificado real de certification fuera del repo.",
    ),
    item(
      "sii_submit",
      exists(repoRoot, "lib/dte/sii/sii-submit.ts") ? "WARNING" : "PENDING_REAL_SII",
      "Submit EnvioDTE preparado con validaciones; submit real bloqueado por feature flag y configuracion.",
      "critical",
      "Ejecutar smoke --submit solo con DTE_SII_ENABLE_SUBMIT=true y credenciales reales.",
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
      "persistence_schema",
      exists(repoRoot, "docs/dte-sii/DTE_PRODUCTION_SCHEMA.sql") ? "OK" : "WARNING",
      "Schema contempla tax_documents, submissions, status history y audit log.",
      "warning",
      "Aplicar migraciones reales solo despues de revision RLS.",
    ),
    item(
      "submissions_persistence",
      exists(repoRoot, "lib/dte/persistence/dte-submissions.ts") ? "OK" : "WARNING",
      "Persistencia no productiva de submissions con hashes y respuesta redactada.",
      "warning",
      "Conectar repositorio Supabase cuando exista migracion DTE.",
    ),
    item(
      "status_history",
      exists(repoRoot, "lib/dte/persistence/dte-status-history.ts") ? "OK" : "WARNING",
      "Status history registra transiciones internas/SII con fuente y razon.",
      "warning",
      "Persistir historial real por tenant/documento en DB.",
    ),
    item(
      "audit_log",
      exists(repoRoot, "lib/dte/persistence/dte-audit.ts") ? "OK" : "WARNING",
      "Audit log redactado disponible para intentos LAB/certification.",
      "warning",
      "Agregar actor real y RLS antes de operaciones reales.",
    ),
    item(
      "redaction",
      exists(repoRoot, "lib/dte/persistence/dte-redaction.ts") ? "OK" : "WARNING",
      "Redaccion evita guardar tokens completos, secretos, PEM y rutas sensibles.",
      "critical",
      "Mantener logs sin secretos y guardar solo fingerprints/hashes.",
    ),
    item(
      "xml_hashing",
      exists(repoRoot, "lib/dte/persistence/dte-hash.ts") ? "OK" : "WARNING",
      "Hash SHA-256 disponible para XML/respuestas sin guardar contenido sensible.",
      "warning",
      "Usar xml_sha256 como evidencia y evitar duplicados.",
    ),
    item(
      "blocked_submit_audit",
      exists(repoRoot, "scripts/dte/sii-certification-smoke.mjs") ? "OK" : "WARNING",
      "Smoke registra dry-run y submit bloqueado en traza no productiva.",
      "warning",
      "Persistir blocked submit en DB real cuando exista repositorio Supabase.",
    ),
    item(
      "tenant_isolation_persistence",
      exists(repoRoot, "lib/dte/persistence/supabase-dte-repository.ts") ? "WARNING" : "MISSING",
      "Repositorio Supabase implementado detras de feature flag; aislamiento final depende de migracion/RLS aplicada por tenant_id.",
      "critical",
      "Aplicar migracion revisada y validar RLS antes de certification real.",
    ),
    item(
      "supabase_migration_documented",
      exists(repoRoot, "docs/dte-sii/DTE_SUPABASE_MIGRATION.sql") ? "OK" : "MISSING",
      "Migracion Supabase DTE revisable y no aplicada automaticamente.",
      "warning",
      "Revisar/aplicar manualmente DTE_SUPABASE_MIGRATION.sql en Supabase.",
    ),
    item(
      "supabase_repository",
      exists(repoRoot, "lib/dte/persistence/supabase-dte-repository.ts") ? "OK" : "MISSING",
      "SupabaseDteRepository disponible para LAB/certification con fallos controlados.",
      "warning",
      "Activar solo con DTE_PERSISTENCE_BACKEND=supabase tras migracion.",
    ),
    item(
      "rls_documented",
      exists(repoRoot, "docs/dte-sii/DTE_SUPABASE_MIGRATION.sql") &&
        exists(repoRoot, "docs/dte-sii/DTE_SUPABASE_PERSISTENCE.md")
        ? "OK"
        : "WARNING",
      "RLS sugerida por tenant/platform admin documentada; no aplicada automaticamente.",
      "critical",
      "Validar policies tenant_members/platform_admins antes de usar datos reales.",
    ),
    item(
      "repository_factory",
      exists(repoRoot, "lib/dte/persistence/get-dte-repository.ts") ? "OK" : "MISSING",
      "Factory de repositorio mantiene memory por defecto y Supabase solo por feature flag.",
      "warning",
      "Mantener DTE_PERSISTENCE_BACKEND sin supabase en entornos sin migracion.",
    ),
    item(
      "admin_trace_endpoints",
      exists(repoRoot, "app/api/admin/dte-lab/traces/route.ts") ? "OK" : "WARNING",
      "Endpoints admin de trazas DTE disponibles con respuesta redactada.",
      "warning",
      "Probar con tenant admin y revisar que no exponga XML, tokens ni rutas privadas.",
    ),
    item(
      "ui_trace_viewer",
      exists(repoRoot, "app/admin/facturacion/page.tsx") ? "WARNING" : "MISSING",
      "UI muestra backend/trazas DTE como LAB/PENDIENTE/NO PRODUCTIVO.",
      "warning",
      "Usar vista solo como soporte pre-certificacion, no como emision legal.",
    ),
    item(
      "persistence_backend_feature_flag",
      "WARNING",
      `DTE_PERSISTENCE_BACKEND=${env.DTE_PERSISTENCE_BACKEND ?? "memory(default)"}`,
      "critical",
      "No activar Supabase sin migracion, RLS revisada y tenant propio.",
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
    "sii_auth",
    "sii_submit",
    "track_id",
    "sii_status_query",
    "db_schema",
    "persistence_schema",
    "submissions_persistence",
    "status_history",
    "audit_log",
    "redaction",
    "xml_hashing",
    "blocked_submit_audit",
    "multi_tenant",
  ];
  const productionCategories = [
    ...certificationCategories,
    "issuer",
    "folios",
    "tenant_isolation_persistence",
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
