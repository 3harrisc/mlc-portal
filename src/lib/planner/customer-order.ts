/**
 * Customer ordering for the daily transport sheet.
 *
 * The operator wants their three primary customers pinned to the top of the
 * planner in a specific order; everything else falls below in alphabetical
 * order. Aliases (the *_001 codes that show up in older data) sit alongside
 * their canonical name.
 *
 * Tweak `PRIORITY_ORDER` to change the pinned list. Pure, side-effect-free.
 */

import type { PlannedRun } from "@/types/runs";

/**
 * Customers pinned to the top of the planner, in display order.
 * Each entry is the case-folded planner-side name. Aliases (CON001 ⇔
 * CONSOLID8 etc.) get the same priority bucket so they sort together.
 */
export const PRIORITY_ORDER: ReadonlyArray<ReadonlyArray<string>> = [
  ["CONSOLID8", "CON001"],
  ["ASHWOOD"],
  ["MONTPELLIER", "MON001"],
];

/** Flat lookup: customer name → priority index (lower = higher up). */
const PRIORITY_INDEX: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  PRIORITY_ORDER.forEach((aliases, idx) => {
    for (const a of aliases) map.set(a.trim().toUpperCase(), idx);
  });
  return map;
})();

const FALLBACK_INDEX = PRIORITY_ORDER.length;

/**
 * Returns a sortable [primaryIdx, secondaryName] tuple for a customer name.
 * Customers in PRIORITY_ORDER get their bucket index; others get a fallback
 * bucket sorted alphabetically by name.
 */
export function customerSortKey(customer: string): readonly [number, string] {
  const norm = (customer ?? "").trim().toUpperCase();
  const idx = PRIORITY_INDEX.get(norm);
  return [idx ?? FALLBACK_INDEX, norm];
}

/** Comparator for two customer names. */
export function compareByCustomer(a: string, b: string): number {
  const [aIdx, aName] = customerSortKey(a);
  const [bIdx, bName] = customerSortKey(b);
  if (aIdx !== bIdx) return aIdx - bIdx;
  return aName.localeCompare(bName);
}

/**
 * Stable comparator for two PlannedRuns. Order:
 *
 *   1. `runOrder` (manual drag-reorder) — takes precedence so a row the
 *      operator deliberately dragged stays where they put it.
 *   2. Customer priority — CONSOLID8 → ASHWOOD → MONTPELLIER → others alpha.
 *   3. Vehicle alphabetical.
 *   4. startTime.
 *
 * Rows with no `runOrder` (the default) sort to the bottom of the runOrder
 * bucket, then fall through to customer priority — so a fresh day with no
 * manual ordering lands the way the operator expects (CONSOLID8 first).
 */
export function compareRunsForPlanner(a: PlannedRun, b: PlannedRun): number {
  const ao = a.runOrder ?? Number.POSITIVE_INFINITY;
  const bo = b.runOrder ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  const c = compareByCustomer(a.customer ?? "", b.customer ?? "");
  if (c !== 0) return c;
  const av = (a.vehicle ?? "").toUpperCase();
  const bv = (b.vehicle ?? "").toUpperCase();
  if (av !== bv) return av.localeCompare(bv);
  return (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

/** Returns a NEW array, sorted. Doesn't mutate the input. */
export function sortRunsForPlanner(runs: ReadonlyArray<PlannedRun>): PlannedRun[] {
  return [...runs].sort(compareRunsForPlanner);
}
