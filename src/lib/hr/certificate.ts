import { createHash } from "node:crypto";
import { ukDate } from "./format";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface CertificateInfo {
  signatureId: string;
  documentTitle: string;
  documentCategory: string;
  documentId: string;
  documentSha256: string;
  signedName: string;
  driverName: string | null;
  driverEmail: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  agreementText: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Open a PDF to check it's usable for signing. Encrypted or broken files
 * throw here — at upload — rather than when a driver tries to sign.
 */
export async function assertSignablePdf(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes);
    return doc.getPageCount();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new Error("This PDF is password-protected. Save an unprotected copy and upload that.");
    }
    throw new Error("This file couldn't be read as a PDF. Try re-exporting it.");
  }
}

/**
 * Standard PDF fonts only cover WinAnsi. Drivers' names can include letters
 * outside it (Ł, Ś, Ș…), so fold accents away and replace anything still
 * unencodable. The exact typed name is kept in the database regardless.
 */
export function pdfSafeText(font: PDFFont, text: string): string {
  const fold: Record<string, string> = { Ł: "L", ł: "l", Đ: "D", đ: "d", Ø: "O", ø: "o", ß: "ss" };
  const encodable = (s: string) => {
    try {
      font.encodeText(s);
      return true;
    } catch {
      return false;
    }
  };
  let out = "";
  for (const ch of text) {
    const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += [ch, fold[ch], stripped].find((c) => c && encodable(c)) ?? "?";
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    // Hard-break single words longer than the line (user agents, hashes).
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

function ukTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "long",
    timeStyle: "long",
  }).format(d);
}

interface CertificatePage {
  heading: string;
  intro?: string;
  fields: [label: string, value: string][];
  declaration?: string;
  verification?: string[];
}

/**
 * Append one A4 page (a certificate, or a schedule when signaturePng is null).
 * The existing pages are left untouched.
 */
async function appendCertificatePage(
  inputPdf: Uint8Array,
  signaturePng: Uint8Array | null,
  content: CertificatePage,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(inputPdf);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sig = signaturePng ? await pdf.embedPng(signaturePng) : null;

  const page: PDFPage = pdf.addPage([595.28, 841.89]); // A4
  const margin = 50;
  const width = page.getWidth() - margin * 2;
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);
  let y = page.getHeight() - margin;

  const text = (s: string, opts: { size?: number; f?: PDFFont; color?: typeof ink; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    for (const line of wrap(f, pdfSafeText(f, s), size, width)) {
      page.drawText(line, { x: margin, y: y - size, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
    y -= opts.gap ?? 0;
  };
  const label = (s: string, gap = 0) => text(s.toUpperCase(), { size: 7.5, f: bold, color: muted, gap });

  text("MLC TRANSPORT", { size: 9, f: bold, color: muted, gap: 2 });
  text(content.heading, { size: 20, f: bold, gap: 6 });
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.75,
    color: rgb(0.85, 0.86, 0.88),
  });
  y -= 18;

  if (content.intro) text(content.intro, { size: 10.5, gap: 12 });

  for (const [l, v] of content.fields) {
    label(l);
    text(v, { size: 10.5, gap: 8 });
  }

  if (content.declaration) {
    label("Declaration");
    text(content.declaration, { size: 10.5, gap: 12 });
  }

  if (!sig) return pdf.save();

  label("Signature", 2);
  const boxH = 90;
  const scale = Math.min(width / sig.width, boxH / sig.height, 1);
  page.drawRectangle({
    x: margin,
    y: y - boxH - 10,
    width,
    height: boxH + 10,
    borderColor: rgb(0.85, 0.86, 0.88),
    borderWidth: 0.75,
  });
  page.drawImage(sig, {
    x: margin + 5,
    y: y - boxH - 5,
    width: sig.width * scale,
    height: sig.height * scale,
  });
  y -= boxH + 28;

  if (content.verification?.length) {
    label("Verification");
    for (const line of content.verification) text(line, { size: 8, color: muted });
  }

  return pdf.save();
}

function timeFields(at: Date, ip: string | null, ua: string | null): [string, string][] {
  return [
    ["Signed at (UK time)", ukTime(at)],
    ["Signed at (UTC)", at.toISOString()],
    ["IP address", ip || "Not recorded"],
    ["Device", ua || "Not recorded"],
  ];
}

/** Driver signature: certificate page appended to the original PDF. */
export async function appendSignatureCertificate(
  originalPdf: Uint8Array,
  signaturePng: Uint8Array,
  info: CertificateInfo,
): Promise<Uint8Array> {
  return appendCertificatePage(originalPdf, signaturePng, {
    heading: "Electronic Signature Certificate",
    fields: [
      ["Document", info.documentTitle],
      ["Category", info.documentCategory],
      ["Signed by (typed name)", info.signedName],
      ["Driver account", info.driverName ? `${info.driverName} <${info.driverEmail}>` : info.driverEmail],
      ...timeFields(info.signedAt, info.ipAddress, info.userAgent),
    ],
    declaration: info.agreementText,
    verification: [
      `SHA-256 of the document as signed: ${info.documentSha256}`,
      `Document ID: ${info.documentId}`,
      `Signature reference: ${info.signatureId}`,
    ],
  });
}

export interface CountersignInfo {
  countersignatureId: string;
  driverSignatureId: string;
  documentTitle: string;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  driverSignedName: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  agreementText: string;
  /** SHA-256 of the driver-signed PDF this countersignature is applied to. */
  inputSha256: string;
}

/** MLC countersignature: a second certificate page after the driver's. */
export async function appendCountersignCertificate(
  driverSignedPdf: Uint8Array,
  signaturePng: Uint8Array,
  info: CountersignInfo,
): Promise<Uint8Array> {
  return appendCertificatePage(driverSignedPdf, signaturePng, {
    heading: "Countersignature Certificate",
    fields: [
      ["Document", info.documentTitle],
      ["Signed for MLC Transport Ltd by", `${info.signerName}, ${info.signerTitle}`],
      ["Signing account", info.signerEmail],
      ["Countersigns the signature of", info.driverSignedName],
      ...timeFields(info.signedAt, info.ipAddress, info.userAgent),
    ],
    declaration: info.agreementText,
    verification: [
      `SHA-256 of the driver-signed document: ${info.inputSha256}`,
      `Driver signature reference: ${info.driverSignatureId}`,
      `Countersignature reference: ${info.countersignatureId}`,
    ],
  });
}

/**
 * Schedule of Particulars page for a per-driver document (e.g. the employment
 * contract): the driver's confirmed name and address plus the dates MLC set.
 * Added before the signature certificate so the signature covers it.
 */
export async function appendParticularsSchedule(
  pdf: Uint8Array,
  documentTitle: string,
  p: { legalName: string; address: string; startDate: string; continuousEmploymentDate: string },
): Promise<Uint8Array> {
  return appendCertificatePage(pdf, null, {
    heading: "Schedule of Particulars",
    intro:
      `This schedule forms part of "${documentTitle}" and completes the details referred to in it. ` +
      "The employee confirmed their name and address when signing; MLC Transport Ltd set the dates.",
    fields: [
      ["Employer", "MLC Transport Ltd"],
      ["Employee full legal name", p.legalName],
      ["Employee home address", p.address],
      ["Start date", ukDate(p.startDate)],
      ["Continuous employment date", ukDate(p.continuousEmploymentDate)],
    ],
  });
}

export { ukDate };
