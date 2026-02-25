import { parseStops } from "@/lib/postcode-utils";
import type { PlannedRun } from "@/types/runs";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";
import { MAX_DRIVE_BEFORE_BREAK_MINS, BREAK_MINS } from "@/lib/constants";

/**
 * Rough estimate of a run's finish time based on stop count + service time.
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

  const avgDrivePerStop = 20;
  const totalDrive = stops.length * avgDrivePerStop;
  const totalService = stops.length * run.serviceMins;

  let breakMins = 0;
  if (run.includeBreaks && totalDrive > MAX_DRIVE_BEFORE_BREAK_MINS) {
    breakMins = Math.floor(totalDrive / MAX_DRIVE_BEFORE_BREAK_MINS) * BREAK_MINS;
  }

  const returnLeg = run.returnToBase ? avgDrivePerStop : 0;
  const totalMins = totalDrive + totalService + breakMins + returnLeg;
  const finishMins = startMins + totalMins;

  const lastPostcode = run.returnToBase
    ? run.fromPostcode
    : (stops[stops.length - 1] || run.fromPostcode);

  return { finishTime: minutesToTime(finishMins), finishMins, lastPostcode };
}

/**
 * Compute chained start times for an ordered group of runs on the same vehicle+date.
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
      const { finishTime, lastPostcode } = estimateFinishTime(prev);

      const configuredStart = timeToMinutes(runs[i].startTime) ?? 480;
      const chainedStart = timeToMinutes(finishTime) ?? 480;
      const effectiveStart = Math.max(configuredStart, chainedStart);

      result.set(runs[i].id, {
        chainedStartTime: minutesToTime(effectiveStart),
        chainedFromPostcode: lastPostcode,
      });
    }
  }

  return result;
}
