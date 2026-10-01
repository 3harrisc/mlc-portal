import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfSafeText, wrap } from "./certificate";
import { parseMarkdown } from "./markdown";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const FOOTER = 28;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.86, 0.88);

/**
 * Render an approved HR-assistant draft (Markdown subset) as an MLC-styled A4
 * PDF: MLC header, the document's own headings and lists, and a footer with
 * the title and page numbers.
 */
export async function renderMarkdownPdf(markdown: string, title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("MLC Transport Ltd");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - MARGIN * 2;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN + FOOTER) newPage();
  };
  const lines = (text: string, f: PDFFont, size: number, w: number) => wrap(f, pdfSafeText(f, text), size, w);
  const draw = (text: string, f: PDFFont, size: number, opts: { x?: number; color?: typeof INK; after?: number; w?: number } = {}) => {
    const x = opts.x ?? MARGIN;
    for (const line of lines(text, f, size, opts.w ?? width - (x - MARGIN))) {
      ensure(size + 4);
      page.drawText(line, { x, y: y - size, size, font: f, color: opts.color ?? INK });
      y -= size + 4;
    }
    y -= opts.after ?? 0;
  };

  draw("MLC TRANSPORT", bold, 9, { color: MUTED, after: 2 });
  let skippedTitle = false;
  for (const b of parseMarkdown(markdown)) {
    switch (b.type) {
      case "h1":
        if (!skippedTitle && b.text === title) {
          skippedTitle = true;
          draw(b.text, bold, 20, { after: 4 });
          page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.75, color: RULE });
          y -= 14;
        } else {
          ensure(40);
          y -= 6;
          draw(b.text, bold, 16, { after: 6 });
        }
        break;
      case "h2":
        ensure(36);
        y -= 6;
        draw(b.text, bold, 13, { after: 4 });
        break;
      case "h3":
        ensure(30);
        y -= 2;
        draw(b.text, bold, 11, { after: 3 });
        break;
      case "p":
        draw(b.text, font, 10.5, { after: 6 });
        break;
      case "li": {
        ensure(15);
        const indent = 16;
        page.drawText(pdfSafeText(font, b.marker), { x: MARGIN + 2, y: y - 10.5, size: 10.5, font, color: INK });
        draw(b.text, font, 10.5, { x: MARGIN + indent, after: 3 });
        break;
      }
      case "hr":
        ensure(14);
        y -= 4;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.5, color: RULE });
        y -= 10;
        break;
    }
  }

  const pages = pdf.getPages();
  const label = pdfSafeText(font, `MLC Transport  ·  ${title}`);
  pages.forEach((p, i) => {
    const num = `Page ${i + 1} of ${pages.length}`;
    p.drawText(wrap(font, label, 8, width - 80)[0] ?? "", { x: MARGIN, y: MARGIN - 6, size: 8, font, color: MUTED });
    p.drawText(num, { x: MARGIN + width - font.widthOfTextAtSize(num, 8), y: MARGIN - 6, size: 8, font, color: MUTED });
  });
  return pdf.save();
}
