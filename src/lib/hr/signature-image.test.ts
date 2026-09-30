import { describe, expect, it } from "vitest";
import { looksLikePdf, parseSignatureDataUrl, MAX_SIGNATURE_BYTES } from "./signature-image";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("parseSignatureDataUrl", () => {
  it("decodes a PNG data URL", () => {
    const bytes = parseSignatureDataUrl(`data:image/png;base64,${PNG_1X1}`);
    expect(bytes[1]).toBe(0x50); // 'P' of \x89PNG
  });

  it("rejects missing or non-PNG input", () => {
    expect(() => parseSignatureDataUrl(undefined)).toThrow(/missing/);
    expect(() => parseSignatureDataUrl("data:image/jpeg;base64,AAAA")).toThrow(/missing/);
  });

  it("rejects data that isn't a PNG", () => {
    const notPng = Buffer.from("hello world").toString("base64");
    expect(() => parseSignatureDataUrl(`data:image/png;base64,${notPng}`)).toThrow(/corrupted/);
  });

  it("rejects oversized images before decoding", () => {
    const huge = "A".repeat(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 8);
    expect(() => parseSignatureDataUrl(`data:image/png;base64,${huge}`)).toThrow(/too large/);
  });
});

describe("looksLikePdf", () => {
  it("checks the %PDF- header", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("PK\u0003\u0004 docx"))).toBe(false);
  });
});
