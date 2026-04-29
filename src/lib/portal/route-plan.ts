/**
 * Build the canonical "what does this load actually look like on the road"
 * plan that the load detail page uses to render the stops list and the map.
 *
 * Why this exists
 * ---------------
 * For multi-drop customers like Ashwood, the collection happens at the
 * customer's depot (their `base_postcode` on the customers table), and
 * every entry in `raw_text` is a delivery. The old code on the load detail
 * page treated `stops[0]` as the collection regardless of customer, which
 * meant the first listed delivery was being mis-labelled and the map was
 * routing FROM that delivery rather than from the depot.
 *
 * For backloads the inverse holds: the truck goes empty to the pickup
 * (`fromPostcode`), then delivers — so we need a different plan again.
 *
 * Centralising the logic here keeps the rendering code thin and makes
 * the per-customer rules testable in one place rather than scattered
 * across the page.
 */
import type { PlannedRun } from "@/types/runs";
import { parseStops, normalizePostcode } from "@/lib/postcode-utils";

export interface PlanLeg {
  postcode: string;
  /** "Collection", "Drop 1", "Drop 2", "Return to base", … */
  label: string;
  /**
   * Index into the underlying `parseStops(rawText)` list, when this leg
   * corresponds to a parsed stop. The collection / return-to-base legs
   * are synthetic and have stopIndex = null.
   */
  stopIndex: number | null;
  /** Origin / drop / return-to-base — drives map pin styling. */
  kind: "origin" | "drop" | "return";
}

export interface RoutePlan {
  legs: PlanLeg[];
  /** Convenience flags so callers don't have to scan legs themselves. */
  hasExplicitOrigin: boolean;
  /** Number of delivery drops (excludes origin and return-to-base). */
  dropCount: number;
}

/**
 * Decide whether the customer's base postcode is the actual collection
 * point (Ashwood-style) by comparing it case-insensitively + space-
 * insensitively to the load's `fromPostcode`. Both come from user input
 * historically, so direct string comparison would miss "CF44 8ER" vs
 * "cf44  8er".
 */
function basePostcodeIsOrigin(
  fromPostcode: string,
  customerBase: string | null | undefined,
): boolean {
  if (!customerBase) return false;
  return normalizePostcode(fromPostcode) === normalizePostcode(customerBase);
}

/**
 * Build the route plan for a load.
 *
 * Rules:
 *   1. Backload → origin = fromPostcode, drops = parsed stops in order.
 *      No "return to base" leg even if returnToBase is true on the row,
 *      because the existing data model treats backload returns as a
 *      separate run.
 *   2. Regular run with a matching customer base postcode → origin =
 *      base, drops = parsed stops in order, optional return-to-base leg.
 *   3. Regular run with stops but no base match (legacy or non-Ashwood) →
 *      origin = first stop, drops = remaining stops. Mirrors the old
 *      behaviour for backwards compatibility.
 *   4. Regular run with no parsed stops → origin = fromPostcode, drops =
 *      [toPostcode] if it's set and different.
 */
export function buildRoutePlan(
  run: Pick<
    PlannedRun,
    "rawText" | "fromPostcode" | "toPostcode" | "runType" | "returnToBase"
  >,
  customerBase: string | null | undefined,
): RoutePlan {
  const stops = parseStops(run.rawText);

  // Case 1 — backload.
  if (run.runType === "backload") {
    const legs: PlanLeg[] = [];
    if (run.fromPostcode) {
      legs.push({
        postcode: run.fromPostcode,
        label: "Pickup",
        stopIndex: null,
        kind: "origin",
      });
    }
    stops.forEach((pc, i) => {
      legs.push({
        postcode: pc,
        label: `Drop ${i + 1}`,
        stopIndex: i,
        kind: "drop",
      });
    });
    return {
      legs,
      hasExplicitOrigin: !!run.fromPostcode,
      dropCount: stops.length,
    };
  }

  // Case 2 — regular run, customer-base style (Ashwood etc).
  if (basePostcodeIsOrigin(run.fromPostcode, customerBase) && stops.length > 0) {
    const legs: PlanLeg[] = [
      {
        postcode: run.fromPostcode,
        label: "Collection",
        stopIndex: null,
        kind: "origin",
      },
      ...stops.map<PlanLeg>((pc, i) => ({
        postcode: pc,
        label: `Drop ${i + 1}`,
        stopIndex: i,
        kind: "drop",
      })),
    ];
    if (run.returnToBase) {
      legs.push({
        postcode: run.fromPostcode,
        label: "Return to base",
        stopIndex: null,
        kind: "return",
      });
    }
    return { legs, hasExplicitOrigin: true, dropCount: stops.length };
  }

  // Case 3 — regular run, stops listed, no base match. Treat first stop
  // as the collection (legacy fallback).
  if (stops.length > 0) {
    const legs: PlanLeg[] = stops.map<PlanLeg>((pc, i) => ({
      postcode: pc,
      label: i === 0 ? "Collection" : `Drop ${i}`,
      stopIndex: i,
      kind: i === 0 ? "origin" : "drop",
    }));
    return {
      legs,
      hasExplicitOrigin: false,
      dropCount: Math.max(0, stops.length - 1),
    };
  }

  // Case 4 — no parsed stops at all. Synthesise a minimal plan.
  const legs: PlanLeg[] = [];
  if (run.fromPostcode) {
    legs.push({
      postcode: run.fromPostcode,
      label: "Collection",
      stopIndex: null,
      kind: "origin",
    });
  }
  if (run.toPostcode && normalizePostcode(run.toPostcode) !== normalizePostcode(run.fromPostcode)) {
    legs.push({
      postcode: run.toPostcode,
      label: "Drop 1",
      stopIndex: null,
      kind: "drop",
    });
  }
  return {
    legs,
    hasExplicitOrigin: !!run.fromPostcode,
    dropCount: legs.filter((l) => l.kind === "drop").length,
  };
}
