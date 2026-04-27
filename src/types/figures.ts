/**
 * Domain types for the weekly Figures sheet (migration 009).
 */

export interface WeeklyVehicleCost {
  isoYear: number;
  isoWeek: number;
  vehicle: string;
  runningCost: number;
  fuelUkLitres: number;
  fuelUkAmount: number;
  fuelLuxLitres: number;
  fuelLuxAmount: number;
  tollsEuro: number;
  tollsGbp: number;
  parking: number;
  adblue: number;
  otherCost: number;
  notes?: string;
}

/** Driver wages map: { "Aussie": 900, "Roger": 0, ... } */
export type DriverWages = Record<string, number>;

export interface WeeklyExtras {
  isoYear: number;
  isoWeek: number;
  office: number;
  vans: number;
  bbl: number;
  subbyCost: number;
  driverWages: DriverWages;
  notes?: string;
}

/** A blank-but-valid weekly_extras for a given week. */
export function emptyWeeklyExtras(year: number, week: number): WeeklyExtras {
  return {
    isoYear: year,
    isoWeek: week,
    office: 0,
    vans: 0,
    bbl: 0,
    subbyCost: 0,
    driverWages: {},
  };
}

/** A blank-but-valid weekly_vehicle_costs row for a given (year, week, vehicle). */
export function emptyWeeklyVehicleCost(
  year: number,
  week: number,
  vehicle: string
): WeeklyVehicleCost {
  return {
    isoYear: year,
    isoWeek: week,
    vehicle,
    runningCost: 0,
    fuelUkLitres: 0,
    fuelUkAmount: 0,
    fuelLuxLitres: 0,
    fuelLuxAmount: 0,
    tollsEuro: 0,
    tollsGbp: 0,
    parking: 0,
    adblue: 0,
    otherCost: 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToWeeklyVehicleCost(row: any): WeeklyVehicleCost {
  return {
    isoYear: row.iso_year,
    isoWeek: row.iso_week,
    vehicle: row.vehicle,
    runningCost: Number(row.running_cost ?? 0),
    fuelUkLitres: Number(row.fuel_uk_litres ?? 0),
    fuelUkAmount: Number(row.fuel_uk_amount ?? 0),
    fuelLuxLitres: Number(row.fuel_lux_litres ?? 0),
    fuelLuxAmount: Number(row.fuel_lux_amount ?? 0),
    tollsEuro: Number(row.tolls_euro ?? 0),
    tollsGbp: Number(row.tolls_gbp ?? 0),
    parking: Number(row.parking ?? 0),
    adblue: Number(row.adblue ?? 0),
    otherCost: Number(row.other_cost ?? 0),
    notes: row.notes ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToWeeklyExtras(row: any): WeeklyExtras {
  return {
    isoYear: row.iso_year,
    isoWeek: row.iso_week,
    office: Number(row.office ?? 0),
    vans: Number(row.vans ?? 0),
    bbl: Number(row.bbl ?? 0),
    subbyCost: Number(row.subby_cost ?? 0),
    driverWages: (row.driver_wages ?? {}) as DriverWages,
    notes: row.notes ?? undefined,
  };
}
