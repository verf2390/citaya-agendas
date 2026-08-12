import { createHash } from "node:crypto";
import { classifyUploadResponse } from "../certification/factura-certification-set-submit";
import {
  buildGetSeedSoapEnvelope,
  buildGetTokenSoapEnvelope,
  parseSeedSoapResponse,
  parseTokenSoapResponse,
  signSiiSeedXml,
} from "../sii/sii-auth";
import { parseSiiStatusResponse } from "../sii/sii-status";
import type { ProductionRuntimeConfig } from "./config";
import { loadValidatedProductionSigningMaterial } from "./signing-material";

export type ProductionSiiMilestone =
  | "seed_before_fetch"
  | "seed_after_fetch"
  | "token_before_fetch"
  | "token_after_fetch"
  | "upload_before_fetch"
  | "upload_after_fetch"
  | "status_before_fetch"
  | "status_after_fetch";

export type ProductionUploadResult =
  | {
      status: "submitted";
      trackId: string;
      responseSha256: string;
      responseSafe: Record<string, unknown>;
      uploadCount: 1;
      responseBytes?: Buffer | null;
    }
  | {
      status: "rejected";
      trackId: null;
      responseSha256: string;
      responseSafe: Record<string, unknown>;
      uploadCount: 1;
      responseBytes?: Buffer | null;
    }
  | {
      status: "ambiguous";
      trackId: null;
      responseSha256: string | null;
      responseSafe: Record<string, unknown>;
      uploadCount: 1;
      responseBytes?: Buffer | null;
    };

export type ProductionStatusResult = {
  trackId: string;
  siiStatus: string;
  responseSha256: string;
  responseBytes?: Buffer | null;
  responseSafe: Record<string, unknown>;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeResponse(input: {
  httpStatus?: number;
  contentType?: string | null;
  bytes?: number;
  category: string;
  siiStatus?: string | null;
}): Record<string, unknown> {
  return {
    httpStatus: input.httpStatus ?? null,
    contentType: input.contentType?.slice(0, 80) ?? null,
    bytes: input.bytes ?? null,
    category: input.category,
    siiStatus: input.siiStatus?.slice(0, 32) ?? null,
  };
}

function splitRut(rut: string): { rut: string; dv: string } {
  const normalized = rut.replace(/[.\s]/g, "").toUpperCase();
  const match = normalized.match(/^(\d+)-([0-9K])$/);
  if (!match) throw new Error("DTE_SII_RUT_INVALID");
  return { rut: match[1], dv: match[2] };
}

function assertOkAuth(
  response: Response,
  parsed: { estado: string | null; glosa: string | null },
  value: string | null,
  step: "seed" | "token",
): string {
  if (
    !response.ok ||
    !["0", "00", "OK"].includes(String(parsed.estado ?? "").toUpperCase()) ||
    !value
  )
    throw new Error(`DTE_SII_${step.toUpperCase()}_REJECTED`);
  return value;
}

export interface IProductionSiiClient {
  uploadExactlyOnce(input: {
    envelope: Buffer;
    fileName: string;
    issuerRut: string;
    senderRut: string;
    certificatePath: string;
    privateKeyPath: string;
    milestone: (event: ProductionSiiMilestone) => Promise<void>;
  }): Promise<ProductionUploadResult>;

  queryStatusManually(input: {
    trackId: string;
    token: string;
    milestone: (event: ProductionSiiMilestone) => Promise<void>;
    companyRut?: string;
    document?: {
      dteType: 39 | 41;
      folio: number;
      recipientRut: string;
      amount: number;
      issueDate: string;
    };
  }): Promise<ProductionStatusResult>;
}

import { SiiBoletaApiTransport } from "./boleta-api-transport";

export function createProductionSiiClient(
  config: ProductionRuntimeConfig,
  dteType?: number,
  fetchImpl?: typeof fetch,
): IProductionSiiClient {
  if (dteType && [39, 41].includes(Number(dteType))) {
    return new SiiBoletaApiTransport(config);
  }
  return new ProductionSiiClient(config, fetchImpl);
}

export class ProductionSiiClient implements IProductionSiiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: ProductionRuntimeConfig,
    fetchImpl?: typeof fetch,
  ) {
    if (
      config.environment !== "production" ||
      config.signingMode !== "production" ||
      !config.enabled
    )
      throw new Error("DTE_PRODUCTION_CLIENT_DISABLED");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async uploadExactlyOnce(input: {
    envelope: Buffer;
    fileName: string;
    issuerRut: string;
    senderRut: string;
    certificatePath: string;
    privateKeyPath: string;
    milestone: (event: ProductionSiiMilestone) => Promise<void>;
  }): Promise<ProductionUploadResult> {
    const signingMaterial = loadValidatedProductionSigningMaterial({
      certificatePath: input.certificatePath,
      privateKeyPath: input.privateKeyPath,
      config: this.config,
    });
    let uploadStarted = false;
    let uploadCount = 0;
    try {
      await input.milestone("seed_before_fetch");
      const seedResponse = await this.fetchImpl(this.config.seedUrl, {
        method: "POST",
        headers: {
          "content-type": "text/xml; charset=utf-8",
          soapaction: "",
        },
        body: buildGetSeedSoapEnvelope(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const seedRaw = await seedResponse.text();
      await input.milestone("seed_after_fetch");
      const seedParsed = parseSeedSoapResponse(seedRaw);
      const seed = assertOkAuth(
        seedResponse,
        seedParsed,
        seedParsed.semilla,
        "seed",
      );

      const signedSeed = signSiiSeedXml(
        seed,
        signingMaterial.privateKeyPem,
        signingMaterial.certificatePem,
      );
      await input.milestone("token_before_fetch");
      const tokenResponse = await this.fetchImpl(this.config.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "text/xml; charset=utf-8",
          soapaction: "",
        },
        body: buildGetTokenSoapEnvelope(signedSeed),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const tokenRaw = await tokenResponse.text();
      await input.milestone("token_after_fetch");
      const tokenParsed = parseTokenSoapResponse(tokenRaw);
      const token = assertOkAuth(
        tokenResponse,
        tokenParsed,
        tokenParsed.token,
        "token",
      );

      const sender = splitRut(input.senderRut);
      const company = splitRut(input.issuerRut);
      const form = new FormData();
      form.set("rutSender", sender.rut);
      form.set("dvSender", sender.dv);
      form.set("rutCompany", company.rut);
      form.set("dvCompany", company.dv);
      form.set(
        "archivo",
        new Blob([Uint8Array.from(input.envelope)], { type: "text/xml" }),
        input.fileName,
      );
      await input.milestone("upload_before_fetch");
      uploadStarted = true;
      uploadCount += 1;
      if (uploadCount !== 1) throw new Error("DTE_MULTIPLE_UPLOAD_BLOCKED");
      const uploadResponse = await this.fetchImpl(this.config.uploadUrl, {
        method: "POST",
        headers: {
          "user-agent": "PROG 1.0",
          accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8",
          "accept-language": "es-cl",
          "cache-control": "no-cache",
          cookie: `TOKEN=${token}`,
        },
        body: form,
        redirect: "manual",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const raw = await uploadResponse.text();
      await input.milestone("upload_after_fetch");
      const responseSha256 = sha256(raw);
      const classification = classifyUploadResponse(raw);
      const responseSafe = safeResponse({
        httpStatus: uploadResponse.status,
        contentType: uploadResponse.headers.get("content-type"),
        bytes: Buffer.byteLength(raw),
        category: classification.semanticCategory,
        siiStatus: classification.status,
      });
      if (
        uploadResponse.ok &&
        classification.kind === "accepted" &&
        classification.trackId
      )
        return {
          status: "submitted",
          trackId: classification.trackId,
          responseSha256,
          responseSafe,
          responseBytes: Buffer.from(raw, "utf8"),
          uploadCount: 1,
        };
      if (uploadResponse.ok && classification.kind === "rejected")
        return {
          status: "rejected",
          trackId: null,
          responseSha256,
          responseSafe,
          responseBytes: Buffer.from(raw, "utf8"),
          uploadCount: 1,
        };
      return {
        status: "ambiguous",
        trackId: null,
        responseSha256,
        responseSafe,
        responseBytes: Buffer.from(raw, "utf8"),
        uploadCount: 1,
      };
    } catch (error) {
      if (!uploadStarted) throw error;
      return {
        status: "ambiguous",
        trackId: null,
        responseSha256: null,
        responseSafe: safeResponse({ category: "network_or_timeout" }),
        responseBytes: null,
        uploadCount: 1,
      };
    }
  }

  async queryStatusManually(input: {
    trackId: string;
    token: string;
    milestone: (event: ProductionSiiMilestone) => Promise<void>;
  }): Promise<ProductionStatusResult> {
    if (!input.trackId.trim() || !input.token.trim())
      throw new Error("DTE_MANUAL_STATUS_INPUT_REQUIRED");
    await input.milestone("status_before_fetch");
    const url = `${this.config.statusUrl}${
      this.config.statusUrl.includes("?") ? "&" : "?"
    }trackId=${encodeURIComponent(input.trackId)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { cookie: `TOKEN=${input.token}` },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const raw = await response.text();
    await input.milestone("status_after_fetch");
    const parsed = parseSiiStatusResponse(raw);
    const responseSafe = {
      ...safeResponse({
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(raw),
        category: "manual_status",
        siiStatus: parsed.status,
      }),
      informedCount: parsed.informedCount,
      acceptedCount: parsed.acceptedCount,
      rejectedCount: parsed.rejectedCount,
      objectionCount: parsed.objectionCount,
    };
    return {
      trackId: input.trackId,
      siiStatus: parsed.status,
      responseSha256: sha256(raw),
      responseBytes: Buffer.from(raw, "utf8"),
      responseSafe,
    };
  }
}
