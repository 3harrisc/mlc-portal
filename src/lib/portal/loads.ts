import type { PlannedRun } from "@/types/runs";
import type { LoadStatus } from "@/components/portal/StatusPill";
import {
  extractPostcode,
  normalizePostcode,
  parseStops,
} from "@/lib/postcode-utils";
import { estimateFinishTime } from "@/lib/runDuration";
import { haversineKm } from "@/lib/geo-utils";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";

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
 * Customer-facing ETA at the delivery point.
 *
 * The customer wants to know "when will the truck be at me?" — that's the
 * booked slot, NOT when the truck finishes the day back at base. Mirrors
 * `chainedEta` for non-chained rows so the loads list and the load detail
 * page show the same number for the same row:
 *
 *   1. bookingTime (the customer's booked arrival)
 *   2. collectionTime (some parser paths land the booking here instead)
 *   3. run.startTime (at least it's a baseline — "leaves at 08:00")
 *
 * Earlier this function piped through estimateFinishTime, which returns
 * finish-back-at-base time and confused customers reading the page.
 */
export function quickEta(run: PlannedRun): string {
  const booked = (run.bookingTime ?? run.collectionTime ?? "").trim();
  if (booked) return booked;
  return run.startTime || "—";
}

// HGV road-distance assumptions. These mirror the inter-run estimate in
// runDuration.ts (they're module-private there). Keep them in sync if the
// chaining maths is ever retuned.
const HGV_AVG_SPEED_KPH = 60;
const ROAD_FACTOR = 1.3; // straight-line × this ≈ road distance

/**
 * Current time-of-day in minutes-since-midnight, in UK (Europe/London) time.
 *
 * The booked slots we compare against are UK local "HH:MM" strings, but the
 * tracker renders server-side and Vercel functions run in UTC. Reading
 * `new Date().getHours()` would therefore be an hour out during BST. We pin
 * the conversion to Europe/London so the live ETA lines up with the booked
 * times regardless of where the function executes.
 */
function ukMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

export interface DeliveryEtaContext {
  /** Live vehicle position, if known. */
  truckPos?: { lat: number; lng: number } | null;
  /** Stop coordinates, keyed by `normalizePostcode(stop)`. */
  coords?: Map<string, { lat: number; lng: number }>;
  /** "Now" — injectable for tests. Defaults to the current time. */
  now?: Date;
}

/**
 * ETA projected from the live vehicle position to the next *outstanding* stop,
 * or `null` when we can't compute one (no live fix, no coords for that stop,
 * or every stop already done).
 *
 * Uses the same HGV road-distance estimate as the chaining maths (straight-line
 * × road factor ÷ average speed) and floors the result at the booked delivery
 * slot, so we never promise an arrival earlier than the customer is booked in.
 *
 * Pulled out of `deliveryEta` so callers that already have a richer fallback
 * (e.g. the admin load detail page, which chains stacked loads) can prefer the
 * live number and keep their own fallback for the not-yet-moving case.
 */
export function liveEtaToNextStop(
  run: PlannedRun,
  ctx: DeliveryEtaContext = {},
): string | null {
  const { truckPos, coords, now = new Date() } = ctx;
  if (!truckPos || !coords) return null;

  const stops = parseStops(run.rawText);
  const completed = new Set([
    ...(run.completedStopIndexes ?? []),
    ...(run.progress?.completedIdx ?? []),
  ]);
  const targetIdx = stops.findIndex((_, i) => !completed.has(i));
  if (targetIdx === -1) return null;

  const target = coords.get(normalizePostcode(stops[targetIdx]));
  if (!target) return null;

  const straightKm = haversineKm(
    { lat: truckPos.lat, lng: truckPos.lng },
    { lat: target.lat, lng: target.lng },
  );
  const travelMins = Math.round(
    ((straightKm * ROAD_FACTOR) / HGV_AVG_SPEED_KPH) * 60,
  );
  let etaMins = ukMinutesOfDay(now) + travelMins;
  // Don't promise earlier than the booked slot.
  const bookedMins = timeToMinutes((run.bookingTime ?? "").trim());
  if (bookedMins != null) etaMins = Math.max(etaMins, bookedMins);
  return minutesToTime(etaMins);
}

/**
 * Customer-facing ETA to the *delivery* point, for the public shipment tracker.
 *
 * `quickEta` answers "what's the booked slot?" — fine for the loads list, but
 * on the shared tracker the recipient is the consignee waiting at the DROP and
 * wants "when will the lorry be at me?". For a collect-then-deliver job
 * `quickEta` can surface the COLLECTION time (run.collectionTime), which reads
 * as a nonsense delivery ETA once the collection slot has passed (the bug the
 * customer reported: an 08:30 ETA that was really the 08:30 collection).
 *
 * Resolution order:
 *   1. Live projection from the current vehicle position (see
 *      `liveEtaToNextStop`).
 *   2. The booked delivery slot (bookingTime) on its own.
 *   3. run.startTime as a baseline, so we degrade gracefully rather than blank.
 *
 * Deliberately ignores `collectionTime` — that's the arrival at the COLLECTION
 * point, never the delivery ETA.
 */
export function deliveryEta(run: PlannedRun, ctx: DeliveryEtaContext = {}): string {
  // 1. Live projection from the current vehicle position.
  const live = liveEtaToNextStop(run, ctx);
  if (live) return live;

  // 2. Booked delivery slot.
  const bookedMins = timeToMinutes((run.bookingTime ?? "").trim());
  if (bookedMins != null) return (run.bookingTime ?? "").trim();

  // 3. Baseline.
  return run.startTime || "—";
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

/**
 * Per-stop arrival / departure / on-site state for the customer portal.
 *
 * Customers use the arrived/departed times for their own internal KPIs
 * (on-time arrival rates, dwell time at the gate, etc.), so this is a
 * core piece of customer-portal data, not just internal dispatch info.
 *
 * The cron at /api/cron/update-progress writes:
 *   * `completed_meta[idx].arrivedISO`  — when the vehicle entered the
 *     postcode radius for a stop.
 *   * `completed_meta[idx].atISO`       — when the vehicle DEPARTED that
 *     radius (the stop is then "done").
 *   * `progress.onSiteIdx`              — the stop the vehicle is
 *     currently inside the radius of.
 *   * `progress.onSiteSinceMs`          — unix-ms timestamp of arrival
 *     for the current on-site stop.
 *
 * This helper wraps that into a simple per-stop view-model.
 */
export interface SiteTimes {
  /** "HH:MM" when the vehicle arrived at this stop, or null. */
  arrivedAt: string | null;
  /** "HH:MM" when the vehicle departed this stop, or null. */
  departedAt: string | null;
  /** True when the vehicle is currently inside this stop's radius. */
  onSite: boolean;
  /** "HH:MM" when the on-site dwell started (only set when onSite). */
  onSiteSince: string | null;
}

const EMPTY_SITE_TIMES: SiteTimes = {
  arrivedAt: null,
  departedAt: null,
  onSite: false,
  onSiteSince: null,
};

function isoToHHMM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toTimeString().slice(0, 5);
}

function msToHHMM(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toTimeString().slice(0, 5);
}

export function legSiteTimes(
  run: PlannedRun,
  stopIndex: number | null | undefined,
): SiteTimes {
  if (stopIndex == null) return EMPTY_SITE_TIMES;
  const meta = (run.completedMeta ?? {})[stopIndex];
  const onSite = run.progress?.onSiteIdx === stopIndex;
  return {
    arrivedAt: isoToHHMM(meta?.arrivedISO),
    departedAt: isoToHHMM(meta?.atISO),
    onSite,
    onSiteSince: onSite ? msToHHMM(run.progress?.onSiteSinceMs ?? null) : null,
  };
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
