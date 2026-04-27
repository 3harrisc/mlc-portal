/**
 * Pure aggregator for the weekly Figures sheet.
 *
 * Inputs:
 *   - the week's runs (for revenue numbers)
 *   - per-vehicle weekly costs (running cost, fuel, tolls, parking, adblue, other)
 *   - weekly extras (office, vans, bbl, subby cost, driver wages)
 *
 * Outputs:
 *   - earnings table: vehicle × weekday matrix of revenue, with totals
 *   - per-vehicle running-cost subtotal
 *   - per-vehicle profit/loss = earnings − costs
 *   - week totals: gross earnings, total costs, total profit/loss
 *
 * No DB, no I/O. Fully tested in `aggregate.test.ts`.
 */

import type { PlannedRun } from "@/types/runs";
import type { WeeklyVehicleCost, WeeklyExtras, DriverWages } from "@/types/figures";

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const WEEKDAY_KEYS: ReadonlyArray<WeekdayKey> = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export interface VehicleEarnings {
  vehicle: string;
  byDay: Record<WeekdayKey, number>;
  total: number;
}

export interface VehicleProfitLoss {
  vehicle: string;
  earnings: number;
  costs: number;
  profitLoss: number;
}

export interface WeeklyAggregate {
  /** Earnings table: vehicle → daily breakdown + total. Sorted by vehicle name. */
  earningsByVehicle: ReadonlyArray<VehicleEarnings>;
  /** Total revenue per weekday across all vehicles (for the bottom-row total). */
  totalsByDay: Record<WeekdayKey, number>;
  /** Sum of all run revenue across all vehicles, all days. */
  grossEarnings: number;
  /** Per-vehicle profit/loss. Sorted by vehicle name. */
  profitLossByVehicle: ReadonlyArray<VehicleProfitLoss>;
  /** SUM(running_cost + fuel_uk_amount + fuel_lux_amount + tolls_gbp + parking + adblue + other_cost) across all vehicles. */
  totalVehicleCosts: number;
  /** SUM(office + vans + bbl + subby_cost + driver_wages.*). */
  totalExtras: number;
  /** grossEarnings − totalVehicleCosts − totalExtras. */
  totalProfitLoss: number;
  /** SUM(driver_wages.*) — exposed because the spreadsheet shows it as its own total. */
  totalDriverWages: number;
}

/**
 * weekdayKeyForDate("2025-09-22") => "mon"
 * Inputs are yyyy-MM-dd ISO strings; we parse as UTC to avoid TZ drift.
 */
export function weekdayKeyForDate(isoDate: string): WeekdayKey {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  // JS getUTCDay: 0 = Sunday, 1 = Monday, ... 6 = Saturday.
  const idx = dt.getUTCDay();
  return idx === 0 ? "sun" : WEEKDAY_KEYS[idx - 1];
}

/** Total of one vehicle-week's costs (sum of every cost column). */
export function sumVehicleCosts(c: WeeklyVehicleCost): number {
  return (
    c.runningCost +
    c.fuelUkAmount +
    c.fuelLuxAmount +
    // Tolls in EUR aren't summed in £ here — the spreadsheet keeps the two
    // currencies separate and reports the GBP equivalent at year-end.
    // For total-cost we use only `tolls_gbp`. Operators record EUR → GBP
    // conversions manually (or a future cron will).
    c.tollsGbp +
    c.parking +
    c.adblue +
    c.otherCost
  );
}

/** Sum of weekly_extras (office + vans + bbl + subby_cost + ALL driver_wages). */
export function sumExtras(e: WeeklyExtras): number {
  return e.office + e.vans + e.bbl + e.subbyCost + sumDriverWages(e.driverWages);
}

export function sumDriverWages(wages: DriverWages): number {
  let sum = 0;
  for (const v of Object.values(wages)) {
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

interface AggregateInput {
  runs: ReadonlyArray<PlannedRun>;
  vehicleCosts: ReadonlyArray<WeeklyVehicleCost>;
  extras: WeeklyExtras;
  /**
   * Vehicles to display in the output — used so vehicles with costs but no
   * runs (or vice versa) still show in the matrix. If omitted, the union of
   * `runs.vehicle` and `vehicleCosts.vehicle` is used.
   */
  vehicles?: ReadonlyArray<string>;
}

export function aggregateWeek(input: AggregateInput): WeeklyAggregate {
  const { runs, vehicleCosts, extras } = input;

  // Build the universe of vehicles.
  const vehicleSet = new Set<string>();
  if (input.vehicles) {
    for (const v of input.vehicles) if (v.trim()) vehicleSet.add(v.trim());
  } else {
    for (const r of runs) if (r.vehicle.trim()) vehicleSet.add(r.vehicle.trim());
    for (const c of vehicleCosts) if (c.vehicle.trim()) vehicleSet.add(c.vehicle.trim());
  }
  const vehicles = Array.from(vehicleSet).sort();

  // Index costs by vehicle.
  const costsByVehicle = new Map<string, WeeklyVehicleCost>();
  for (const c of vehicleCosts) costsByVehicle.set(c.vehicle.trim(), c);

  // Earnings matrix.
  const earningsByVehicle: VehicleEarnings[] = vehicles.map((v) => ({
    vehicle: v,
    byDay: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    total: 0,
  }));
  const earningsByVehicleMap = new Map(earningsByVehicle.map((e) => [e.vehicle, e]));

  for (const r of runs) {
    const v = r.vehicle?.trim();
    if (!v) continue;
    const entry = earningsByVehicleMap.get(v);
    if (!entry) continue; // unknown vehicle (should be impossible after the union above)
    const day = weekdayKeyForDate(r.date);
    const rev = r.revenue ?? 0;
    entry.byDay[day] += rev;
    entry.total += rev;
  }

  // Daily totals across all vehicles.
  const totalsByDay: Record<WeekdayKey, number> = {
    mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0,
  };
  let grossEarnings = 0;
  for (const e of earningsByVehicle) {
    for (const k of WEEKDAY_KEYS) totalsByDay[k] += e.byDay[k];
    grossEarnings += e.total;
  }

  // Per-vehicle profit/loss.
  const profitLossByVehicle: VehicleProfitLoss[] = vehicles.map((v) => {
    const earnings = earningsByVehicleMap.get(v)!.total;
    const cost = costsByVehicle.get(v) ? sumVehicleCosts(costsByVehicle.get(v)!) : 0;
    return { vehicle: v, earnings, costs: cost, profitLoss: earnings - cost };
  });

  const totalVehicleCosts = profitLossByVehicle.reduce((s, p) => s + p.costs, 0);
  const totalExtras = sumExtras(extras);
  const totalProfitLoss = grossEarnings - totalVehicleCosts - totalExtras;

  return {
    earningsByVehicle,
    totalsByDay,
    grossEarnings,
    profitLossByVehicle,
    totalVehicleCosts,
    totalExtras,
    totalProfitLoss,
    totalDriverWages: sumDriverWages(extras.driverWages),
  };
}
