/**
 * Tests for the customer-portal `displayDestination` helper. The behaviour
 * here is the difference between "NG22 8TX → NG22 8TX" (round-trip
 * gibberish) and "NG22 8TX → BS20 7XN" (something a customer can actually
 * read), so it's worth locking in the resolution rules.
 */

import { describe, it, expect } from "vitest";
import {
  deliveryEta,
  displayDestination,
  legSiteTimes,
  quickEta,
} from "./loads";
import { normalizePostcode } from "@/lib/postcode-utils";
import { timeToMinutes } from "@/lib/time-utils";
import type { PlannedRun } from "@/types/runs";

function run(p: Partial<PlannedRun>): PlannedRun {
  return {
    id: p.id ?? "id-test",
    jobNumber: p.jobNumber ?? "",
    loadRef: p.loadRef ?? "",
    date: p.date ?? "2026-04-30",
    customer: p.customer ?? "Consolid8",
    vehicle: p.vehicle ?? "",
    fromPostcode: p.fromPostcode ?? "NG22 8TX",
    toPostcode: p.toPostcode ?? "",
    returnToBase: p.returnToBase ?? true,
    startTime: p.startTime ?? "06:00",
    serviceMins: p.serviceMins ?? 25,
    includeBreaks: p.includeBreaks ?? true,
    rawText: p.rawText ?? "",
    runType: p.runType ?? "regular",
    runOrder: p.runOrder ?? null,
    bookingTime: p.bookingTime,
    collectionTime: p.collectionTime,
    completedMeta: p.completedMeta,
    progress: p.progress,
    completedStopIndexes: p.completedStopIndexes,
  };
}

describe("displayDestination", () => {
  it("returns toPostcode when it differs from fromPostcode", () => {
    const r = run({ fromPostcode: "NG22 8TX", toPostcode: "BS20 7XN" });
    expect(displayDestination(r)).toBe("BS20 7XN");
  });

  it("uses the last raw_text stop when toPostcode equals fromPostcode (round trip)", () => {
    // The classic email-forwarded case: returnToBase=true means
    // toPostcode is set back to the origin, but the real delivery is in
    // raw_text.
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "NG22 8TX",
      rawText: "BS20 7XN 09:00",
    });
    expect(displayDestination(r)).toBe("BS20 7XN");
  });

  it("uses the LAST stop when raw_text has multiple stops", () => {
    // For multi-stop runs, the final delivery is the most useful for the
    // table cell — earlier stops might be a yard/staging postcode.
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "NG22 8TX",
      rawText: "WV13 3LH 08:00\nWS10 0BU 11:30\nB78 3HJ 14:00",
    });
    expect(displayDestination(r)).toBe("B78 3HJ");
  });

  it("preserves a friendly label in toPostcode (fixed weekday runs)", () => {
    // The standing fixed-runs materialiser writes the operator-friendly
    // name into to_postcode and the actual postcode into raw_text. The
    // helper must keep showing the label.
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "Tamworth 1",
      rawText: "B78 3HJ",
    });
    expect(displayDestination(r)).toBe("Tamworth 1");
  });

  it("falls back to a single postcode parsed from raw_text when no stops parse", () => {
    // Defensive: the parseStops regex is strict; if rawText is just a bare
    // postcode without a newline (e.g. "B78 3HJ"), parseStops returns an
    // empty array on some inputs. The helper still resolves it via
    // extractPostcode.
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "NG22 8TX",
      rawText: "B78 3HJ",
    });
    expect(displayDestination(r)).toBe("B78 3HJ");
  });

  it("returns toPostcode (possibly empty) when nothing else resolves", () => {
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "NG22 8TX",
      rawText: "",
    });
    expect(displayDestination(r)).toBe("NG22 8TX");
  });

  it("is case-insensitive when comparing fromPostcode and toPostcode", () => {
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "ng22 8tx",
      rawText: "BS20 7XN",
    });
    // Lowercase match should still trigger the round-trip fallback.
    expect(displayDestination(r)).toBe("BS20 7XN");
  });

  it("ignores leading/trailing whitespace on toPostcode", () => {
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "  NG22 8TX  ",
      rawText: "BS20 7XN",
    });
    expect(displayDestination(r)).toBe("BS20 7XN");
  });

  it("handles toPostcode unset", () => {
    const r = run({
      fromPostcode: "NG22 8TX",
      toPostcode: "",
      rawText: "BS20 7XN",
    });
    expect(displayDestination(r)).toBe("BS20 7XN");
  });
});

describe("quickEta", () => {
  // Customer ETA = arrival at delivery. The customer wants to see the
  // booked slot, not the truck's finish-back-at-base time.
  it("uses bookingTime when set", () => {
    const r = run({ startTime: "08:00", bookingTime: "07:00" });
    expect(quickEta(r)).toBe("07:00");
  });

  it("falls back to collectionTime when bookingTime is empty", () => {
    const r = run({ startTime: "08:00", collectionTime: "11:30" });
    expect(quickEta(r)).toBe("11:30");
  });

  it("prefers bookingTime over collectionTime when both present", () => {
    const r = run({
      startTime: "08:00",
      bookingTime: "07:00",
      collectionTime: "06:30",
    });
    expect(quickEta(r)).toBe("07:00");
  });

  it("falls back to startTime when no bookingTime or collectionTime", () => {
    const r = run({ startTime: "08:00" });
    expect(quickEta(r)).toBe("08:00");
  });

  it("returns em-dash when nothing is set", () => {
    const r = run({ startTime: "" });
    expect(quickEta(r)).toBe("—");
  });

  it("ignores whitespace-only bookingTime / collectionTime", () => {
    const r = run({
      startTime: "08:00",
      bookingTime: "   ",
      collectionTime: "   ",
    });
    expect(quickEta(r)).toBe("08:00");
  });
});

describe("deliveryEta", () => {
  // The public shipment tracker shows the consignee at the DROP "when will
  // the lorry be at me?". Unlike quickEta it must never surface the
  // collection time, and once a live position is known it projects a real
  // ETA to the next outstanding stop.

  // A winter date so UTC == UK local (no BST offset) — keeps the
  // minutes-of-day maths deterministic regardless of the runner's tz.
  function nowAt(hhmm: string): Date {
    return new Date(`2026-01-15T${hhmm}:00Z`);
  }
  const coordsFor = (entries: Array<[string, { lat: number; lng: number }]>) =>
    new Map(entries.map(([pc, c]) => [normalizePostcode(pc), c]));

  it("ignores collectionTime — never shows the collection slot as the ETA", () => {
    // The reported bug: an 08:30 'ETA' that was really the 08:30 collection.
    const r = run({
      startTime: "08:30",
      collectionTime: "08:30",
      rawText: "GU11 2HL",
    });
    // No live position, no delivery booking -> baseline startTime, NOT
    // the collectionTime (which here happens to share the value, so assert
    // the resolution path explicitly via a differing startTime below).
    expect(deliveryEta(r)).toBe("08:30");

    const r2 = run({
      startTime: "06:00",
      collectionTime: "08:30",
      rawText: "GU11 2HL",
    });
    expect(deliveryEta(r2)).toBe("06:00");
  });

  it("uses the booked delivery slot (bookingTime) when no live position", () => {
    const r = run({ startTime: "06:00", bookingTime: "14:00", rawText: "GU11 2HL" });
    expect(deliveryEta(r)).toBe("14:00");
  });

  it("falls back to startTime when nothing else is set", () => {
    const r = run({ startTime: "07:15", rawText: "GU11 2HL" });
    expect(deliveryEta(r)).toBe("07:15");
  });

  it("projects a live ETA from the current position to the next stop", () => {
    const r = run({ rawText: "GU11 2HL" });
    // Target ~0.5° north of the truck — a real (non-zero) distance.
    const truckPos = { lat: 51.0, lng: -2.0 };
    const coords = coordsFor([["GU11 2HL", { lat: 51.5, lng: -2.0 }]]);
    const out = deliveryEta(r, { truckPos, coords, now: nowAt("09:00") });
    // Should be a clock time strictly after 09:00 (travel time added).
    const mins = timeToMinutes(out);
    expect(mins).not.toBeNull();
    expect(mins!).toBeGreaterThan(timeToMinutes("09:00")!);
  });

  it("returns 'now' when the truck is effectively at the stop", () => {
    const r = run({ rawText: "GU11 2HL" });
    const at = { lat: 51.2, lng: -1.0 };
    const coords = coordsFor([["GU11 2HL", at]]);
    expect(deliveryEta(r, { truckPos: at, coords, now: nowAt("10:30") })).toBe("10:30");
  });

  it("floors the live ETA at the booked slot (never promises early)", () => {
    const r = run({ bookingTime: "13:00", rawText: "GU11 2HL" });
    const at = { lat: 51.2, lng: -1.0 };
    const coords = coordsFor([["GU11 2HL", at]]);
    // Truck is at the stop and it's only 10:30, but booked for 13:00.
    expect(deliveryEta(r, { truckPos: at, coords, now: nowAt("10:30") })).toBe("13:00");
  });

  it("lets the live ETA move past the booked slot when running late", () => {
    const r = run({ bookingTime: "11:00", rawText: "GU11 2HL" });
    const at = { lat: 51.2, lng: -1.0 };
    const coords = coordsFor([["GU11 2HL", at]]);
    // Already 12:00 and at the stop -> show 12:00, not the passed 11:00 slot.
    expect(deliveryEta(r, { truckPos: at, coords, now: nowAt("12:00") })).toBe("12:00");
  });

  it("projects to the next OUTSTANDING stop on a multi-drop run", () => {
    const r = run({
      rawText: "BS1 1AA\nGU11 2HL",
      completedStopIndexes: [0],
    });
    const at = { lat: 51.2, lng: -1.0 };
    // Only the second stop matters now; truck sitting on it -> 'now'.
    const coords = coordsFor([
      ["BS1 1AA", { lat: 50.0, lng: -3.0 }],
      ["GU11 2HL", at],
    ]);
    expect(deliveryEta(r, { truckPos: at, coords, now: nowAt("14:45") })).toBe("14:45");
  });

  it("falls back to the booked slot when stop coords are missing", () => {
    const r = run({ bookingTime: "15:30", rawText: "GU11 2HL" });
    const truckPos = { lat: 51.0, lng: -2.0 };
    // coords map has no entry for the target -> can't project.
    expect(deliveryEta(r, { truckPos, coords: new Map(), now: nowAt("09:00") })).toBe(
      "15:30",
    );
  });
});

describe("legSiteTimes", () => {
  // The cron at /api/cron/update-progress writes arrivedISO when the
  // vehicle enters the radius and atISO when it leaves. These tests lock
  // in how the customer-portal helper reads that data back so we don't
  // accidentally regress arrived/departed display — customers use those
  // timestamps for their on-time-arrival KPIs.

  // Pin a deterministic local timezone-independent helper. We compare on
  // the HH:MM segment only, which `toTimeString().slice(0, 5)` returns in
  // the runtime's local tz — fine for these tests because we feed in ISO
  // strings whose local rendering is stable across the vitest run.
  function makeIso(hours: number, minutes: number): string {
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  }

  function expectedHHMM(hours: number, minutes: number): string {
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d.toTimeString().slice(0, 5);
  }

  it("returns null fields when stopIndex is null", () => {
    const r = run({});
    const t = legSiteTimes(r, null);
    expect(t).toEqual({
      arrivedAt: null,
      departedAt: null,
      onSite: false,
      onSiteSince: null,
    });
  });

  it("returns null fields when no completed_meta entry exists", () => {
    const r = run({ completedMeta: {} });
    const t = legSiteTimes(r, 0);
    expect(t.arrivedAt).toBeNull();
    expect(t.departedAt).toBeNull();
    expect(t.onSite).toBe(false);
  });

  it("formats arrivedISO and atISO into HH:MM", () => {
    const r = run({
      completedMeta: {
        0: {
          arrivedISO: makeIso(10, 23),
          atISO: makeIso(11, 8),
          by: "auto",
        },
      },
    });
    const t = legSiteTimes(r, 0);
    expect(t.arrivedAt).toBe(expectedHHMM(10, 23));
    expect(t.departedAt).toBe(expectedHHMM(11, 8));
    expect(t.onSite).toBe(false);
  });

  it("flags on-site when progress.onSiteIdx matches", () => {
    const since = Date.now() - 5 * 60_000;
    const r = run({
      completedMeta: {
        0: { arrivedISO: makeIso(10, 23), by: "auto" },
      },
      progress: {
        completedIdx: [],
        onSiteIdx: 0,
        onSiteSinceMs: since,
        lastInside: true,
      },
    });
    const t = legSiteTimes(r, 0);
    expect(t.onSite).toBe(true);
    expect(t.onSiteSince).not.toBeNull();
    expect(t.arrivedAt).toBe(expectedHHMM(10, 23));
    expect(t.departedAt).toBeNull();
  });

  it("does NOT flag on-site for a different stop's index", () => {
    const r = run({
      progress: {
        completedIdx: [],
        onSiteIdx: 2,
        onSiteSinceMs: Date.now(),
        lastInside: true,
      },
    });
    expect(legSiteTimes(r, 0).onSite).toBe(false);
    expect(legSiteTimes(r, 2).onSite).toBe(true);
  });

  it("clears onSiteSince when not on-site", () => {
    const r = run({
      progress: {
        completedIdx: [],
        onSiteIdx: 1,
        onSiteSinceMs: Date.now(),
        lastInside: true,
      },
    });
    // Stop 0 isn't the current onSite stop -> onSiteSince should be null
    // even though progress carries a timestamp for the OTHER stop.
    expect(legSiteTimes(r, 0).onSiteSince).toBeNull();
  });

  it("handles malformed ISO strings gracefully", () => {
    const r = run({
      completedMeta: {
        0: { arrivedISO: "not-a-date", atISO: "also-bad", by: "auto" },
      },
    });
    const t = legSiteTimes(r, 0);
    expect(t.arrivedAt).toBeNull();
    expect(t.departedAt).toBeNull();
  });
});
