import { describe, it, expect } from "vitest";
import {
  customerSortKey,
  compareByCustomer,
  compareRunsForPlanner,
  sortRunsForPlanner,
  PRIORITY_ORDER,
} from "./customer-order";
import type { PlannedRun } from "@/types/runs";

function run(p: Partial<PlannedRun>): PlannedRun {
  return {
    id: p.id ?? "id-" + Math.random().toString(36).slice(2),
    jobNumber: "",
    loadRef: "",
    date: "2025-09-22",
    customer: p.customer ?? "",
    vehicle: p.vehicle ?? "",
    fromPostcode: p.fromPostcode ?? "",
    toPostcode: p.toPostcode ?? "",
    returnToBase: true,
    startTime: p.startTime ?? "08:00",
    serviceMins: 25,
    includeBreaks: true,
    rawText: "",
    runType: p.runType ?? "regular",
    runOrder: p.runOrder ?? null,
  };
}

describe("customerSortKey", () => {
  it("assigns priority indexes from PRIORITY_ORDER", () => {
    expect(customerSortKey("CONSOLID8")[0]).toBe(0);
    expect(customerSortKey("CON001")[0]).toBe(0);          // alias
    expect(customerSortKey("ASHWOOD")[0]).toBe(1);
    expect(customerSortKey("MONTPELLIER")[0]).toBe(2);
    expect(customerSortKey("MON001")[0]).toBe(2);          // alias
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(customerSortKey("consolid8")[0]).toBe(0);
    expect(customerSortKey("  ASHWOOD  ")[0]).toBe(1);
    expect(customerSortKey("Montpellier")[0]).toBe(2);
  });

  it("falls back to a bucket beyond the priority list for unknowns", () => {
    expect(customerSortKey("KEEDWELL")[0]).toBe(PRIORITY_ORDER.length);
    expect(customerSortKey("STOBART")[0]).toBe(PRIORITY_ORDER.length);
  });
});

describe("compareByCustomer", () => {
  it("CONSOLID8 < ASHWOOD < MONTPELLIER", () => {
    expect(compareByCustomer("CONSOLID8", "ASHWOOD")).toBeLessThan(0);
    expect(compareByCustomer("ASHWOOD", "MONTPELLIER")).toBeLessThan(0);
    expect(compareByCustomer("CONSOLID8", "MONTPELLIER")).toBeLessThan(0);
  });

  it("treats aliases (CON001 ↔ CONSOLID8) as same priority", () => {
    expect(compareByCustomer("CON001", "CONSOLID8")).not.toBe(0); // tie-broken by name
    // But both come before ASHWOOD
    expect(compareByCustomer("CON001", "ASHWOOD")).toBeLessThan(0);
    expect(compareByCustomer("CONSOLID8", "ASHWOOD")).toBeLessThan(0);
  });

  it("priority customers come before non-priority customers", () => {
    expect(compareByCustomer("MONTPELLIER", "KEEDWELL")).toBeLessThan(0);
    expect(compareByCustomer("KEEDWELL", "MONTPELLIER")).toBeGreaterThan(0);
  });

  it("non-priority customers sort alphabetically among themselves", () => {
    expect(compareByCustomer("KEEDWELL", "STOBART")).toBeLessThan(0);
    expect(compareByCustomer("ZEBRA", "ALPHA")).toBeGreaterThan(0);
  });
});

describe("sortRunsForPlanner", () => {
  it("places priority customers at the top in the right order", () => {
    const sorted = sortRunsForPlanner([
      run({ id: "a", customer: "STOBART" }),
      run({ id: "b", customer: "MONTPELLIER" }),
      run({ id: "c", customer: "ASHWOOD" }),
      run({ id: "d", customer: "CONSOLID8" }),
      run({ id: "e", customer: "KEEDWELL" }),
    ]);
    expect(sorted.map((r) => r.customer)).toEqual([
      "CONSOLID8",
      "ASHWOOD",
      "MONTPELLIER",
      "KEEDWELL",
      "STOBART",
    ]);
  });

  it("groups CON001 with CONSOLID8", () => {
    const sorted = sortRunsForPlanner([
      run({ id: "a", customer: "ASHWOOD" }),
      run({ id: "b", customer: "CON001" }),
      run({ id: "c", customer: "CONSOLID8" }),
    ]);
    expect(sorted.map((r) => r.customer).slice(0, 2).sort()).toEqual(["CON001", "CONSOLID8"]);
    expect(sorted[2].customer).toBe("ASHWOOD");
  });

  it("within the same customer, sorts by vehicle then runOrder then startTime", () => {
    const sorted = sortRunsForPlanner([
      run({ id: "a", customer: "CONSOLID8", vehicle: "C12MLC", startTime: "10:00" }),
      run({ id: "b", customer: "CONSOLID8", vehicle: "B7MLC",  startTime: "12:00" }),
      run({ id: "c", customer: "CONSOLID8", vehicle: "B7MLC",  runOrder: 1, startTime: "08:00" }),
    ]);
    // B7MLC comes before C12MLC; within B7MLC the runOrder=1 row beats startTime=12:00.
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("returns a new array (no mutation)", () => {
    const orig = [run({ customer: "STOBART" }), run({ customer: "CONSOLID8" })];
    const out = sortRunsForPlanner(orig);
    expect(out).not.toBe(orig);
    expect(orig[0].customer).toBe("STOBART");
  });

  it("handles empty / one-element input", () => {
    expect(sortRunsForPlanner([])).toEqual([]);
    const one = [run({ customer: "ASHWOOD" })];
    expect(sortRunsForPlanner(one)).toHaveLength(1);
  });
});

describe("compareRunsForPlanner", () => {
  it("manual runOrder takes precedence over customer priority", () => {
    // STOBART is non-priority but has runOrder=1; MONTPELLIER has runOrder=99.
    // After the change, the row the operator dragged (lower runOrder) wins.
    const a = run({ customer: "STOBART", vehicle: "AAA", runOrder: 1 });
    const b = run({ customer: "MONTPELLIER", vehicle: "ZZZ", runOrder: 99 });
    expect(compareRunsForPlanner(a, b)).toBeLessThan(0);
  });

  it("customer priority is the tiebreaker when neither row has runOrder", () => {
    const a = run({ customer: "STOBART" });
    const b = run({ customer: "MONTPELLIER" });
    // No runOrder set on either → both treated as +Infinity → fall through to
    // customer priority, where MONTPELLIER (bucket 2) beats STOBART (bucket 3).
    expect(compareRunsForPlanner(b, a)).toBeLessThan(0);
  });

  it("rows with runOrder come before rows without", () => {
    const a = run({ customer: "ASHWOOD", runOrder: 0 });
    const b = run({ customer: "CONSOLID8" }); // no runOrder
    expect(compareRunsForPlanner(a, b)).toBeLessThan(0);
  });
});
