import { describe, it, expect } from "vitest";
import {
  aggregateWeek,
  sumDriverWages,
  sumExtras,
  sumVehicleCosts,
  weekdayKeyForDate,
} from "./aggregate";
import type { PlannedRun } from "@/types/runs";
import type { WeeklyExtras, WeeklyVehicleCost } from "@/types/figures";
import { emptyWeeklyExtras, emptyWeeklyVehicleCost } from "@/types/figures";

function run(p: Partial<PlannedRun>): PlannedRun {
  return {
    id: p.id ?? "id-" + Math.random().toString(36).slice(2),
    jobNumber: p.jobNumber ?? "MLC-X-1",
    loadRef: p.loadRef ?? "",
    date: p.date ?? "2025-09-22",
    customer: p.customer ?? "CONSOLID8",
    vehicle: p.vehicle ?? "C12MLC",
    fromPostcode: p.fromPostcode ?? "NEWARK",
    toPostcode: p.toPostcode ?? "TAMWORTH",
    returnToBase: p.returnToBase ?? true,
    startTime: p.startTime ?? "08:00",
    serviceMins: p.serviceMins ?? 25,
    includeBreaks: p.includeBreaks ?? true,
    rawText: p.rawText ?? "",
    runType: p.runType ?? "regular",
    runOrder: p.runOrder ?? null,
    revenue: p.revenue ?? 0,
  };
}

describe("weekdayKeyForDate", () => {
  it("maps to Monday for 2025-09-22", () => {
    expect(weekdayKeyForDate("2025-09-22")).toBe("mon");
  });

  it("maps to Sunday for 2025-09-28", () => {
    expect(weekdayKeyForDate("2025-09-28")).toBe("sun");
  });

  it("maps to Friday for 2025-09-26", () => {
    expect(weekdayKeyForDate("2025-09-26")).toBe("fri");
  });
});

describe("sumVehicleCosts", () => {
  it("sums all the cost columns in £ (excluding tolls_euro)", () => {
    const c: WeeklyVehicleCost = {
      ...emptyWeeklyVehicleCost(2025, 39, "C12MLC"),
      runningCost: 1000,
      fuelUkAmount: 500,
      fuelLuxAmount: 200,
      tollsEuro: 50, // explicitly excluded
      tollsGbp: 25,
      parking: 10,
      adblue: 20,
      otherCost: 5,
    };
    // 1000 + 500 + 200 + 25 + 10 + 20 + 5 = 1760
    expect(sumVehicleCosts(c)).toBe(1760);
  });
});

describe("sumDriverWages", () => {
  it("sums all numeric values, ignoring junk", () => {
    expect(sumDriverWages({ Aussie: 900, Roger: 500, Fred: 0 })).toBe(1400);
  });

  it("returns 0 for empty", () => {
    expect(sumDriverWages({})).toBe(0);
  });

  it("ignores non-finite or non-number values", () => {
    expect(
      sumDriverWages({ a: NaN, b: Infinity, c: 5 } as Record<string, number>)
    ).toBe(5);
  });
});

describe("sumExtras", () => {
  it("sums office + vans + bbl + subbyCost + driverWages", () => {
    const e: WeeklyExtras = {
      ...emptyWeeklyExtras(2025, 39),
      office: 1550,
      vans: 1068,
      bbl: 205,
      subbyCost: 0,
      driverWages: { CallumH: 900 },
    };
    expect(sumExtras(e)).toBe(1550 + 1068 + 205 + 0 + 900);
  });
});

describe("aggregateWeek", () => {
  const extras: WeeklyExtras = {
    ...emptyWeeklyExtras(2025, 39),
    office: 1550,
    vans: 1068,
    bbl: 205,
    driverWages: { CallumH: 900 },
  };

  it("derives an earnings matrix and totals from runs.revenue", () => {
    const a = aggregateWeek({
      runs: [
        run({ vehicle: "C12MLC", date: "2025-09-22", revenue: 250 }),
        run({ vehicle: "C12MLC", date: "2025-09-22", revenue: 250 }),
        run({ vehicle: "C12MLC", date: "2025-09-23", revenue: 1100 }),
        run({ vehicle: "B7MLC",  date: "2025-09-22", revenue: 350 }),
      ],
      vehicleCosts: [],
      extras,
    });
    // Two vehicles, sorted alphabetically: B7MLC, C12MLC.
    expect(a.earningsByVehicle.map((e) => e.vehicle)).toEqual(["B7MLC", "C12MLC"]);
    const c12 = a.earningsByVehicle[1];
    expect(c12.byDay.mon).toBe(500);
    expect(c12.byDay.tue).toBe(1100);
    expect(c12.total).toBe(1600);
    expect(a.totalsByDay.mon).toBe(850); // 250+250+350
    expect(a.totalsByDay.tue).toBe(1100);
    expect(a.grossEarnings).toBe(1950);
  });

  it("computes profit/loss = earnings − costs per vehicle", () => {
    const c12cost: WeeklyVehicleCost = {
      ...emptyWeeklyVehicleCost(2025, 39, "C12MLC"),
      runningCost: 1000,
      fuelUkAmount: 200,
    };
    const a = aggregateWeek({
      runs: [run({ vehicle: "C12MLC", date: "2025-09-22", revenue: 1500 })],
      vehicleCosts: [c12cost],
      extras,
    });
    const c12 = a.profitLossByVehicle.find((p) => p.vehicle === "C12MLC")!;
    expect(c12.earnings).toBe(1500);
    expect(c12.costs).toBe(1200);
    expect(c12.profitLoss).toBe(300);
  });

  it("includes vehicles that have costs but no runs", () => {
    const c: WeeklyVehicleCost = {
      ...emptyWeeklyVehicleCost(2025, 39, "B14MLC"),
      runningCost: 800,
    };
    const a = aggregateWeek({
      runs: [],
      vehicleCosts: [c],
      extras,
    });
    const b14 = a.profitLossByVehicle.find((p) => p.vehicle === "B14MLC")!;
    expect(b14.earnings).toBe(0);
    expect(b14.costs).toBe(800);
    expect(b14.profitLoss).toBe(-800);
  });

  it("includes vehicles that have runs but no costs", () => {
    const a = aggregateWeek({
      runs: [run({ vehicle: "D2MLC", date: "2025-09-22", revenue: 600 })],
      vehicleCosts: [],
      extras,
    });
    const d2 = a.profitLossByVehicle.find((p) => p.vehicle === "D2MLC")!;
    expect(d2.earnings).toBe(600);
    expect(d2.costs).toBe(0);
    expect(d2.profitLoss).toBe(600);
  });

  it("computes total profit/loss = gross − vehicle costs − extras", () => {
    const c: WeeklyVehicleCost = {
      ...emptyWeeklyVehicleCost(2025, 39, "C12MLC"),
      runningCost: 1000,
    };
    const a = aggregateWeek({
      runs: [run({ vehicle: "C12MLC", date: "2025-09-22", revenue: 5000 })],
      vehicleCosts: [c],
      extras,
    });
    expect(a.grossEarnings).toBe(5000);
    expect(a.totalVehicleCosts).toBe(1000);
    expect(a.totalExtras).toBe(1550 + 1068 + 205 + 900); // 3723
    expect(a.totalProfitLoss).toBe(5000 - 1000 - 3723);
  });

  it("ignores runs with empty vehicle", () => {
    const a = aggregateWeek({
      runs: [
        run({ vehicle: "", date: "2025-09-22", revenue: 100 }),
        run({ vehicle: "C12MLC", date: "2025-09-22", revenue: 200 }),
      ],
      vehicleCosts: [],
      extras,
    });
    expect(a.grossEarnings).toBe(200); // unassigned excluded
    expect(a.earningsByVehicle).toHaveLength(1);
  });

  it("respects an explicit `vehicles` whitelist", () => {
    const a = aggregateWeek({
      runs: [
        run({ vehicle: "C12MLC", date: "2025-09-22", revenue: 100 }),
        run({ vehicle: "ZZZZ",   date: "2025-09-22", revenue: 999 }),
      ],
      vehicleCosts: [],
      extras,
      vehicles: ["C12MLC"],
    });
    // ZZZZ runs are scoped out of the matrix even though they exist in `runs`.
    expect(a.earningsByVehicle.map((e) => e.vehicle)).toEqual(["C12MLC"]);
    expect(a.grossEarnings).toBe(100);
  });

  it("exposes total driver wages as its own field", () => {
    const a = aggregateWeek({ runs: [], vehicleCosts: [], extras });
    expect(a.totalDriverWages).toBe(900);
  });
});
