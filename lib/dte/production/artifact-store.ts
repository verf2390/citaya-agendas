import { createHash } from "node:crypto";

export type PrivateArtifactWrite = {
  tenantId: string;
  documentId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
};

export type PrivateArtifactWriteResult = {
  storageKey: string;
  sha256: string;
  byteLength: number;
};

export interface PrivateDteArtifactStore {
  putImmutable(input: PrivateArtifactWrite): Promise<PrivateArtifactWriteResult>;
  getPrivate(
    tenantId: string,
    storageKey: string,
  ): Promise<{ bytes: Buffer; contentType: string }>;
}

function safeSegment(value: string, field: string): string {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(value))
    throw new Error(`DTE_STORAGE_${field.toUpperCase()}_INVALID`);
  return value;
}

function keyFor(input: PrivateArtifactWrite, sha256: string): string {
  return [
    safeSegment(input.tenantId, "tenant"),
    safeSegment(input.documentId, "document"),
    sha256,
    safeSegment(input.fileName, "file"),
  ].join("/");
}

export class InMemoryPrivateDteArtifactStore
  implements PrivateDteArtifactStore
{
  private values = new Map<string, { bytes: Buffer; contentType: string }>();

  async putImmutable(
    input: PrivateArtifactWrite,
  ): Promise<PrivateArtifactWriteResult> {
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storageKey = keyFor(input, sha256);
    const existing = this.values.get(storageKey);
    if (existing && !existing.bytes.equals(input.bytes))
      throw new Error("DTE_STORAGE_IMMUTABILITY_CONFLICT");
    this.values.set(storageKey, {
      bytes: Buffer.from(input.bytes),
      contentType: input.contentType,
    });
    return { storageKey, sha256, byteLength: input.bytes.length };
  }

  async getPrivate(
    tenantId: string,
    storageKey: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    if (!storageKey.startsWith(`${safeSegment(tenantId, "tenant")}/`))
      throw new Error("DTE_STORAGE_TENANT_MISMATCH");
    const value = this.values.get(storageKey);
    if (!value) throw new Error("DTE_ARTIFACT_NOT_FOUND");
    return {
      bytes: Buffer.from(value.bytes),
      contentType: value.contentType,
    };
  }
}

type StorageBucket = {
  upload(
    path: string,
    body: Buffer,
    options: {
      contentType: string;
      upsert: boolean;
      cacheControl: string;
    },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
  download(
    path: string,
  ): Promise<{ data: Blob | null; error: { message?: string } | null }>;
};

type StorageClient = {
  storage: { from(bucket: string): StorageBucket };
};

export class SupabasePrivateDteArtifactStore
  implements PrivateDteArtifactStore
{
  constructor(
    private readonly client: StorageClient,
    private readonly bucket: string,
  ) {
    if (
      !/^[a-z0-9][a-z0-9_-]{2,62}$/.test(bucket) ||
      /public/i.test(bucket)
    )
      throw new Error("DTE_STORAGE_BUCKET_INVALID");
  }

  async putImmutable(
    input: PrivateArtifactWrite,
  ): Promise<PrivateArtifactWriteResult> {
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storageKey = keyFor(input, sha256);
    const result = await this.client.storage.from(this.bucket).upload(
      storageKey,
      input.bytes,
      {
        contentType: input.contentType,
        upsert: false,
        cacheControl: "private, no-store",
      },
    );
    if (result.error && !/already exists|duplicate/i.test(result.error.message ?? ""))
      throw new Error("DTE_PRIVATE_STORAGE_WRITE_FAILED");
    return { storageKey, sha256, byteLength: input.bytes.length };
  }

  async getPrivate(
    tenantId: string,
    storageKey: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    if (!storageKey.startsWith(`${safeSegment(tenantId, "tenant")}/`))
      throw new Error("DTE_STORAGE_TENANT_MISMATCH");
    const result = await this.client.storage.from(this.bucket).download(storageKey);
    if (result.error || !result.data)
      throw new Error("DTE_PRIVATE_STORAGE_READ_FAILED");
    return {
      bytes: Buffer.from(await result.data.arrayBuffer()),
      contentType: result.data.type || "application/octet-stream",
    };
  }
}
