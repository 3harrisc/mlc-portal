/** Largest drawn signature we accept, decoded. A phone canvas PNG is ~10–60 KB. */
export const MAX_SIGNATURE_BYTES = 400 * 1024;

const PREFIX = "data:image/png;base64,";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Decode and check a `data:image/png;base64,...` URL from the signature pad.
 * Throws with a driver-readable message when it isn't a usable PNG.
 */
export function parseSignatureDataUrl(dataUrl: unknown): Uint8Array {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIX)) {
    throw new Error("Signature is missing — please draw your signature.");
  }
  const b64 = dataUrl.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new Error("Signature image is corrupted — please clear and sign again.");
  }
  // Base64 inflates by 4/3; check before decoding to avoid large allocations.
  if ((b64.length * 3) / 4 > MAX_SIGNATURE_BYTES) {
    throw new Error("Signature image is too large — please clear and sign again.");
  }
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("Signature image is corrupted — please clear and sign again.");
  }
  return bytes;
}

/** True when the bytes start with the PDF header `%PDF-`. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}
