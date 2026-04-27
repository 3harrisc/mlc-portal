import { describe, it, expect } from "vitest";
import { normaliseKey, scrubCompanyKey, resolveCustomer } from "./resolve-customer";
import type { CustomerXeroMap } from "@/types/invoicing";

const map: ReadonlyArray<CustomerXeroMap> = [
  { id: "1", plannerName: "default",     accountCode: "200", taxType: "OUTPUT2", dueDays: 30 },
  { id: "2", plannerName: "MONTPELLIER", xeroContactName: "Montpellier Holdings Ltd",
    accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
  { id: "3", plannerName: "CONSOLID8",   accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
  { id: "4", plannerName: "COTTESWOLD",  accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
  { id: "5", plannerName: "ASHWOOD",     xeroContactName: "Ashwood Logistics Ltd",
    accountCode: "200", taxType: "OUTPUT2", dueDays: 14 },
];

describe("normaliseKey", () => {
  it("lowercases and trims", () => {
    expect(normaliseKey("  Montpellier  ")).toBe("montpellier");
  });

  it("collapses repeated whitespace", () => {
    expect(normaliseKey("Cotteswold   Foods")).toBe("cotteswold foods");
  });

  it("replaces NBSP with space", () => {
    expect(normaliseKey("Cotteswold Foods")).toBe("cotteswold foods");
  });

  it("replaces underscores and hyphens with space", () => {
    expect(normaliseKey("Brakes_Newark-North")).toBe("brakes newark north");
  });
});

describe("scrubCompanyKey", () => {
  it("strips Ltd / Limited", () => {
    expect(scrubCompanyKey("Montpellier Ltd")).toBe("montpellier");
    expect(scrubCompanyKey("Montpellier Limited")).toBe("montpellier");
  });

  it("strips parenthetical noise", () => {
    expect(scrubCompanyKey("Montpellier (UK) Ltd")).toBe("montpellier");
  });

  it("strips Group / Holdings / Company / Co / The", () => {
    expect(scrubCompanyKey("The Cotteswold Group")).toBe("cotteswold");
    expect(scrubCompanyKey("Cotteswold Holdings Co")).toBe("cotteswold");
  });

  it("strips slashes / ampersands / commas / dots / apostrophes", () => {
    expect(scrubCompanyKey("Smith & Sons, Ltd.")).toBe("smith sons");
    expect(scrubCompanyKey("O'Reilly's")).toBe("o reilly s");
  });

  it("does NOT remove substrings that happen to contain filler words", () => {
    // " co " is a filler — but "cotteswold" must not be reduced to "tteswold".
    expect(scrubCompanyKey("Cotteswold")).toBe("cotteswold");
  });
});

describe("resolveCustomer", () => {
  it("tier 1: exact match", () => {
    const r = resolveCustomer("MONTPELLIER", map);
    expect(r.matchTier).toBe("exact");
    expect(r.entry.id).toBe("2");
    expect(r.xeroContactName).toBe("Montpellier Holdings Ltd");
  });

  it("tier 1: case-insensitive exact", () => {
    const r = resolveCustomer("montpellier", map);
    expect(r.matchTier).toBe("exact");
    expect(r.entry.id).toBe("2");
  });

  it("tier 2: scrubbed match (Ltd suffix)", () => {
    const r = resolveCustomer("Montpellier Ltd", map);
    expect(r.matchTier).toBe("scrubbed");
    expect(r.entry.id).toBe("2");
  });

  it("tier 2: scrubbed match (UK + Limited)", () => {
    const r = resolveCustomer("Montpellier (UK) Limited", map);
    expect(r.matchTier).toBe("scrubbed");
    expect(r.entry.id).toBe("2");
  });

  it("tier 3: substring match when scrubbed input still contains a key", () => {
    // "Montpellier Manchester Branch" scrubs to "montpellier manchester branch"
    // — not itself a key, but key "montpellier" is a substring.
    const r = resolveCustomer("Montpellier Manchester Branch", map);
    expect(r.matchTier).toBe("substring");
    expect(r.entry.id).toBe("2");
  });

  it("tier 3: longest matching key wins", () => {
    const denseMap: ReadonlyArray<CustomerXeroMap> = [
      ...map,
      { id: "long", plannerName: "MONTPELLIER NORTH WEST", accountCode: "400", taxType: "OUTPUT2", dueDays: 14 },
    ];
    const r = resolveCustomer("Montpellier North West Branch", denseMap);
    // Should pick the longer key ("montpellier north west", 22 chars), not
    // "montpellier" (11 chars).
    expect(r.matchTier).toBe("substring");
    expect(r.entry.id).toBe("long");
  });

  it("tier 4: falls back to default for unknown planner names", () => {
    const r = resolveCustomer("Brand New Customer", map);
    expect(r.matchTier).toBe("default");
    expect(r.entry.plannerName).toBe("default");
    // Default has no xeroContactName, so we use the planner-side name verbatim.
    expect(r.xeroContactName).toBe("Brand New Customer");
  });

  it("falls back to plannerName when entry has no xeroContactName", () => {
    const r = resolveCustomer("CONSOLID8", map);
    expect(r.matchTier).toBe("exact");
    expect(r.xeroContactName).toBe("CONSOLID8");
  });

  it("throws if the default row is missing", () => {
    const broken: ReadonlyArray<CustomerXeroMap> = [
      { id: "2", plannerName: "MONTPELLIER", accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
    ];
    expect(() => resolveCustomer("anything", broken)).toThrow(/default/);
  });

  it("treats apostrophes / commas as whitespace via scrubbing", () => {
    const m: ReadonlyArray<CustomerXeroMap> = [
      ...map,
      { id: "smith", plannerName: "smith sons", accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
    ];
    const r = resolveCustomer("Smith & Sons, Ltd.", m);
    expect(r.matchTier).toBe("scrubbed");
    expect(r.entry.id).toBe("smith");
  });
});
