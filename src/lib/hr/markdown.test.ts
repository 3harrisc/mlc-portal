import { describe, expect, it } from "vitest";
import { openPlaceholders, parseMarkdown, stripInline, titleFromMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings, paragraphs and lists", () => {
    const md = [
      "# Winter Driving Toolbox Talk",
      "",
      "Version 1",
      "",
      "## Before You Set Off",
      "Check the forecast",
      "and your route.",
      "- Clear **all** snow from the roof",
      "* Check washer fluid",
      "1. Stop",
      "2) Call the office",
      "---",
    ].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { type: "h1", text: "Winter Driving Toolbox Talk" },
      { type: "p", text: "Version 1" },
      { type: "h2", text: "Before You Set Off" },
      { type: "p", text: "Check the forecast and your route." },
      { type: "li", text: "Clear all snow from the roof", marker: "•" },
      { type: "li", text: "Check washer fluid", marker: "•" },
      { type: "li", text: "Stop", marker: "1." },
      { type: "li", text: "Call the office", marker: "2." },
      { type: "hr" },
    ]);
  });

  it("caps deep headings at h3 and flattens tables", () => {
    expect(parseMarkdown("#### Deep\n| A | B |\n|---|---|\n| 1 | 2 |")).toEqual([
      { type: "h3", text: "Deep" },
      { type: "p", text: "A  ·  B" },
      { type: "p", text: "1  ·  2" },
    ]);
  });
});

describe("stripInline", () => {
  it("removes formatting but keeps link targets", () => {
    expect(stripInline("See **ACAS** and *the* [Code](https://acas.org.uk) `now`")).toBe(
      "See ACAS and the Code (https://acas.org.uk) now",
    );
  });

  it("leaves arithmetic and lone asterisks alone", () => {
    expect(stripInline("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});

describe("titles and placeholders", () => {
  it("finds the first h1 and any gaps", () => {
    const md = "Intro\n# Drug And Alcohol Policy\nTest by [TO COMPLETE: provider name] and [TO COMPLETE: date].";
    expect(titleFromMarkdown(md)).toBe("Drug And Alcohol Policy");
    expect(openPlaceholders(md)).toEqual(["[TO COMPLETE: provider name]", "[TO COMPLETE: date]"]);
    expect(titleFromMarkdown("no heading")).toBeNull();
  });
});
