/**
 * Tests for the customer-portal stacked-load chaining helper.
 *
 * The dispatch planner's stacked-runs behaviour is the source of truth for
 * how chained start times should work — these tests lock in feature parity
 * for the customer side.
 */

import { describe, it, expect } from "vitest";
import { computeLoadChains, chainedEta } from "./load-chains";
import type { PlannedRun } from "@/types/runs";

function load(p: Partial<PlannedRun>): PlannedRun {
  return {
    id: p.id ?? `id-${Math.random().toString(36).slice(2)}`,
    jobNumber: p.jobNumber ?? "",
    loadRef: p.loadRef ?? "",
    date: p.date ?? "2026-04-27",
    customer: p.customer ?? "ASHWOOD",
    vehicle: p.vehicle ?? "B7MLC",
    fromPostcode: p.fromPostcode ?? "NG22 8TX",
    toPostcode: p.toPostcode ?? "B78 3HJ",
    returnToBase: p.returnToBase ?? true,
    startTime: p.startTime ?? "08:00",
    serviceMins: p.serviceMins ?? 25,
    includeBreaks: p.includeBreaks ?? true,
    rawText: p.rawText ?? "B78 3HJ",
    runType: p.runType ?? "regular",
    runOrder: p.runOrder ?? null,
    collectionTime: p.collectionTime,
    bookingTime: p.bookingTime,
  };
}

describe("computeLoadChains — grouping", () => {
  it("returns no chain entries for a single-load group", () => {
    const chains = computeLoadChains([load({ id: "a" })]);
    expect(chains.size).toBe(0);
  });

  it("returns no chain entries for loads with no vehicle", () => {
    const chains = computeLoadChains([
      load({ id: "a", vehicle: "" }),
      load({ id: "b", vehicle: "" }),
    ]);
    expect(chains.size).toBe(0);
  });

  it("does not chain loads on different dates even with same vehicle", () => {
    const chains = computeLoadChains([
      load({ id: "a", date: "2026-04-27", vehicle: "B7MLC" }),
      load({ id: "b", date: "2026-04-28", vehicle: "B7MLC" }),
    ]);
    expect(chains.size).toBe(0);
  });

  it("does not chain loads on different vehicles same date", () => {
    const chains = computeLoadChains([
      load({ id: "a", vehicle: "B7MLC" }),
      load({ id: "b", vehicle: "C12MLC" }),
    ]);
    expect(chains.size).toBe(0);
  });

  it("chains loads on the same vehicle+date", () => {
    const chains = computeLoadChains([
      load({ id: "leg1", startTime: "08:00", rawText: "B78 3HJ" }),
      load({ id: "leg2", startTime: "08:00", rawText: "B78 3HJ" }),
    ]);
    // Both rows present (the helper writes leg-1 with its own start, leg-2
    // with the chained start).
    expect(chains.size).toBe(2);
    expect(chains.get("leg2")?.chainedStartTime).not.toBe("08:00");
  });
});

describe("computeLoadChains — sort within group", () => {
  it("manual runOrder beats startTime", () => {
    // leg2 has runOrder=0 → must come first even though startTime is later
    const chains = computeLoadChains([
      load({ id: "leg1", startTime: "08:00", runOrder: 1 }),
      load({ id: "leg2", startTime: "12:00", runOrder: 0 }),
    ]);
    // After sorting [leg2, leg1], leg2 is first → its chained = its own start;
    // leg1 is the chained one.
    expect(chains.get("leg2")?.chainedStartTime).toBe("12:00");
    expect(chains.get("leg1")?.chainedStartTime).not.toBe("08:00");
  });

  it("falls back to startTime when runOrder is null on both", () => {
    const chains = computeLoadChains([
      load({ id: "later", startTime: "12:00" }),
      load({ id: "earlier", startTime: "08:00" }),
    ]);
    // earlier sorts first → its chained = its own start
    expect(chains.get("earlier")?.chainedStartTime).toBe("08:00");
    expect(chains.get("later")?.chainedStartTime).not.toBe("12:00");
  });
});

describe("computeLoadChains — collection time semantics", () => {
  it("first leg uses collectionTime as effective start when set", () => {
    const chains = computeLoadChains([
      load({ id: "leg1", startTime: "08:00", collectionTime: "10:00" }),
      load({ id: "leg2", startTime: "08:00" }),
    ]);
    expect(chains.get("leg1")?.chainedStartTime).toBe("10:00");
  });

  it("subsequent leg with collectionTime takes the later of arrival vs booking", () => {
    // leg1 finishes around 11-ish; leg2 has a 14:00 collection → leg2 should
    // be 14:00, not the earlier "arrival from leg1" time.
    const chains = computeLoadChains([
      load({ id: "leg1", startTime: "08:00", rawText: "B78 3HJ" }),
      load({ id: "leg2", startTime: "08:00", collectionTime: "14:00" }),
    ]);
    expect(chains.get("leg2")?.chainedStartTime).toBe("14:00");
  });

  it("uses the chain arrival when it's later than the collection time", () => {
    // leg1 has many stops → finishes very late; leg2 collection is "early"
    // → effective leg2 start should be the chain arrival, not the earlier
    // booking.
    const earlyBooking = "08:30";
    const chains = computeLoadChains([
      load({
        id: "leg1",
        startTime: "08:00",
        rawText: "B78 3HJ\nNW10 7NZ\nBS20 7XN\nNG22 8TX\nWS10 0BU\nWV13 3LH",
      }),
      load({ id: "leg2", startTime: "08:00", collectionTime: earlyBooking }),
    ]);
    // The chain arrival should be later than 08:30 because leg1 has 6 stops.
    const leg2Start = chains.get("leg2")?.chainedStartTime ?? "";
    expect(leg2Start.localeCompare(earlyBooking)).toBeGreaterThan(0);
  });
});

describe("computeLoadChains — coords parity with normalizePostcode", () => {
  // The coords map produced by usePostcodeCoords is keyed by the canonical
  // "with-space" form (e.g. "B78 3HJ"). estimateTravelMins should resolve
  // that, AND the legacy no-space form ("B783HJ"), so existing call sites
  // with either shape continue to work.
  it("looks up coords using normalised (space-bearing) keys", () => {
    const chains = computeLoadChains(
      [
        load({ id: "leg1", fromPostcode: "B78 3HJ", rawText: "B78 3HJ" }),
        load({ id: "leg2", fromPostcode: "B78 3HJ", rawText: "B78 3HJ" }),
      ],
      {
        "B78 3HJ": { lat: 52.6, lng: -1.7 },
      },
    );
    // Both legs share the same postcode, so travel time should be 0 → leg2
    // should not get the +30-minute fallback travel.
    const leg1FinishWith30Fallback = "10:50";
    const leg2 = chains.get("leg2")!.chainedStartTime;
    expect(leg2.localeCompare(leg1FinishWith30Fallback)).toBeLessThan(0);
  });

  it("also resolves legacy no-space coord keys", () => {
    const chains = computeLoadChains(
      [
        load({ id: "leg1", fromPostcode: "B78 3HJ", rawText: "B78 3HJ" }),
        load({ id: "leg2", fromPostcode: "B78 3HJ", rawText: "B78 3HJ" }),
      ],
      {
        // legacy callers stripped spaces; the lookup must tolerate that
        B783HJ: { lat: 52.6, lng: -1.7 },
      },
    );
    const leg1FinishWith30Fallback = "10:50";
    const leg2 = chains.get("leg2")!.chainedStartTime;
    expect(leg2.localeCompare(leg1FinishWith30Fallback)).toBeLessThan(0);
  });
});

describe("chainedEta", () => {
  // Customer ETA = arrival at delivery, not finish-back-at-base. The chain
  // already represents arrival, so chainedEta returns it verbatim.
  it("returns the chain's chainedStartTime when chained", () => {
    const r = load({ id: "leg2", startTime: "08:00" });
    const chained = {
      chainedStartTime: "11:30",
      chainedFromPostcode: "B78 3HJ",
    };
    expect(chainedEta(r, chained)).toBe("11:30");
  });

  it("falls back to bookingTime when not chained", () => {
    const r = load({ startTime: "08:00", bookingTime: "07:00" });
    expect(chainedEta(r, undefined)).toBe("07:00");
  });

  it("falls back to collectionTime when no bookingTime", () => {
    const r = load({ startTime: "08:00", collectionTime: "07:30" });
    expect(chainedEta(r, undefined)).toBe("07:30");
  });

  it("falls back to startTime when nothing else is set", () => {
    const r = load({ startTime: "08:00" });
    expect(chainedEta(r, undefined)).toBe("08:00");
  });

  it("ignores bookingTime when a chain is present (chain wins)", () => {
    // The chain already accounts for booking floors via computeChainedStarts,
    // so chainedEta trusts the chain output and doesn't second-guess it.
    const r = load({ startTime: "08:00", bookingTime: "07:00" });
    const chained = {
      chainedStartTime: "12:27",
      chainedFromPostcode: "B78 3HJ",
    };
    expect(chainedEta(r, chained)).toBe("12:27");
  });
});
