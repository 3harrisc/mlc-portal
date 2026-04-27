import { describe, it, expect } from "vitest";
import { sanitizeForCsv, csvQuote, formatCsvAmount } from "./sanitize";

describe("sanitizeForCsv", () => {
  it("replaces smart double quotes with straight quotes", () => {
    expect(sanitizeForCsv("“Hello”")).toBe('"Hello"');
  });

  it("replaces smart single quotes with apostrophes", () => {
    expect(sanitizeForCsv("It’s fine")).toBe("It's fine");
  });

  it("replaces en-dash and em-dash with hyphen", () => {
    expect(sanitizeForCsv("Mon–Fri")).toBe("Mon-Fri");
    expect(sanitizeForCsv("Mon—Fri")).toBe("Mon-Fri");
  });

  it("replaces arrows with ASCII forms", () => {
    expect(sanitizeForCsv("NEWARK → TAMWORTH")).toBe("NEWARK -> TAMWORTH");
    expect(sanitizeForCsv("A ← B")).toBe("A <- B");
    expect(sanitizeForCsv("A ↔ B")).toBe("A <-> B");
  });

  it("replaces NBSP with regular space", () => {
    expect(sanitizeForCsv("Hello World")).toBe("Hello World");
  });

  it("strips characters outside printable ASCII 32-126", () => {
    expect(sanitizeForCsv("plaintext")).toBe("plaintext");
    expect(sanitizeForCsv("emoji 🚚 truck")).toBe("emoji  truck");
  });

  it("preserves printable ASCII as-is", () => {
    expect(sanitizeForCsv("Plain text 123 !?@#$%^&*()_+-=")).toBe(
      "Plain text 123 !?@#$%^&*()_+-="
    );
  });

  it("handles empty / nullish input safely", () => {
    expect(sanitizeForCsv("")).toBe("");
    // @ts-expect-error — runtime defence
    expect(sanitizeForCsv(undefined)).toBe("");
  });
});

describe("csvQuote", () => {
  it("wraps in double quotes", () => {
    expect(csvQuote("hello")).toBe('"hello"');
  });

  it("doubles embedded double-quotes", () => {
    expect(csvQuote('she said "ok"')).toBe('"she said ""ok"""');
  });

  it("sanitises before quoting", () => {
    expect(csvQuote("“hi”")).toBe('"""hi"""');
  });
});

describe("formatCsvAmount", () => {
  it("always shows two decimal places", () => {
    expect(formatCsvAmount(250)).toBe("250.00");
    expect(formatCsvAmount(250.5)).toBe("250.50");
    expect(formatCsvAmount(1234.56)).toBe("1234.56");
  });

  it("uses a dot regardless of locale", () => {
    // toFixed is locale-independent in JS, but assert anyway.
    expect(formatCsvAmount(0.1 + 0.2)).toBe("0.30");
  });

  it("returns 0.00 for non-finite numbers", () => {
    expect(formatCsvAmount(NaN)).toBe("0.00");
    expect(formatCsvAmount(Infinity)).toBe("0.00");
  });

  it("handles negative numbers", () => {
    expect(formatCsvAmount(-12.5)).toBe("-12.50");
  });
});
