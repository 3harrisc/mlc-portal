import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderMarkdownPdf } from "./markdown-pdf";
import { assertSignablePdf } from "./certificate";

describe("renderMarkdownPdf", () => {
  it("renders a short document on one signable page", async () => {
    const bytes = await renderMarkdownPdf("# Toolbox Talk\n\n## Points\n- One\n- Two\n\nŁukasz signs here.", "Toolbox Talk");
    expect(await assertSignablePdf(bytes)).toBe(1);
  });

  it("paginates long documents", async () => {
    const body = Array.from({ length: 120 }, (_, i) => `- Item ${i + 1}: ${"keep the load secure ".repeat(6)}`).join("\n");
    const bytes = await renderMarkdownPdf(`# Long Policy\n\n${body}`, "Long Policy");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });
});
