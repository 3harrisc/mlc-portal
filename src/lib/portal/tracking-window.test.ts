/**
 * The regression these tests exist for: load bg8go31o (Ashwood Z33-14) was a
 * Wales → East Anglia trip stamped 2026-08-18. It tracked fine on the 19th,
 * then at midnight on the 20th fell out of the cron's two-day window with 8
 * of 10 drops outstanding. The truck kept reporting; nothing was listening.
 */

import { describe, it, expect } from "vitest";
import {
  addDaysISO,
  isTrackable,
  lastTrackedDay,
  MAX_TRIP_LOOKBACK_DAYS,
} from "./tracking-window";

const today = "2026-08-20";
const yesterday = "2026-08-19";

/** Defaults to the interesting case: unfinished, so guards are exercised. */
function ask(over: Partial<Parameters<typeof isTrackable>[0]> = {}) {
  return isTrackable({
    date: today,
    hasUncompletedStops: true,
    today,
    yesterday,
    ...over,
  });
}

describe("addDaysISO", () => {
  it("adds days", () => {
    expect(addDaysISO("2026-08-18", 2)).toBe("2026-08-20");
  });

  it("subtracts days", () => {
    expect(addDaysISO("2026-08-20", -14)).toBe("2026-08-06");
  });

  it("crosses a month boundary", () => {
    expect(addDaysISO("2026-08-30", 3)).toBe("2026-09-02");
  });

  it("crosses the BST/GMT change without slipping a day", () => {
    // Clocks go back on 2026-10-25. Date-only maths must not care.
    expect(addDaysISO("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("returns the input unchanged when it isn't a date", () => {
    expect(addDaysISO("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("lastTrackedDay", () => {
  it("counts days, not offsets — a 3-day trip from the 18th ends on the 20th", () => {
    expect(lastTrackedDay("2026-08-18", 3)).toBe("2026-08-20");
  });

  it("treats a missing count as a single day", () => {
    expect(lastTrackedDay("2026-08-18", null)).toBe("2026-08-18");
  });

  it("treats a count of 1 as a single day", () => {
    expect(lastTrackedDay("2026-08-18", 1)).toBe("2026-08-18");
  });

  it("ignores a nonsensical count", () => {
    expect(lastTrackedDay("2026-08-18", 0)).toBe("2026-08-18");
    expect(lastTrackedDay("2026-08-18", -5)).toBe("2026-08-18");
  });
});

describe("isTrackable — behaviour that existed before day_count", () => {
  it("tracks today's run", () => {
    expect(ask({ date: today })).toBe(true);
  });

  it("tracks today's run even when every stop is done", () => {
    // Late completions and the return-to-base leg still need to register.
    expect(ask({ date: today, hasUncompletedStops: false })).toBe(true);
  });

  it("tracks yesterday's unfinished run", () => {
    expect(ask({ date: yesterday })).toBe(true);
  });

  it("drops yesterday's finished run", () => {
    expect(ask({ date: yesterday, hasUncompletedStops: false })).toBe(false);
  });

  it("tracks a cross-day backload collecting today", () => {
    expect(ask({ date: "2026-08-25", collectionDate: today })).toBe(true);
  });

  it("drops a two-day-old run with no day_count — the original bug", () => {
    expect(ask({ date: "2026-08-18" })).toBe(false);
  });
});

describe("isTrackable — multi-day trips", () => {
  it("tracks day three of a three-day trip", () => {
    // The exact shape of the Ashwood run that went stale.
    expect(ask({ date: "2026-08-18", dayCount: 3 })).toBe(true);
  });

  it("tracks the middle day of a long trip", () => {
    expect(ask({ date: "2026-08-17", dayCount: 5 })).toBe(true);
  });

  it("drops the trip the day after it should have finished", () => {
    // 3 days from the 17th ends on the 19th; today is the 20th.
    expect(ask({ date: "2026-08-17", dayCount: 3 })).toBe(false);
  });

  it("drops a multi-day trip once every stop is done", () => {
    expect(
      ask({ date: "2026-08-18", dayCount: 3, hasUncompletedStops: false }),
    ).toBe(false);
  });

  it("does not resurrect a run dated in the future", () => {
    expect(ask({ date: "2026-08-25", dayCount: 3 })).toBe(false);
  });

  it("refuses a trip older than the lookback backstop", () => {
    // A typo'd day_count must not keep a row tracked forever.
    const ancient = addDaysISO(today, -(MAX_TRIP_LOOKBACK_DAYS + 1));
    expect(ask({ date: ancient, dayCount: 999 })).toBe(false);
  });

  it("still accepts a trip exactly on the backstop boundary", () => {
    const oldest = addDaysISO(today, -MAX_TRIP_LOOKBACK_DAYS);
    expect(ask({ date: oldest, dayCount: 999 })).toBe(true);
  });

  it("does not let day_count override the finished check on yesterday", () => {
    expect(
      ask({ date: yesterday, dayCount: 4, hasUncompletedStops: false }),
    ).toBe(false);
  });
});
