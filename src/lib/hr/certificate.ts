import { createHash } from "node:crypto";
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

/**
 * Append a signature certificate page to the original PDF. The original
 * pages are copied untouched; only a new final page is added.
 */
export async function appendSignatureCertificate(
  originalPdf: Uint8Array,
  signaturePng: Uint8Array,
  info: CertificateInfo,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalPdf);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sig = await pdf.embedPng(signaturePng);

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
  const field = (label: string, value: string) => {
    text(label.toUpperCase(), { size: 7.5, f: bold, color: muted });
    text(value, { size: 10.5, gap: 8 });
  };

  text("MLC TRANSPORT", { size: 9, f: bold, color: muted, gap: 2 });
  text("Electronic Signature Certificate", { size: 20, f: bold, gap: 6 });
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.75,
    color: rgb(0.85, 0.86, 0.88),
  });
  y -= 18;

  field("Document", info.documentTitle);
  field("Category", info.documentCategory);
  field("Signed by (typed name)", info.signedName);
  field("Driver account", info.driverName ? `${info.driverName} <${info.driverEmail}>` : info.driverEmail);
  field("Signed at (UK time)", ukTime(info.signedAt));
  field("Signed at (UTC)", info.signedAt.toISOString());
  field("IP address", info.ipAddress || "Not recorded");
  field("Device", info.userAgent || "Not recorded");

  text("DECLARATION", { size: 7.5, f: bold, color: muted });
  text(info.agreementText, { size: 10.5, gap: 12 });

  text("SIGNATURE", { size: 7.5, f: bold, color: muted, gap: 2 });
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

  text("VERIFICATION", { size: 7.5, f: bold, color: muted });
  text(`SHA-256 of the document as signed: ${info.documentSha256}`, { size: 8, color: muted });
  text(`Document ID: ${info.documentId}`, { size: 8, color: muted });
  text(`Signature reference: ${info.signatureId}`, { size: 8, color: muted });

  return pdf.save();
}
