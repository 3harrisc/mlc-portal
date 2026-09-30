import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  appendCountersignCertificate,
  appendParticularsSchedule,
  ukDate,
  appendSignatureCertificate,
  assertSignablePdf,
  pdfSafeText,
  sha256Hex,
} from "./certificate";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function twoPagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  return pdf.save();
}

describe("sha256Hex", () => {
  it("hashes bytes to hex", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("assertSignablePdf", () => {
  it("returns the page count of a valid PDF", async () => {
    expect(await assertSignablePdf(await twoPagePdf())).toBe(2);
  });

  it("rejects bytes that aren't a PDF", async () => {
    await expect(assertSignablePdf(new TextEncoder().encode("nope"))).rejects.toThrow(
      /couldn't be read/,
    );
  });
});

describe("pdfSafeText", () => {
  it("folds letters Helvetica can't encode", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(pdfSafeText(font, "Łukasz Wójcik")).toBe("Lukasz Wójcik");
    expect(pdfSafeText(font, "Ștefan")).toBe("Stefan");
    expect(pdfSafeText(font, "李")).toBe("?");
  });
});

describe("appendSignatureCertificate", () => {
  it("keeps the original pages and adds one certificate page", async () => {
    const signed = await appendSignatureCertificate(await twoPagePdf(), PNG_1X1, {
      signatureId: "sig-1",
      documentTitle: "Driver contract",
      documentCategory: "Contract",
      documentId: "doc-1",
      documentSha256: "a".repeat(64),
      signedName: "Łukasz Nowak",
      driverName: "Łukasz Nowak",
      driverEmail: "driver@example.com",
      signedAt: new Date("2026-09-30T10:00:00Z"),
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 ".repeat(3),
      agreementText: "I agree.",
    });
    const reopened = await PDFDocument.load(signed);
    expect(reopened.getPageCount()).toBe(3);
  });
});

describe("appendCountersignCertificate", () => {
  it("adds a second certificate page after the driver's", async () => {
    const driverSigned = await appendSignatureCertificate(await twoPagePdf(), PNG_1X1, {
      signatureId: "sig-1",
      documentTitle: "Driver contract",
      documentCategory: "Contract",
      documentId: "doc-1",
      documentSha256: "a".repeat(64),
      signedName: "Sam Driver",
      driverName: "Sam Driver",
      driverEmail: "sam@example.com",
      signedAt: new Date("2026-09-30T10:00:00Z"),
      ipAddress: null,
      userAgent: null,
      agreementText: "I agree.",
    });
    const countersigned = await appendCountersignCertificate(driverSigned, PNG_1X1, {
      countersignatureId: "cs-1",
      driverSignatureId: "sig-1",
      documentTitle: "Driver contract",
      signerName: "David Harris",
      signerTitle: "Company Director",
      signerEmail: "david@example.com",
      driverSignedName: "Sam Driver",
      signedAt: new Date("2026-10-01T09:00:00Z"),
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0",
      agreementText: "Signed for MLC.",
      inputSha256: sha256Hex(driverSigned),
    });
    expect((await PDFDocument.load(countersigned)).getPageCount()).toBe(4);
  });
});

describe("appendParticularsSchedule", () => {
  it("adds one unsigned schedule page", async () => {
    const out = await appendParticularsSchedule(await twoPagePdf(), "HGV Driver Employment Contract", {
      legalName: "Łukasz Nowak",
      address: "1 High Street, Cheltenham, GL50 1AA",
      startDate: "2026-10-05",
      continuousEmploymentDate: "2026-10-05",
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it("formats dates without shifting the day", () => {
    expect(ukDate("2026-10-05")).toBe("5 October 2026");
    expect(ukDate("2027-03-28")).toBe("28 March 2027");
  });
});
