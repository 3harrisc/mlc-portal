/**
 * Fixed weekday runs that pre-populate on the dispatch planner.
 *
 * These are the operator's standing daily Consolid8 routes — they run every
 * Monday-Friday regardless of what else dispatch is planning, so we
 * materialise them onto the planner automatically (both via a daily cron
 * and on-the-fly when the planner page opens a weekday with no fixed runs
 * yet).
 *
 * Each entry produces one `runs` row per weekday. IDs are deterministic
 * (`fixed-{slug}-{date}`) so re-running the materialiser is idempotent —
 * if the row exists the insert is skipped.
 *
 * To add another standing run, append to FIXED_WEEKDAY_RUNS. The dispatcher
 * can edit any of these rows on the planner like any other row (add a
 * vehicle, change the booking time, mark billable, etc.) — only fields
 * that aren't yet set get filled at materialisation time.
 */

export interface FixedRunSpec {
  /** Stable slug used in the deterministic id `fixed-{slug}-{date}`. */
  slug: string;
  /** Customer name, exactly as it should appear on the planner row. */
  customer: string;
  /** Factory label shown in the planner Factory column. */
  factory: string;
  /** Driver origin (Newark base for current 4). */
  fromPostcode: string;
  /** Destination postcode. */
  toPostcode: string;
  /** Default planner start time. */
  startTime: string;
  /** Service minutes per stop. */
  serviceMins: number;
  /** Whether to add legal break time when computing finish. */
  includeBreaks: boolean;
  /** Whether the vehicle returns to base after the last stop. */
  returnToBase: boolean;
  /** Standing revenue for the run (£). */
  revenue: number;
  /** Loads ref carried into the planner row. Empty string if blank. */
  loadRef: string;
  /** Run type — these are all regular outbounds. */
  runType: "regular" | "backload";
}

export const FIXED_WEEKDAY_RUNS: ReadonlyArray<FixedRunSpec> = [
  {
    slug: "consolid8-tamworth-1",
    customer: "Consolid8",
    factory: "Tamworth 1",
    fromPostcode: "NG22 8TX", // Newark
    toPostcode: "B78 3HJ",    // Tamworth
    startTime: "06:00",
    serviceMins: 60,
    includeBreaks: true,
    returnToBase: true,
    revenue: 250,
    loadRef: "",
    runType: "regular",
  },
  {
    slug: "consolid8-tamworth-3",
    customer: "Consolid8",
    factory: "Tamworth 3",
    fromPostcode: "NG22 8TX",
    toPostcode: "B78 3HJ",
    startTime: "06:00",
    serviceMins: 60,
    includeBreaks: true,
    returnToBase: true,
    revenue: 250,
    loadRef: "",
    runType: "regular",
  },
  {
    slug: "consolid8-portbury",
    customer: "Consolid8",
    factory: "Portbury",
    fromPostcode: "NG22 8TX",
    toPostcode: "BS20 7XN", // Portbury Dock
    startTime: "06:00",
    serviceMins: 60,
    includeBreaks: true,
    returnToBase: true,
    revenue: 350,
    loadRef: "",
    runType: "regular",
  },
  {
    slug: "consolid8-prem-park-3",
    customer: "Consolid8",
    factory: "Prem Park 3",
    fromPostcode: "NG22 8TX",
    toPostcode: "NW10 7NZ", // Premier Park, NW London
    startTime: "06:00",
    serviceMins: 60,
    includeBreaks: true,
    returnToBase: true,
    revenue: 425,
    loadRef: "",
    runType: "regular",
  },
];

/**
 * Returns true for Monday-Friday (the spreadsheet's working week). Saturdays
 * and Sundays don't get fixed runs auto-materialised.
 *
 * iso: "YYYY-MM-DD"
 */
export function isWeekday(iso: string): boolean {
  if (!iso) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return false;
  // UTC to avoid local-tz drift across DST.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5; // Mon..Fri
}

/** Deterministic row id for a given fixed-run + date pair. */
export function fixedRunId(slug: string, date: string): string {
  return `fixed-${slug}-${date}`;
}
