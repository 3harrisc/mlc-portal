import { parseStops } from "@/lib/postcode-utils";
import type { PlannedRun } from "@/types/runs";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";
import { MAX_DRIVE_BEFORE_BREAK_MINS, BREAK_MINS } from "@/lib/constants";

/** Avg drive time between two postcodes (rough estimate, no API call) */
const AVG_DRIVE_PER_STOP = 20; // mins
/** Avg travel time between two different locations (for inter-run travel) */
const AVG_INTER_RUN_TRAVEL = 30; // mins

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

/**
 * Compute chained start times for an ordered group of runs on the same vehicle+date.
 * Accounts for: previous run finish + service time + travel to next collection point.
 */
export function computeChainedStarts(
  runs: PlannedRun[]
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
      // Use chained start time for previous run if available (cascading chain)
      const prevChained = result.get(prev.id);
      const prevStartMins = prevChained
        ? (timeToMinutes(prevChained.chainedStartTime) ?? 480)
        : (timeToMinutes(prev.startTime) ?? 480);

      // Recalculate previous run duration from its chained start
      const prevStops = parseStops(prev.rawText);
      const prevDrive = prevStops.length * AVG_DRIVE_PER_STOP;
      const prevService = prevStops.length * prev.serviceMins;
      let prevBreaks = 0;
      if (prev.includeBreaks && prevDrive > MAX_DRIVE_BEFORE_BREAK_MINS) {
        prevBreaks = Math.floor(prevDrive / MAX_DRIVE_BEFORE_BREAK_MINS) * BREAK_MINS;
      }
      const prevReturn = prev.returnToBase ? AVG_DRIVE_PER_STOP : 0;
      const prevFinishMins = prevStartMins + prevDrive + prevService + prevBreaks + prevReturn;

      const prevLastPc = prev.returnToBase
        ? prev.fromPostcode
        : (prevStops[prevStops.length - 1] || prev.fromPostcode);

      // Add travel time from previous run's last stop to this run's collection point
      const nextFromPc = runs[i].fromPostcode;
      const travelToNext = prevLastPc === nextFromPc ? 0 : AVG_INTER_RUN_TRAVEL;

      const chainedStart = prevFinishMins + travelToNext;
      const configuredStart = timeToMinutes(runs[i].startTime) ?? 480;
      const effectiveStart = Math.max(configuredStart, chainedStart);

      result.set(runs[i].id, {
        chainedStartTime: minutesToTime(effectiveStart),
        chainedFromPostcode: prevLastPc,
      });
    }
  }

  return result;
}
