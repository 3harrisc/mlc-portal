import { describe, it, expect } from "vitest";
import { buildXeroCsv, buildPrefixedDescription } from "./build-csv";
import { groupRuns } from "./group-runs";
import { DEFAULT_XERO_CONFIG } from "@/types/invoicing";
import type { CustomerXeroMap, InvoiceableRun } from "@/types/invoicing";

const map: ReadonlyArray<CustomerXeroMap> = [
  { id: "1", plannerName: "default",     accountCode: "200", taxType: "OUTPUT2", dueDays: 30 },
  { id: "2", plannerName: "MONTPELLIER", xeroContactName: "Montpellier Holdings Ltd",
    accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
  { id: "3", plannerName: "CONSOLID8",   accountCode: "400", taxType: "OUTPUT2", dueDays: 30 },
  { id: "4", plannerName: "ASHWOOD",     xeroContactName: "Ashwood Logistics Ltd",
    accountCode: "200", taxType: "OUTPUT2", dueDays: 14 },
];

function run(p: Partial<InvoiceableRun>): InvoiceableRun {
  return {
    id: p.id ?? "id-" + Math.random().toString(36).slice(2),
    date: p.date ?? "2025-09-22",
    customer: p.customer ?? "MONTPELLIER",
    loadRef: p.loadRef ?? "",
    description: p.description ?? "",
    amount: p.amount ?? 100,
  };
}

describe("buildPrefixedDescription", () => {
  it("prefixes with dd/MM/yyyy", () => {
    expect(buildPrefixedDescription("CFS Glasgow", "2025-09-22")).toBe(
      "22/09/2025 - CFS Glasgow"
    );
  });

  it("returns date alone when description is empty", () => {
    expect(buildPrefixedDescription("", "2025-09-22")).toBe("22/09/2025");
  });

  it("trims whitespace from description", () => {
    expect(buildPrefixedDescription("  hi  ", "2025-09-22")).toBe(
      "22/09/2025 - hi"
    );
  });
});

describe("buildXeroCsv (lite layout)", () => {
  const liteConfig = { ...DEFAULT_XERO_CONFIG, layout: "lite" as const };

  it("emits header + one row per line", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22", amount: 250, description: "NEWARK -> TAMWORTH" }),
    ]);
    const { csv } = buildXeroCsv({
      groups,
      customerMap: map,
      startInvoiceNumber: 99450,
      config: liteConfig,
    });
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType"
    );
    expect(lines[1]).toContain('"CONSOLID8"');
    expect(lines[1]).toContain('"INV-99450"');
    expect(lines[1]).toContain("22/09/2025");
    expect(lines[1]).toContain(",250.00,");
    expect(lines[1]).toContain(",400,");
    expect(lines[1]).toContain(",OUTPUT2");
  });

  it("uses the resolved Xero contact name when one is configured", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "MONTPELLIER", date: "2025-09-22", amount: 1280 }),
    ]);
    const { csv } = buildXeroCsv({ groups, customerMap: map, startInvoiceNumber: 99450, config: liteConfig });
    expect(csv).toContain('"Montpellier Holdings Ltd"');
  });

  it("emits the ISO-week reference when no LoadRef is set", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22", amount: 250 }),
    ]);
    const { csv } = buildXeroCsv({ groups, customerMap: map, startInvoiceNumber: 99450, config: liteConfig });
    expect(csv).toContain('"Week 39 (2025)"');
  });

  it("uses the line's LoadRef when present", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", loadRef: "Z38-05", date: "2025-09-22", amount: 250 }),
    ]);
    const { csv } = buildXeroCsv({ groups, customerMap: map, startInvoiceNumber: 99450, config: liteConfig });
    expect(csv).toContain('"Z38-05"');
  });

  it("net-30-from-EOM: invoice 2025-09-22 → due 2025-10-30", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22", amount: 250 }),
    ]);
    const { csv } = buildXeroCsv({ groups, customerMap: map, startInvoiceNumber: 99450, config: liteConfig });
    expect(csv).toContain(",30/10/2025,");
  });

  it("issues sequential invoice numbers across multiple groups", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22", amount: 250 }),
      run({ id: "2", customer: "MONTPELLIER", date: "2025-09-22", amount: 1280 }),
    ]);
    const { csv, assignments } = buildXeroCsv({
      groups,
      customerMap: map,
      startInvoiceNumber: 99450,
      config: liteConfig,
    });
    expect(assignments.map((a) => a.invoiceNumber)).toEqual([
      "INV-99450",
      "INV-99451",
    ]);
    expect(csv).toContain("INV-99450");
    expect(csv).toContain("INV-99451");
  });

  it("emits one Ashwood row per leg (never combined)", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "ASHWOOD", date: "2025-09-22", amount: 800, loadRef: "Z37-10" }),
      run({ id: "2", customer: "ASHWOOD", date: "2025-09-22", amount: 850, loadRef: "Z37-10" }),
    ]);
    const { assignments } = buildXeroCsv({
      groups,
      customerMap: map,
      startInvoiceNumber: 99450,
      config: liteConfig,
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0].invoiceNumber).not.toBe(assignments[1].invoiceNumber);
  });

  it("combines a customer's lines into a single weekly invoice", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22", amount: 250 }),
      run({ id: "2", customer: "CONSOLID8", date: "2025-09-23", amount: 350 }),
      run({ id: "3", customer: "CONSOLID8", date: "2025-09-24", amount: 100 }),
    ]);
    const { csv, assignments } = buildXeroCsv({
      groups,
      customerMap: map,
      startInvoiceNumber: 99450,
      config: liteConfig,
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].invoiceNumber).toBe("INV-99450");
    expect(assignments[0].runIds).toEqual(["1", "2", "3"]);
    expect(assignments[0].totalAmount).toBe(700);
    // 3 line rows + header
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(4);
  });

  it("falls back to default account / tax for unknown customers", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "UNKNOWN CUSTOMER", date: "2025-09-22", amount: 100 }),
    ]);
    const { csv } = buildXeroCsv({ groups, customerMap: map, startInvoiceNumber: 99450, config: liteConfig });
    expect(csv).toContain(",200,");
    expect(csv).toContain(",OUTPUT2");
  });

  it("sanitises Unicode in the description field", () => {
    const groups = groupRuns([
      run({
        id: "1",
        customer: "CONSOLID8",
        date: "2025-09-22",
        amount: 100,
        description: "NEWARK → TAMWORTH",
      }),
    ]);
    const { csv } = buildXeroCsv({ groups, customerMap: map, startInvoiceNumber: 99450, config: liteConfig });
    expect(csv).toContain("NEWARK -> TAMWORTH");
    expect(csv).not.toContain("→");
  });

  it("returns just a header when no groups are passed", () => {
    const { csv, assignments } = buildXeroCsv({
      groups: [],
      customerMap: map,
      startInvoiceNumber: 99450,
      config: liteConfig,
    });
    expect(assignments).toEqual([]);
    expect(csv.split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("buildXeroCsv (template layout)", () => {
  it("emits the 29-column template header", () => {
    const { csv } = buildXeroCsv({
      groups: [],
      customerMap: map,
      startInvoiceNumber: 99450,
      config: { ...DEFAULT_XERO_CONFIG, layout: "template" },
    });
    expect(csv.startsWith("ContactName,EmailAddress,")).toBe(true);
    expect(csv.includes("Currency,BrandingTheme,Status")).toBe(true);
    // Verify column count.
    expect(csv.split("\n")[0].split(",")).toHaveLength(29);
  });

  it("emits 29 fields per data row in template layout", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22", amount: 250 }),
    ]);
    const { csv } = buildXeroCsv({
      groups,
      customerMap: map,
      startInvoiceNumber: 99450,
      config: { ...DEFAULT_XERO_CONFIG, layout: "template" },
    });
    const dataRow = csv.split("\n")[1];
    // Naive split is fine here because no field embeds a comma.
    expect(dataRow.split(",")).toHaveLength(29);
    expect(dataRow).toContain("GBP");
  });
});
