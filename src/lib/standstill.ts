import type { ProgressState } from "@/types/runs";
import { haversineMeters, minutesBetween, type LngLat } from "@/lib/geo-utils";
import {
  STANDSTILL_DRIFT_METERS,
  STANDSTILL_MATCH_MIN_MINS,
  STANDSTILL_MATCH_RADIUS_METERS,
} from "@/lib/constants";
import { normalizePostcode } from "@/lib/postcode-utils";

/**
 * Standstill-based stop matching.
 *
 * The geofence path in /api/cron/update-progress only completes a stop when
 * the vehicle dwells within COMPLETION_RADIUS_METERS of the postcode
 * centroid. Real delivery sites are often further out — load
 * MLC-20260713-001 proved dwells 0.9–2.3km from the centroid. These helpers
 * track where the vehicle is *actually* holding position and attribute a
 * long-enough standstill to the nearest uncompleted stop within
 * STANDSTILL_MATCH_RADIUS_METERS.
 */

export interface StandstillDeparture {
  /** Stop index the vehicle just pulled away from. */
  idx: number;
  /** When the standstill began (unix ms), for arrivedISO backfill. */
  arrivedMs: number | null;
}

/**
 * Update the standstill anchor from the latest position fix. Mutates `p`.
 *
 * While the vehicle stays within STANDSTILL_DRIFT_METERS of the anchor the
 * standstill continues. Any bigger move resets the anchor — and if the old
 * standstill had been matched to a stop, that stop's departure is returned
 * so the caller can stamp its atISO.
 */
export function updateStandstillAnchor(
  p: ProgressState,
  vehicle: LngLat,
  nowMs: number,
): StandstillDeparture | null {
  const anchored = p.stillLat != null && p.stillLng != null;
  if (
    anchored &&
    haversineMeters(vehicle, { lat: p.stillLat!, lng: p.stillLng! }) <=
      STANDSTILL_DRIFT_METERS
  ) {
    return null; // still holding position at the same spot
  }

  // Vehicle moved (or first fix): the previous standstill, if any, ended.
  const departure: StandstillDeparture | null =
    p.stillStopIdx != null
      ? { idx: p.stillStopIdx, arrivedMs: p.stillSinceMs ?? null }
      : null;

  p.stillLat = vehicle.lat;
  p.stillLng = vehicle.lng;
  p.stillSinceMs = nowMs;
  p.stillStopIdx = null;
  return departure;
}

/**
 * If the current standstill has lasted STANDSTILL_MATCH_MIN_MINS and the
 * nearest uncompleted stop is within STANDSTILL_MATCH_RADIUS_METERS,
 * complete that stop. Mutates `p` (completedIdx + stillStopIdx). One stop
 * per standstill — returns the completed index, or null.
 */
export function matchStandstillToStop(args: {
  p: ProgressState;
  stops: string[];
  coords: Map<string, LngLat>;
  uncompletedIdxs: number[];
  nowMs: number;
}): number | null {
  const { p, stops, coords, uncompletedIdxs, nowMs } = args;

  if (p.stillStopIdx != null) return null; // this standstill already matched
  if (p.stillLat == null || p.stillLng == null || p.stillSinceMs == null)
    return null;
  if (minutesBetween(p.stillSinceMs, nowMs) < STANDSTILL_MATCH_MIN_MINS)
    return null;

  const anchor: LngLat = { lat: p.stillLat, lng: p.stillLng };
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (const idx of uncompletedIdxs) {
    if (p.completedIdx.includes(idx)) continue; // completed earlier this tick
    const ll = coords.get(normalizePostcode(stops[idx]));
    if (!ll) continue;
    const dist = haversineMeters(anchor, ll);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }
  if (bestIdx == null || bestDist > STANDSTILL_MATCH_RADIUS_METERS) return null;

  p.completedIdx.push(bestIdx);
  p.completedIdx.sort((a, b) => a - b);
  p.stillStopIdx = bestIdx;
  return bestIdx;
}
