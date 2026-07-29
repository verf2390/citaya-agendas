import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeIso88591Strict,
  runControlledCertificationSet,
} from "../certification/factura-set-dry-run";
import {
  buildPdf,
  parseFinalDte,
} from "../certification/factura-printed-samples-dry-run";
import type { ImportedCaf } from "../certification/caf-secure-import";
import type { TaxDocumentDraft } from "../types";
import { assertProductionConfig } from "./config";
import {
  assertValidProductionIssuerActivityCode,
  assertValidProductionIssuerResolution,
} from "./issuer-settings";
import { loadValidatedProductionSigningMaterial } from "./signing-material";
import type {
  ProductionDocument,
  ProductionTenantSettings,
} from "./types";

export type ProductionGeneratedArtifacts = {
  dteXml: Buffer;
  envioXml: Buffer;
  pdf: Buffer;
  metadata: {
    encoding: "ISO-8859-1";
    xsd: "valid";
    xmlsec1: "valid";
    frmt: "valid";
    xmlnsXsiPhysical: true;
  };
};

export interface ProductionDteGenerator {
  generate(input: {
    document: ProductionDocument;
    settings: ProductionTenantSettings;
    caf: ImportedCaf;
    env: NodeJS.ProcessEnv;
  }): Promise<ProductionGeneratedArtifacts>;
}

function documentType(type: number): TaxDocumentDraft["documentType"] {
  if (type === 33) return "factura_afecta";
  if (type === 56) return "nota_debito";
  if (type === 61) return "nota_credito";
  throw new Error("DTE_PRODUCTION_TYPE_UNSUPPORTED");
}

function buildDraft(
  document: ProductionDocument,
  settings: ProductionTenantSettings,
): TaxDocumentDraft {
  if (document.folio === null) throw new Error("DTE_FOLIO_NOT_RESERVED");
  return {
    tenantId: document.tenantId,
    issueMode: "citaya_own_dte",
    documentType: documentType(document.dteType),
    status: "draft",
    folio: document.folio,
    issueDate: document.issueDate,
    issuer: {
      tenantId: document.tenantId,
      rut: settings.issuer.rut,
      legalName: settings.issuer.legalName,
      businessActivity: settings.issuer.businessActivity,
      businessActivityCode: settings.issuer.businessActivityCode,
      address: settings.issuer.address,
      commune: settings.issuer.commune,
      city: settings.issuer.city,
      siiResolutionDate: settings.issuer.resolutionDate,
      siiResolutionNumber: settings.issuer.resolutionNumber,
      dteEnvironment: "production",
    },
    recipient: {
      rut: document.recipient.rut,
      legalName: document.recipient.legalName,
      businessActivity: document.recipient.businessActivity ?? "",
      address: document.recipient.address ?? "",
      commune: document.recipient.commune ?? "",
      city: document.recipient.city ?? "",
      email: document.recipient.email,
    },
    lines: document.lines.map((line) => ({
      name: line.name,
      description: line.description ?? "",
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.quantity * line.unitPrice,
      exempt: line.exempt === true,
      discountPercent: line.discountPercent ?? undefined,
    })),
    references: document.references,
    netAmount: document.netAmount,
    exemptAmount: document.exemptAmount,
    taxAmount: document.taxAmount,
    totalAmount: document.totalAmount,
  };
}

export class CertifiedProductionDteGenerator
  implements ProductionDteGenerator
{
  async generate(input: {
    document: ProductionDocument;
    settings: ProductionTenantSettings;
    caf: ImportedCaf;
    env: NodeJS.ProcessEnv;
  }): Promise<ProductionGeneratedArtifacts> {
    const config = assertProductionConfig(input.env, process.cwd());
    assertValidProductionIssuerResolution(input.settings.issuer);
    assertValidProductionIssuerActivityCode(input.settings.issuer);
    loadValidatedProductionSigningMaterial({
      certificatePath: input.settings.certificatePath,
      privateKeyPath: input.settings.privateKeyPath,
      config,
    });
    if (
      input.caf.materialKind !== "production_real" ||
      input.caf.trustStatus !== "verified_official" ||
      input.caf.realUseBlocked
    )
      throw new Error("DTE_PRODUCTION_CAF_NOT_AUTHORIZED");
    const outputDir = mkdtempSync(join(tmpdir(), "citaya-dte-production-"));
    const caseId = `prod-${input.document.id}`;
    const envelopeFileName = `${caseId}-envio.xml`;
    const manifestFileName = `${caseId}-manifest.json`;
    try {
      const result = runControlledCertificationSet({
        executionEnvironment: "production",
        tenantId: input.document.tenantId,
        env: input.env,
        outputDir,
        signingMaterial: {
          privateKeyPath: input.settings.privateKeyPath,
          certificatePath: input.settings.certificatePath,
        },
        drafts: [buildDraft(input.document, input.settings)],
        caseIds: [caseId],
        rutEnvia: input.settings.senderRut,
        importedCafs: [input.caf],
        setDteId: `CitayaProd-${input.document.id}`,
        envelopeFileName,
        manifestFileName,
        generationTimestamp: new Date().toISOString().slice(0, 19),
        manifestMetadata: {
          environment: "production",
          tenantFingerprint: input.document.tenantId.slice(0, 8),
          documentId: input.document.id,
        },
      });
      if (result.environment !== "production" || result.siiContacted)
        throw new Error("DTE_PRODUCTION_GENERATION_BOUNDARY_FAILED");
      const dtePath = join(outputDir, `${caseId}-DTE-CERTIFICATION.xml`);
      const dteXml = readFileSync(dtePath);
      const envioXml = readFileSync(result.envelopePath);
      const dteText = dteXml.toString("latin1");
      if (
        !encodeIso88591Strict(dteText).equals(dteXml) ||
        !dteText.includes(
          'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
        ) ||
        !dteText.includes("<FRMT algoritmo=\"SHA1withRSA\">") ||
        !dteText.includes("<Signature")
      )
        throw new Error("DTE_CERTIFIED_CORRECTIONS_MISSING");
      const source = parseFinalDte(dtePath, caseId);
      const pdf = await buildPdf(
        {
          source,
          cedible: false,
          fileName: `${caseId}.pdf`,
        },
        {
          productionMetadata: {
            resolutionNumber: input.settings.issuer.resolutionNumber,
            resolutionYear: input.settings.issuer.resolutionDate.slice(0, 4),
            siiOffice: input.settings.issuer.siiOffice ?? null,
          },
        },
      );
      return {
        dteXml,
        envioXml,
        pdf: pdf.bytes,
        metadata: {
          encoding: "ISO-8859-1",
          xsd: "valid",
          xmlsec1: "valid",
          frmt: "valid",
          xmlnsXsiPhysical: true,
        },
      };
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }
}
