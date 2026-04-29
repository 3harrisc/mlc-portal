/**
 * Customer-portal stacked-load chaining.
 *
 * The dispatch planner computes chained start times for vehicles that run
 * multiple legs in a day (so leg 2's start time is leg 1's finish + travel,
 * not whatever literal value the operator typed). The customer-facing loads
 * page used to skip this entirely — every row showed its raw `startTime` and
 * an ETA estimated in isolation, which is misleading when (e.g.) two Ashwood
 * loads share a vehicle.
 *
 * This helper applies the same `computeChainedStarts` logic the dispatch
 * planner uses, scoped per (vehicle + date) group, and returns a map keyed
 * by load id. The list and detail pages both consume it.
 *
 * Single-load groups are intentionally returned unchanged (no chained entry)
 * so callers can fall back to the run's literal `startTime`.
 */

import type { PlannedRun } from "@/types/runs";
import { computeChainedStarts, estimateFinishTime } from "@/lib/runDuration";
import { type LngLat } from "@/lib/geo-utils";
import { displayEta } from "./loads";

export interface ChainedInfo {
  chainedStartTime: string;
  chainedFromPostcode: string;
}

/**
 * Build a map of load id → chained-start info for any (vehicle, date) group
 * with more than one row. Inputs without a vehicle are ignored.
 *
 * Sorts within each group by `runOrder` (nulls last), then `startTime` —
 * matching how the dispatch planner orders stacked runs.
 */
export function computeLoadChains(
  loads: ReadonlyArray<PlannedRun>,
  postcodeCoords: Record<string, LngLat> = {},
): Map<string, ChainedInfo> {
  const groups = new Map<string, PlannedRun[]>();
  for (const r of loads) {
    const v = r.vehicle?.trim();
    if (!v || !r.date) continue;
    const key = `${v}|${r.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const chains = new Map<string, ChainedInfo>();
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      if (a.runOrder != null && b.runOrder != null) return a.runOrder - b.runOrder;
      if (a.runOrder != null) return -1;
      if (b.runOrder != null) return 1;
      return (a.startTime ?? "").localeCompare(b.startTime ?? "");
    });
    const groupChains = computeChainedStarts(group, postcodeCoords);
    for (const [id, info] of groupChains) chains.set(id, info);
  }
  return chains;
}

/**
 * ETA helper that respects chaining — when the load is part of a chain, the
 * displayed ETA is computed from the chained start, not the literal one.
 *
 * Returns the same string format as `quickEta` so callers can swap them in
 * place without further conversion.
 */
export function chainedEta(
  run: PlannedRun,
  chained: ChainedInfo | undefined,
): string {
  const computed = chained
    ? estimateFinishTime({ ...run, startTime: chained.chainedStartTime })
        .finishTime
    : estimateFinishTime(run).finishTime;
  return displayEta(run, computed || "");
}
