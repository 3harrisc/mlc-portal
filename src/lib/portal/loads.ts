import type { PlannedRun } from "@/types/runs";
import type { LoadStatus } from "@/components/portal/StatusPill";
import { extractPostcode, parseStops } from "@/lib/postcode-utils";
import { estimateFinishTime } from "@/lib/runDuration";

/**
 * Derives the customer-portal status enum from a PlannedRun.
 * The DB has no explicit status column — we infer it from progress + date + vehicle.
 *
 * Note: "delayed" and "exception" require richer signals (ETA-vs-actual,
 * explicit incident flag) that don't exist yet. Both are stubbed for now and
 * will be wired in phase 3 alongside the share-link / email-notification work.
 */
export function deriveStatus(run: PlannedRun, todayISO: string): LoadStatus {
  const stops = parseStops(run.rawText);
  const completed = completedCount(run);

  if (stops.length > 0 && completed >= stops.length) return "delivered";
  if (completed > 0) return "in-transit";

  const isToday = run.date === todayISO;
  const hasVehicle = !!run.vehicle?.trim();

  if (isToday && hasVehicle) return "loading";
  if (run.date < todayISO) return "delayed";
  return "scheduled";
}

export function completedCount(run: PlannedRun): number {
  return Math.max(
    (run.completedStopIndexes ?? []).length,
    (run.progress?.completedIdx ?? []).length,
  );
}

export function totalStops(run: PlannedRun): number {
  return parseStops(run.rawText).length;
}

export function progressTuple(run: PlannedRun): { completed: number; total: number } {
  return { completed: completedCount(run), total: totalStops(run) };
}

/**
 * Cheap ETA string for the table view — uses estimateFinishTime which is
 * postcode-distance based and does not call Mapbox. Good enough for a list.
 * The detail page should use buildEtaChain() for a Mapbox-backed answer.
 */
export function quickEta(run: PlannedRun): string {
  return displayEta(run, estimateFinishTime(run).finishTime);
}

/**
 * Apply the booked-time floor to a computed ETA.
 *
 * Why
 * ---
 * The dispatcher books a customer slot (bookingTime, e.g. "08:00") and
 * doesn't want the customer-facing ETA to read earlier than that even if
 * the truck-distance maths says we'd theoretically arrive at 07:42 — the
 * driver isn't going to turn up early. The ETA only "moves" once the
 * computed time slips past the booking and we're genuinely going to be
 * late. Equivalent to:  ETA = max(bookingTime, computedEta).
 *
 * Falls back to the computed value (or "—") whenever the run has no
 * bookingTime, the booking is malformed, or the computed value is empty.
 */
export function displayEta(run: PlannedRun, computed: string): string {
  const eta = computed || "";
  const booked = (run.bookingTime ?? "").trim();
  if (!booked) return eta || "—";
  if (!eta) return booked;
  // Compare as HH:MM minutes-since-midnight; non-numeric values fall
  // through and we treat them as missing.
  const toMin = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const a = toMin(booked);
  const b = toMin(eta);
  if (a == null || b == null) return eta || booked || "—";
  return a >= b ? booked : eta;
}

/**
 * The "real" delivery destination for a run, for display on customer-facing
 * surfaces.
 *
 * Why
 * ---
 * Most of our forwarded-email runs and admin route-planner runs have
 * `to_postcode` set to the SAME value as `from_postcode` because the lorry
 * returns to base after the delivery (returnToBase=true). Showing
 * "NG22 8TX → NG22 8TX" tells the customer nothing useful — they want to
 * see where the load is actually going. The real destination is parked in
 * `raw_text` (the stop list).
 *
 * Resolution order:
 *   1. If `to_postcode` is non-empty and *different* to `from_postcode`,
 *      use it. (Catches portal bookings, the standing fixed runs which use
 *      `to_postcode` for the friendly label like "Tamworth 1", and any
 *      explicit point-to-point work.)
 *   2. Otherwise fall back to the LAST stop in `raw_text` — for an outbound
 *      run that's the customer's delivery point. We prefer last over first
 *      because multi-stop runs sometimes start with a yard / pickup stop.
 *   3. Otherwise return `to_postcode` (which may be empty).
 *
 * The returned string is whatever shape it lives in (postcode for typical
 * runs, friendly label for fixed runs) — callers can display it as-is.
 */
export function displayDestination(run: PlannedRun): string {
  const from = (run.fromPostcode ?? "").trim().toUpperCase();
  const to = (run.toPostcode ?? "").trim();
  if (to && to.toUpperCase() !== from) return to;

  const stops = parseStops(run.rawText);
  if (stops.length > 0) return stops[stops.length - 1];

  // No stops parsed — try to extract a single postcode from raw_text
  // (the fixed-runs materialiser writes `raw_text = "B78 3HJ"`, no newline).
  const single = extractPostcode(run.rawText ?? "");
  if (single) return single;

  return run.toPostcode ?? "";
}

/** "25 Apr" — short British date for table cells. */
export function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** lowercase contains-match across id/ref/postcodes/customer/vehicle. */
export function matchesSearch(run: PlannedRun, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const haystacks = [
    run.jobNumber,
    run.loadRef,
    run.fromPostcode,
    run.toPostcode,
    run.customer,
    run.vehicle,
  ];
  return haystacks.some((h) => (h ?? "").toLowerCase().includes(query));
}
