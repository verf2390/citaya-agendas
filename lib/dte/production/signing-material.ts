import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

import type { ProductionRuntimeConfig } from "./config";

function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`);
}

function secureRegularFile(path: string, root: string, secret: boolean): Buffer {
  const absolute = resolve(path);
  if (!inside(root, absolute)) throw new Error("DTE_SIGNING_PATH_OUTSIDE_ROOT");
  const stat = lstatSync(absolute);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    realpathSync(absolute) !== absolute
  )
    throw new Error("DTE_SIGNING_FILE_UNSAFE");
  if (secret && (stat.mode & 0o077) !== 0)
    throw new Error("DTE_SIGNING_KEY_PERMISSIONS_UNSAFE");
  return readFileSync(absolute);
}

export function loadValidatedProductionSigningMaterial(input: {
  certificatePath: string;
  privateKeyPath: string;
  config: ProductionRuntimeConfig;
  now?: Date;
}): { certificatePem: string; privateKeyPem: string } {
  const certificatePem = secureRegularFile(
    input.certificatePath,
    input.config.certificateRoot,
    false,
  ).toString("utf8");
  const privateKeyPem = secureRegularFile(
    input.privateKeyPath,
    input.config.privateKeyRoot,
    true,
  ).toString("utf8");
  const certificate = new X509Certificate(certificatePem);
  const now = (input.now ?? new Date()).valueOf();
  if (
    new Date(certificate.validFrom).valueOf() > now ||
    new Date(certificate.validTo).valueOf() <= now
  )
    throw new Error("DTE_CERTIFICATE_NOT_CURRENT");
  const derived = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "der",
  });
  const supplied = certificate.publicKey.export({
    type: "spki",
    format: "der",
  });
  if (!Buffer.from(derived).equals(Buffer.from(supplied)))
    throw new Error("DTE_CERTIFICATE_KEY_MISMATCH");
  return { certificatePem, privateKeyPem };
}
