/**
 * Tests for the customer-portal `displayDestination` helper. The behaviour
 * here is the difference between "NG22 8TX → NG22 8TX" (round-trip
 * gibberish) and "NG22 8TX → BS20 7XN" (something a customer can actually
 * read), so it's worth locking in the resolution rules.
 */

import { describe, it, expect } from "vitest";
import { displayDestination, quickEta } from "./loads";
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
