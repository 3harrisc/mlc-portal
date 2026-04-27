import { describe, it, expect } from "vitest";
import { groupRuns, groupKeyFor } from "./group-runs";
import type { InvoiceableRun } from "@/types/invoicing";

function run(partial: Partial<InvoiceableRun>): InvoiceableRun {
  return {
    id: partial.id ?? "id-" + Math.random().toString(36).slice(2),
    date: partial.date ?? "2025-09-22",
    customer: partial.customer ?? "MONTPELLIER",
    loadRef: partial.loadRef ?? "",
    description: partial.description ?? "",
    amount: partial.amount ?? 100,
  };
}

describe("groupKeyFor", () => {
  const noGroup = new Set(["ashwood"]);

  it("Ashwood always gets its own key (per-row)", () => {
    const a = run({ id: "a", customer: "ASHWOOD", loadRef: "Z37-10" });
    const b = run({ id: "b", customer: "Ashwood", loadRef: "Z37-10" });
    expect(groupKeyFor(a, noGroup)).toBe("ASH|a");
    expect(groupKeyFor(b, noGroup)).toBe("ASH|b");
  });

  it("non-empty LoadRef groups by (customer, ref)", () => {
    const a = run({ customer: "MONTPELLIER", loadRef: "Z38-05" });
    expect(groupKeyFor(a, noGroup)).toBe("REF|montpellier|z38 05");
  });

  it("LoadRef of '0' is treated as empty", () => {
    const a = run({ customer: "CONSOLID8", loadRef: "0", date: "2025-09-22" });
    expect(groupKeyFor(a, noGroup)).toBe("WK|consolid8|2025-W39");
  });

  it("empty LoadRef falls back to weekly grouping", () => {
    const a = run({ customer: "CONSOLID8", loadRef: "", date: "2025-09-22" });
    expect(groupKeyFor(a, noGroup)).toBe("WK|consolid8|2025-W39");
  });
});

describe("groupRuns", () => {
  it("combines all weekly runs for one customer with no LoadRef into one invoice", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-22" }),
      run({ id: "2", customer: "CONSOLID8", date: "2025-09-23" }),
      run({ id: "3", customer: "CONSOLID8", date: "2025-09-25" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(3);
    expect(groups[0].invoiceDate).toBe("2025-09-25");
    expect(groups[0].isoWeek).toBe(39);
    expect(groups[0].isoYear).toBe(2025);
  });

  it("splits weekly groups across ISO weeks", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", date: "2025-09-26" }), // W39
      run({ id: "2", customer: "CONSOLID8", date: "2025-09-29" }), // W40
    ]);
    expect(groups).toHaveLength(2);
    const weeks = groups.map((g) => g.isoWeek).sort();
    expect(weeks).toEqual([39, 40]);
  });

  it("groups by LoadRef regardless of week", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "CONSOLID8", loadRef: "Z38-05", date: "2025-09-22" }),
      run({ id: "2", customer: "CONSOLID8", loadRef: "Z38-05", date: "2025-10-06" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(2);
  });

  it("never combines Ashwood lines", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "ASHWOOD", loadRef: "Z37-10", date: "2025-09-22" }),
      run({ id: "2", customer: "ASHWOOD", loadRef: "Z37-10", date: "2025-09-22" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.lines.length === 1)).toBe(true);
  });

  it("normalises customer for grouping (case + whitespace insensitive)", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "Montpellier", date: "2025-09-22" }),
      run({ id: "2", customer: "MONTPELLIER", date: "2025-09-23" }),
      run({ id: "3", customer: "  montpellier  ", date: "2025-09-24" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(3);
  });

  it("orders lines within a group by (date, id) so CSV output is stable", () => {
    const groups = groupRuns([
      run({ id: "z", customer: "CONSOLID8", date: "2025-09-25" }),
      run({ id: "a", customer: "CONSOLID8", date: "2025-09-22" }),
      run({ id: "m", customer: "CONSOLID8", date: "2025-09-22" }),
    ]);
    expect(groups[0].lines.map((l) => l.id)).toEqual(["a", "m", "z"]);
  });

  it("orders groups alphabetically by customer name then key", () => {
    const groups = groupRuns([
      run({ id: "1", customer: "MONTPELLIER", date: "2025-09-22" }),
      run({ id: "2", customer: "ASHWOOD", date: "2025-09-22" }),
      run({ id: "3", customer: "CONSOLID8", date: "2025-09-22" }),
    ]);
    const customers = groups.map((g) => g.customer);
    expect(customers).toEqual(["ASHWOOD", "CONSOLID8", "MONTPELLIER"]);
  });

  it("is empty when no runs are provided", () => {
    expect(groupRuns([])).toEqual([]);
  });

  it("can override the no-grouping list", () => {
    const groups = groupRuns(
      [
        run({ id: "1", customer: "MONTPELLIER", date: "2025-09-22" }),
        run({ id: "2", customer: "MONTPELLIER", date: "2025-09-23" }),
      ],
      {
        config: {
          layout: "template",
          invoicePrefix: "INV-",
          defaultAccountCode: "200",
          defaultTaxType: "OUTPUT2",
          noGroupingCustomers: ["montpellier"],
        },
      }
    );
    expect(groups).toHaveLength(2);
  });
});
