/**
 * Stop-line parsing. The raw_text line format is the storage layer for
 * every stop in the system, so its edge cases are worth pinning down —
 * especially the back-compat guarantee that adding a window to a line
 * doesn't change what the pre-existing `parseStopTime` returns.
 */

import { describe, it, expect } from "vitest";
import { parseStopTime, parseStopWindow, parseStopsWithTimes } from "./postcode-utils";

describe("parseStopWindow", () => {
  it("returns null for a point booking", () => {
    expect(parseStopWindow("NG22 8TX 08:00")).toBeNull();
  });

  it("parses a hyphenated range", () => {
    expect(parseStopWindow("NG22 8TX 08:00-12:00")).toEqual({
      from: "08:00",
      to: "12:00",
    });
  });

  it("tolerates spaces and an en-dash", () => {
    expect(parseStopWindow("NG22 8TX 08:00 – 12:00")).toEqual({
      from: "08:00",
      to: "12:00",
    });
  });

  it("zero-pads a single-digit hour", () => {
    expect(parseStopWindow("NG22 8TX 8:00-9:30")).toEqual({
      from: "08:00",
      to: "09:30",
    });
  });

  it("ignores ranges that appear inside REF: or ADDR: metadata", () => {
    expect(
      parseStopWindow("NG22 8TX 08:00 REF:10:00-11:00 ADDR:Unit 4"),
    ).toBeNull();
  });

  it("returns null for a malformed end time", () => {
    expect(parseStopWindow("NG22 8TX 08:00-25:00")).toBeNull();
  });

  it("returns null when the line has no time at all", () => {
    expect(parseStopWindow("NG22 8TX REF:FC1")).toBeNull();
  });
});

describe("parseStopTime back-compat", () => {
  it("still returns the start of a window", () => {
    expect(parseStopTime("NG22 8TX 08:00-12:00")).toBe("08:00");
  });

  it("is unchanged for a point booking", () => {
    expect(parseStopTime("NG22 8TX 12:30 REF:FC156297")).toBe("12:30");
  });
});

describe("parseStopsWithTimes", () => {
  it("populates windowEnd only for stops that carry a range", () => {
    const raw = ["NG22 8TX 08:00-12:00", "BS20 7XN 14:00", "GU11 2HL"].join("\n");
    expect(parseStopsWithTimes(raw)).toEqual([
      { postcode: "NG22 8TX", time: "08:00", windowEnd: "12:00" },
      { postcode: "BS20 7XN", time: "14:00", windowEnd: null },
      { postcode: "GU11 2HL", time: null, windowEnd: null },
    ]);
  });

  it("resolves time and windowEnd from the same range", () => {
    // A stray time before a range must not produce a window that closes
    // before it opens — `time` is the range's start, not the first HH:MM.
    expect(parseStopsWithTimes("NG22 8TX 14:00 08:00-12:00")).toEqual([
      { postcode: "NG22 8TX", time: "08:00", windowEnd: "12:00" },
    ]);
  });
});
