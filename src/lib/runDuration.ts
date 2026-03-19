import { parseStops } from "@/lib/postcode-utils";
import type { PlannedRun } from "@/types/runs";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";
import { MAX_DRIVE_BEFORE_BREAK_MINS, BREAK_MINS } from "@/lib/constants";
import { haversineKm, type LngLat } from "@/lib/geo-utils";

/** Parse per-stop booking times from rawText lines (e.g. "BS20 7XN 08:00" → {0: 480}) */
function parseStopBookingTimes(rawText: string): Map<number, number> {
  const times = new Map<number, number>();
  const lines = (rawText || "").split(/\r?\n/).filter(Boolean);
  let stopIdx = 0;
  for (const line of lines) {
    const hasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(line);
    if (hasPostcode) {
      const timeMatch = line.match(/\b(\d{1,2}:\d{2})\b/);
      if (timeMatch) {
        const mins = timeToMinutes(timeMatch[1]);
        if (mins != null) times.set(stopIdx, mins);
      }
      stopIdx++;
    }
  }
  return times;
}

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
 * When live progress is available (completedStopIndexes), estimates from NOW
 * based on remaining stops — much more accurate for in-progress runs.
 * Otherwise falls back to planned schedule estimate.
 */
function runFinishMins(run: PlannedRun, startMins: number): {
  finishMins: number;
  lastPostcode: string;
} {
  const stops = parseStops(run.rawText);
  if (!stops.length) {
    return { finishMins: startMins, lastPostcode: run.fromPostcode };
  }

  const completedCount = run.completedStopIndexes?.length ?? 0;
  const remainingCount = stops.length - completedCount;

  // If run is in progress (some stops completed but not all), estimate from NOW
  if (completedCount > 0 && remainingCount > 0) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const remainDrive = remainingCount * AVG_DRIVE_PER_STOP;
    const remainService = remainingCount * run.serviceMins;
    const returnLeg = run.returnToBase ? AVG_DRIVE_PER_STOP : 0;
    const finishMins = nowMins + remainDrive + remainService + returnLeg;

    const lastPostcode = run.returnToBase
      ? run.fromPostcode
      : (stops[stops.length - 1] || run.fromPostcode);

    return { finishMins, lastPostcode };
  }

  // All stops completed — run is done, finish = now
  if (completedCount > 0 && remainingCount <= 0) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const returnLeg = run.returnToBase ? AVG_DRIVE_PER_STOP : 0;
    const lastPostcode = run.returnToBase
      ? run.fromPostcode
      : (stops[stops.length - 1] || run.fromPostcode);
    return { finishMins: nowMins + returnLeg, lastPostcode };
  }

  // Not started — use planned schedule
  // Check per-stop delivery booking times from rawText (e.g. "BS20 7XN 08:00")
  const perStopBookings = parseStopBookingTimes(run.rawText);
  // Also consider run-level collectionTime (for backloads or as stop 0 anchor)
  if (run.collectionTime && !perStopBookings.has(0)) {
    const ct = timeToMinutes(run.collectionTime);
    if (ct != null) perStopBookings.set(0, ct);
  }

  // Find the latest booking time across all stops
  let latestBookingMins: number | null = null;
  let latestBookingIdx = -1;
  for (const [idx, mins] of perStopBookings) {
    if (latestBookingMins == null || mins > latestBookingMins) {
      latestBookingMins = mins;
      latestBookingIdx = idx;
    }
  }

  let finishMins: number;
  if (latestBookingMins != null) {
    // From the latest booked stop: booking time + service at that stop
    // + remaining stops after it (drive + service each) + return leg
    const stopsAfterBooking = stops.length - latestBookingIdx - 1;
    const remainDrive = stopsAfterBooking * AVG_DRIVE_PER_STOP;
    const remainService = stopsAfterBooking * run.serviceMins;
    const returnLeg = run.returnToBase ? AVG_DRIVE_PER_STOP : 0;
    finishMins = latestBookingMins + run.serviceMins + remainDrive + remainService + returnLeg;
  } else {
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
    const cur = runs[i];
    const curBookingMins = cur.collectionTime ? timeToMinutes(cur.collectionTime) : null;

    if (i === 0) {
      // First run: if it has a booking time, use that as the effective start
      // (the driver will arrive at the first delivery at the booking time)
      if (curBookingMins != null) {
        result.set(cur.id, {
          chainedStartTime: cur.collectionTime!,
          chainedFromPostcode: cur.fromPostcode,
        });
      } else {
        result.set(cur.id, {
          chainedStartTime: cur.startTime,
          chainedFromPostcode: cur.fromPostcode,
        });
      }
    } else {
      const prev = runs[i - 1];
      const prevChained = result.get(prev.id);
      const prevStartMins = prevChained
        ? (timeToMinutes(prevChained.chainedStartTime) ?? 480)
        : (timeToMinutes(prev.startTime) ?? 480);

      const { finishMins: prevFinishMins, lastPostcode: prevLastPc } =
        runFinishMins(prev, prevStartMins);

      // Chain from previous run's finish + travel time
      const nextFromPc = cur.fromPostcode;
      const travelToNext = estimateTravelMins(prevLastPc, nextFromPc, coords);
      const earliestArrival = prevFinishMins + travelToNext;

      if (curBookingMins != null) {
        // Has a booking time — use whichever is LATER: booking time or
        // when the driver can actually arrive from the previous run
        const effectiveStart = Math.max(earliestArrival, curBookingMins);
        result.set(cur.id, {
          chainedStartTime: minutesToTime(effectiveStart),
          chainedFromPostcode: prevLastPc,
        });
      } else {
        // No booking time — chain from previous run's finish + travel
        result.set(cur.id, {
          chainedStartTime: minutesToTime(earliestArrival),
          chainedFromPostcode: prevLastPc,
        });
      }
    }
  }

  return result;
}
