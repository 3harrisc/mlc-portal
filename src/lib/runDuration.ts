import { parseStops } from "@/lib/postcode-utils";
import type { PlannedRun } from "@/types/runs";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";
import { MAX_DRIVE_BEFORE_BREAK_MINS, BREAK_MINS } from "@/lib/constants";
import { haversineKm, type LngLat } from "@/lib/geo-utils";

/** Avg drive time between two postcodes (rough estimate, no API call) */
const AVG_DRIVE_PER_STOP = 20; // mins
/** Fallback travel time when coords are unavailable */
const AVG_INTER_RUN_TRAVEL = 30; // mins
/** HGV average speed in kph for inter-run travel estimate */
const HGV_AVG_SPEED_KPH = 60;
/** Road winding factor — straight-line distance × this = estimated road distance */
const ROAD_FACTOR = 1.3;

/**
 * Rough estimate of a run's finish time based on stop count + service time.
 * Includes service time at the last stop (tip-out/unloading).
 * Used for chaining display on the runs page (avoids Mapbox API calls).
 */
export function estimateFinishTime(run: PlannedRun): {
  finishTime: string;
  finishMins: number;
  lastPostcode: string;
} {
  const stops = parseStops(run.rawText);
  const startMins = timeToMinutes(run.startTime) ?? 480;

  if (!stops.length) {
    return { finishTime: run.startTime, finishMins: startMins, lastPostcode: run.fromPostcode };
  }

  const totalDrive = stops.length * AVG_DRIVE_PER_STOP;
  const totalService = stops.length * run.serviceMins;

  let breakMins = 0;
  if (run.includeBreaks && totalDrive > MAX_DRIVE_BEFORE_BREAK_MINS) {
    breakMins = Math.floor(totalDrive / MAX_DRIVE_BEFORE_BREAK_MINS) * BREAK_MINS;
  }

  const returnLeg = run.returnToBase ? AVG_DRIVE_PER_STOP : 0;
  const totalMins = totalDrive + totalService + breakMins + returnLeg;
  const finishMins = startMins + totalMins;

  const lastPostcode = run.returnToBase
    ? run.fromPostcode
    : (stops[stops.length - 1] || run.fromPostcode);

  return { finishTime: minutesToTime(finishMins), finishMins, lastPostcode };
}

/** Estimate travel time (mins) between two postcodes using cached coordinates */
function estimateTravelMins(
  fromPc: string,
  toPc: string,
  coords: Record<string, LngLat>
): number {
  if (fromPc === toPc) return 0;

  const from = coords[fromPc.toUpperCase().replace(/\s/g, "")];
  const to = coords[toPc.toUpperCase().replace(/\s/g, "")];

  if (!from || !to) return AVG_INTER_RUN_TRAVEL; // fallback if coords missing

  const straightLineKm = haversineKm(from, to);
  const roadKm = straightLineKm * ROAD_FACTOR;
  return Math.round((roadKm / HGV_AVG_SPEED_KPH) * 60);
}

/**
 * Compute a run's finish time in minutes.
 * If the run has a booking time (collectionTime), that IS the arrival at the first stop —
 * so finish = booking time + service + return, skipping drive-time calculation.
 * Otherwise falls back to start + drive + service + breaks + return.
 */
function runFinishMins(run: PlannedRun, startMins: number): {
  finishMins: number;
  lastPostcode: string;
} {
  const stops = parseStops(run.rawText);
  if (!stops.length) {
    return { finishMins: startMins, lastPostcode: run.fromPostcode };
  }

  const bookingMins = run.collectionTime ? timeToMinutes(run.collectionTime) : null;

  let finishMins: number;
  if (bookingMins != null) {
    // Booking time = arrival at first stop. Service at each stop, then optional return.
    const serviceTotal = stops.length * run.serviceMins;
    const returnLeg = run.returnToBase ? AVG_DRIVE_PER_STOP : 0;
    finishMins = bookingMins + serviceTotal + returnLeg;
  } else {
    // No booking time — estimate from start + drive + service + breaks + return
    const totalDrive = stops.length * AVG_DRIVE_PER_STOP;
    const totalService = stops.length * run.serviceMins;
    let breakMins = 0;
    if (run.includeBreaks && totalDrive > MAX_DRIVE_BEFORE_BREAK_MINS) {
      breakMins = Math.floor(totalDrive / MAX_DRIVE_BEFORE_BREAK_MINS) * BREAK_MINS;
    }
    const returnLeg = run.returnToBase ? AVG_DRIVE_PER_STOP : 0;
    finishMins = startMins + totalDrive + totalService + breakMins + returnLeg;
  }

  const lastPostcode = run.returnToBase
    ? run.fromPostcode
    : (stops[stops.length - 1] || run.fromPostcode);

  return { finishMins, lastPostcode };
}

/**
 * Compute chained start times for an ordered group of runs on the same vehicle+date.
 * Uses booking times (collectionTime) as arrival at destination when available.
 * When coords are provided, uses haversine distance for inter-run travel estimates.
 */
export function computeChainedStarts(
  runs: PlannedRun[],
  coords: Record<string, LngLat> = {}
): Map<string, { chainedStartTime: string; chainedFromPostcode: string }> {
  const result = new Map<string, { chainedStartTime: string; chainedFromPostcode: string }>();

  for (let i = 0; i < runs.length; i++) {
    if (i === 0) {
      result.set(runs[i].id, {
        chainedStartTime: runs[i].startTime,
        chainedFromPostcode: runs[i].fromPostcode,
      });
    } else {
      const prev = runs[i - 1];
      const prevChained = result.get(prev.id);
      const prevStartMins = prevChained
        ? (timeToMinutes(prevChained.chainedStartTime) ?? 480)
        : (timeToMinutes(prev.startTime) ?? 480);

      const { finishMins: prevFinishMins, lastPostcode: prevLastPc } =
        runFinishMins(prev, prevStartMins);

      // Estimate travel time from last stop to next collection using coords
      const nextFromPc = runs[i].fromPostcode;
      const travelToNext = estimateTravelMins(prevLastPc, nextFromPc, coords);

      const effectiveStart = prevFinishMins + travelToNext;

      result.set(runs[i].id, {
        chainedStartTime: minutesToTime(effectiveStart),
        chainedFromPostcode: prevLastPc,
      });
    }
  }

  return result;
}
