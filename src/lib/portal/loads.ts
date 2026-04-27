import type { PlannedRun } from "@/types/runs";
import type { LoadStatus } from "@/components/portal/StatusPill";
import { parseStops } from "@/lib/postcode-utils";
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
  return estimateFinishTime(run).finishTime || "—";
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
