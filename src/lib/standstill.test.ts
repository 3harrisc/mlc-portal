import { describe, it, expect } from "vitest";
import type { ProgressState } from "@/types/runs";
import type { LngLat } from "@/lib/geo-utils";
import { updateStandstillAnchor, matchStandstillToStop } from "./standstill";

// Real coordinates from load MLC-20260713-001 (14 July 2026), where three
// drops were missed because the truck dwelled outside the 800m geofence.
const AB53_4AA: LngLat = { lat: 57.537747, lng: -2.460129 }; // drop centroid
const TURRIFF_SITE: LngLat = { lat: 57.53469, lng: -2.48166 }; // real dwell, 1329m away
const AB51_5QW: LngLat = { lat: 57.28449, lng: -2.404611 };
const FAR_AWAY: LngLat = { lat: 56.2, lng: -3.4 }; // overnight parking

const MIN = 60_000;

function progress(over: Partial<ProgressState> = {}): ProgressState {
  return {
    completedIdx: [],
    onSiteIdx: null,
    onSiteSinceMs: null,
    lastInside: false,
    ...over,
  };
}

function coords(): Map<string, LngLat> {
  return new Map([
    ["AB53 4AA", AB53_4AA],
    ["AB51 5QW", AB51_5QW],
  ]);
}

const STOPS = ["AB53 4AA", "AB51 5QW"];

describe("updateStandstillAnchor", () => {
  it("sets the anchor on first fix", () => {
    const p = progress();
    const dep = updateStandstillAnchor(p, TURRIFF_SITE, 1000);
    expect(dep).toBeNull();
    expect(p.stillLat).toBe(TURRIFF_SITE.lat);
    expect(p.stillLng).toBe(TURRIFF_SITE.lng);
    expect(p.stillSinceMs).toBe(1000);
  });

  it("keeps the anchor while the vehicle holds position (GPS drift)", () => {
    const p = progress();
    updateStandstillAnchor(p, TURRIFF_SITE, 1000);
    const drifted: LngLat = {
      lat: TURRIFF_SITE.lat + 0.0005, // ~55m north
      lng: TURRIFF_SITE.lng,
    };
    updateStandstillAnchor(p, drifted, 1000 + 10 * MIN);
    expect(p.stillSinceMs).toBe(1000); // dwell clock not reset
  });

  it("resets the anchor when the vehicle moves off", () => {
    const p = progress();
    updateStandstillAnchor(p, TURRIFF_SITE, 1000);
    const dep = updateStandstillAnchor(p, AB53_4AA, 1000 + 20 * MIN);
    expect(dep).toBeNull(); // no stop was matched, nothing to stamp
    expect(p.stillSinceMs).toBe(1000 + 20 * MIN);
  });

  it("returns the departure when leaving a matched standstill", () => {
    const p = progress({
      stillLat: TURRIFF_SITE.lat,
      stillLng: TURRIFF_SITE.lng,
      stillSinceMs: 1000,
      stillStopIdx: 0,
      completedIdx: [0],
    });
    const dep = updateStandstillAnchor(p, AB53_4AA, 1000 + 30 * MIN);
    expect(dep).toEqual({ idx: 0, arrivedMs: 1000 });
    expect(p.stillStopIdx).toBeNull();
  });
});

describe("matchStandstillToStop", () => {
  function anchoredAt(ll: LngLat, sinceMs: number): ProgressState {
    return progress({ stillLat: ll.lat, stillLng: ll.lng, stillSinceMs: sinceMs });
  }

  it("completes the nearest uncompleted stop after the dwell threshold", () => {
    const p = anchoredAt(TURRIFF_SITE, 0);
    const idx = matchStandstillToStop({
      p,
      stops: STOPS,
      coords: coords(),
      uncompletedIdxs: [0, 1],
      nowMs: 10 * MIN,
    });
    expect(idx).toBe(0); // AB53 4AA at 1329m beats AB51 5QW at ~28km
    expect(p.completedIdx).toEqual([0]);
    expect(p.stillStopIdx).toBe(0);
  });

  it("does nothing before the dwell threshold", () => {
    const p = anchoredAt(TURRIFF_SITE, 0);
    const idx = matchStandstillToStop({
      p,
      stops: STOPS,
      coords: coords(),
      uncompletedIdxs: [0, 1],
      nowMs: 5 * MIN,
    });
    expect(idx).toBeNull();
    expect(p.completedIdx).toEqual([]);
  });

  it("does nothing when every stop is beyond the match radius", () => {
    const p = anchoredAt(FAR_AWAY, 0);
    const idx = matchStandstillToStop({
      p,
      stops: STOPS,
      coords: coords(),
      uncompletedIdxs: [0, 1],
      nowMs: 60 * MIN,
    });
    expect(idx).toBeNull();
  });

  it("matches at most one stop per standstill", () => {
    const p = anchoredAt(TURRIFF_SITE, 0);
    matchStandstillToStop({
      p,
      stops: STOPS,
      coords: coords(),
      uncompletedIdxs: [0, 1],
      nowMs: 10 * MIN,
    });
    const second = matchStandstillToStop({
      p,
      stops: STOPS,
      coords: coords(),
      uncompletedIdxs: [1],
      nowMs: 40 * MIN,
    });
    expect(second).toBeNull();
    expect(p.completedIdx).toEqual([0]);
  });

  it("skips stops completed earlier in the same tick", () => {
    const p = anchoredAt(TURRIFF_SITE, 0);
    p.completedIdx = [0]; // geofence path completed it moments ago
    const idx = matchStandstillToStop({
      p,
      stops: STOPS,
      coords: coords(),
      uncompletedIdxs: [0, 1], // caller's list computed before that completion
      nowMs: 10 * MIN,
    });
    expect(idx).toBeNull(); // AB51 5QW is ~28km away, out of radius
    expect(p.completedIdx).toEqual([0]);
  });
});
