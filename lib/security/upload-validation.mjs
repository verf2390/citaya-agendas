const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const RULES = {
  "image/jpeg": { extension: "jpg", mediaType: "image", max: MAX_IMAGE_BYTES },
  "image/png": { extension: "png", mediaType: "image", max: MAX_IMAGE_BYTES },
  "image/webp": { extension: "webp", mediaType: "image", max: MAX_IMAGE_BYTES },
  "image/gif": { extension: "gif", mediaType: "gif", max: MAX_IMAGE_BYTES },
  "video/mp4": { extension: "mp4", mediaType: "video", max: MAX_VIDEO_BYTES },
  "video/webm": { extension: "webm", mediaType: "video", max: MAX_VIDEO_BYTES },
};

function startsWith(bytes, signature, offset = 0) {
  return signature.every((value, index) => bytes[index + offset] === value);
}

function ascii(bytes, start, length) {
  return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

function detectedMime(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (ascii(bytes, 4, 4) === "ftyp") return "video/mp4";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

function hasActiveText(bytes) {
  const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 8192)))
    .toString("utf8")
    .replace(/\u0000/g, "")
    .toLowerCase();
  return /<\s*(?:html|script|svg|iframe|object|embed)\b|javascript\s*:/.test(sample);
}

export function validateCampaignMedia({ bytes, declaredMime, originalName }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return { ok: false, reason: "empty" };
  }
  const rule = RULES[declaredMime];
  if (!rule) return { ok: false, reason: "mime_not_allowed" };
  if (bytes.byteLength > rule.max) return { ok: false, reason: "too_large" };
  if (hasActiveText(bytes)) return { ok: false, reason: "active_content" };

  const actualMime = detectedMime(bytes);
  if (actualMime !== declaredMime) {
    return { ok: false, reason: "magic_mismatch" };
  }
  const suppliedExtension = String(originalName ?? "")
    .trim()
    .toLowerCase()
    .split(".")
    .pop();
  const compatibleExtensions =
    declaredMime === "image/jpeg" ? new Set(["jpg", "jpeg"]) : new Set([rule.extension]);
  if (!suppliedExtension || !compatibleExtensions.has(suppliedExtension)) {
    return { ok: false, reason: "extension_mismatch" };
  }
  return {
    ok: true,
    mimeType: actualMime,
    extension: rule.extension,
    mediaType: rule.mediaType,
    maxBytes: rule.max,
  };
}
