/**
 * Which runs the progress cron should still be tracking today.
 *
 * Why this exists
 * ----------------
 * The cron used to fetch `date IN (today, yesterday)` and nothing else. That
 * silently broke multi-day trips: a Wales → East Anglia run stamped with its
 * START date kept being tracked on day two, then dropped out of the query at
 * midnight on day three. The load froze mid-route with half its drops
 * outstanding and no error anywhere — the truck was still reporting, but
 * nothing was listening.
 *
 * A run may now declare its span with `day_count` (the multi-day fields from
 * migration 010). While today falls inside `[date, date + day_count - 1]` the
 * run stays trackable.
 *
 * The "still has uncompleted stops" guard on every past-dated branch is load
 * bearing, not a nicety. Chain grouping in the cron is by `vehicle|date`, so a
 * stale run and the vehicle's current work land in DIFFERENT groups and would
 * both be tracked at once — letting an abandoned run's geofences steal
 * completions from today's route. Bounding by "not finished yet" plus
 * MAX_TRIP_LOOKBACK_DAYS keeps that blast radius small.
 */

/**
 * How far back the SQL prefilter reaches for multi-day runs. A backstop
 * against a typo'd `day_count` (or an abandoned trip) keeping a row in the
 * tracking set indefinitely — no real trip runs longer than this.
 */
export const MAX_TRIP_LOOKBACK_DAYS = 14;

/** Shift a "YYYY-MM-DD" by whole days. Date-only, so DST never applies. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Last day (inclusive) a run is expected to be on the road.
 *
 * `day_count` counts days, not offsets: a 3-day trip starting on the 18th
 * finishes on the 20th, so the offset is `day_count - 1`. A missing or
 * nonsensical count degrades to a single-day run.
 */
export function lastTrackedDay(
  date: string,
  dayCount?: number | null,
): string {
  if (!dayCount || dayCount < 2) return date;
  return addDaysISO(date, dayCount - 1);
}

export interface TrackabilityInput {
  date: string;
  collectionDate?: string | null;
  dayCount?: number | null;
  /** False once every parsed stop is complete. */
  hasUncompletedStops: boolean;
  today: string;
  yesterday: string;
}

/**
 * True when the progress cron should still be geofencing this run.
 *
 * ISO date strings compare correctly with `<=` / `>=` lexicographically, so
 * no parsing is needed for the range check.
 */
export function isTrackable({
  date,
  collectionDate,
  dayCount,
  hasUncompletedStops,
  today,
  yesterday,
}: TrackabilityInput): boolean {
  // Running today — always tracked, finished or not, so late completions and
  // the return-to-base leg still register.
  if (date === today) return true;

  // Cross-day backload collecting today.
  if (collectionDate === today) return true;

  // Yesterday's run, still unfinished — it may be running late or overnight.
  if (date === yesterday && hasUncompletedStops) return true;

  // A declared multi-day trip, still inside its span and inside the backstop.
  const last = lastTrackedDay(date, dayCount);
  if (last === date) return false;
  const earliest = addDaysISO(today, -MAX_TRIP_LOOKBACK_DAYS);
  return (
    date >= earliest && date <= today && today <= last && hasUncompletedStops
  );
}
