"use server";

import { createClient } from "@/lib/supabase/server";
import {
  rowToWeeklyExtras,
  rowToWeeklyVehicleCost,
  emptyWeeklyExtras,
  type WeeklyExtras,
  type WeeklyVehicleCost,
  type DriverWages,
} from "@/types/figures";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

async function requireAdmin() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admin role required");
  return { supabase, user };
}

/** Read all per-vehicle cost rows for a given week. */
export async function listVehicleCosts(
  year: number,
  week: number
): Promise<{ rows?: WeeklyVehicleCost[]; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("weekly_vehicle_costs")
    .select("*")
    .eq("iso_year", year)
    .eq("iso_week", week)
    .order("vehicle", { ascending: true });
  if (error) return { error: error.message };
  return { rows: (data ?? []).map(rowToWeeklyVehicleCost) };
}

/** Read the single weekly_extras row for a week. Returns empty if missing. */
export async function getWeeklyExtras(
  year: number,
  week: number
): Promise<{ extras?: WeeklyExtras; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("weekly_extras")
    .select("*")
    .eq("iso_year", year)
    .eq("iso_week", week)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { extras: emptyWeeklyExtras(year, week) };
  return { extras: rowToWeeklyExtras(data) };
}

/**
 * Upsert a single per-vehicle cost cell. Creates the row if missing.
 * Patch semantics: undefined = no change.
 */
export async function upsertVehicleCost(
  year: number,
  week: number,
  vehicle: string,
  fields: Partial<Omit<WeeklyVehicleCost, "isoYear" | "isoWeek" | "vehicle">>
) {
  const { supabase } = await requireAdmin();
  const v = vehicle.trim();
  if (!v) return { error: "vehicle is required" };

  // Build the partial update payload.
  const update: Record<string, unknown> = {
    iso_year: year,
    iso_week: week,
    vehicle: v,
    updated_at: new Date().toISOString(),
  };
  if (fields.runningCost !== undefined) update.running_cost = fields.runningCost;
  if (fields.fuelUkLitres !== undefined) update.fuel_uk_litres = fields.fuelUkLitres;
  if (fields.fuelUkAmount !== undefined) update.fuel_uk_amount = fields.fuelUkAmount;
  if (fields.fuelLuxLitres !== undefined) update.fuel_lux_litres = fields.fuelLuxLitres;
  if (fields.fuelLuxAmount !== undefined) update.fuel_lux_amount = fields.fuelLuxAmount;
  if (fields.tollsEuro !== undefined) update.tolls_euro = fields.tollsEuro;
  if (fields.tollsGbp !== undefined) update.tolls_gbp = fields.tollsGbp;
  if (fields.parking !== undefined) update.parking = fields.parking;
  if (fields.adblue !== undefined) update.adblue = fields.adblue;
  if (fields.otherCost !== undefined) update.other_cost = fields.otherCost;
  if (fields.notes !== undefined) update.notes = fields.notes;

  const { error } = await supabase
    .from("weekly_vehicle_costs")
    .upsert(update, { onConflict: "iso_year,iso_week,vehicle" });
  if (error) return { error: error.message };
  return { success: true };
}

/** Upsert (year, week) extras with arbitrary partial fields. */
export async function upsertWeeklyExtras(
  year: number,
  week: number,
  fields: Partial<Omit<WeeklyExtras, "isoYear" | "isoWeek">>
) {
  const { supabase } = await requireAdmin();
  const update: Record<string, unknown> = {
    iso_year: year,
    iso_week: week,
    updated_at: new Date().toISOString(),
  };
  if (fields.office !== undefined) update.office = fields.office;
  if (fields.vans !== undefined) update.vans = fields.vans;
  if (fields.bbl !== undefined) update.bbl = fields.bbl;
  if (fields.subbyCost !== undefined) update.subby_cost = fields.subbyCost;
  if (fields.driverWages !== undefined) update.driver_wages = fields.driverWages;
  if (fields.notes !== undefined) update.notes = fields.notes;

  const { error } = await supabase
    .from("weekly_extras")
    .upsert(update, { onConflict: "iso_year,iso_week" });
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Carry forward each vehicle's `running_cost` (only) from the most recent
 * prior week into the target (year, week). Idempotent: skips vehicles that
 * already have a row for the target week.
 *
 * Why running_cost only? Fuel, tolls, AdBlue, parking are usage-based and
 * must be re-entered weekly. Running cost is the fixed lease/insurance/etc.
 * pot that very rarely changes — copying it forward saves the operator from
 * re-typing the same numbers every Monday.
 *
 * Returns the list of vehicles that were seeded and the source week we
 * pulled from (most recent prior week with any data).
 */
export async function carryForwardRunningCosts(
  year: number,
  week: number
): Promise<{
  seededVehicles?: string[];
  sourceLabel?: string;
  alreadySeeded?: boolean;
  error?: string;
}> {
  const { supabase } = await requireAdmin();

  // 1. Fetch every prior cost row (newest first). For 10 vehicles × N weeks
  //    this stays small — but if it ever grows, swap for a Postgres function.
  const { data: priorRows, error: priorErr } = await supabase
    .from("weekly_vehicle_costs")
    .select("vehicle, running_cost, iso_year, iso_week")
    .or(`iso_year.lt.${year},and(iso_year.eq.${year},iso_week.lt.${week})`)
    .order("iso_year", { ascending: false })
    .order("iso_week", { ascending: false });
  if (priorErr) return { error: priorErr.message };

  // Most recent running_cost per vehicle.
  const latestByVehicle = new Map<string, { runningCost: number; sourceYear: number; sourceWeek: number }>();
  for (const row of priorRows ?? []) {
    const v = (row as { vehicle: string }).vehicle;
    if (!latestByVehicle.has(v)) {
      latestByVehicle.set(v, {
        runningCost: Number((row as { running_cost: number | null }).running_cost ?? 0),
        sourceYear: (row as { iso_year: number }).iso_year,
        sourceWeek: (row as { iso_week: number }).iso_week,
      });
    }
  }
  if (latestByVehicle.size === 0) {
    return { seededVehicles: [], sourceLabel: undefined, alreadySeeded: false };
  }

  // 2. Find which vehicles already have a row for the target week.
  const { data: currentRows, error: curErr } = await supabase
    .from("weekly_vehicle_costs")
    .select("vehicle")
    .eq("iso_year", year)
    .eq("iso_week", week);
  if (curErr) return { error: curErr.message };
  const existing = new Set((currentRows ?? []).map((r) => (r as { vehicle: string }).vehicle));

  // 3. Build insert payload for missing vehicles.
  const seeds: Array<{ iso_year: number; iso_week: number; vehicle: string; running_cost: number }> = [];
  let sourceLabel: string | undefined;
  for (const [vehicle, info] of latestByVehicle) {
    if (existing.has(vehicle)) continue;
    if (info.runningCost === 0) continue; // nothing meaningful to carry
    seeds.push({
      iso_year: year,
      iso_week: week,
      vehicle,
      running_cost: info.runningCost,
    });
    if (!sourceLabel) sourceLabel = `WK${String(info.sourceWeek).padStart(2, "0")}_${String(info.sourceYear).slice(2)}`;
  }
  if (seeds.length === 0) {
    return { seededVehicles: [], sourceLabel, alreadySeeded: existing.size > 0 };
  }

  const { error: insErr } = await supabase
    .from("weekly_vehicle_costs")
    .insert(seeds);
  if (insErr) return { error: insErr.message };

  return {
    seededVehicles: seeds.map((s) => s.vehicle).sort(),
    sourceLabel,
    alreadySeeded: false,
  };
}

/** Convenience: set a single named driver's wage for a week. */
export async function setDriverWage(
  year: number,
  week: number,
  driver: string,
  amount: number
) {
  if (!driver.trim()) return { error: "driver name is required" };
  // Read-modify-write the driver_wages JSON. We do this via upsert so a
  // missing weekly_extras row is created on the fly.
  const { extras, error } = await getWeeklyExtras(year, week);
  if (error || !extras) return { error: error ?? "failed to read extras" };
  const wages: DriverWages = { ...extras.driverWages, [driver.trim()]: amount };
  return upsertWeeklyExtras(year, week, { driverWages: wages });
}
