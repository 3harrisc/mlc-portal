import { describe, it, expect } from "vitest";
import {
  isoWeekNum,
  isoYear,
  isoWeeksInYear,
  isoWeekMonday,
  isoWeekReference,
} from "./iso-week";

describe("isoWeekNum", () => {
  // Reference values cross-checked against ISO 8601 / Excel WEEKNUM(...,21).
  it("returns 1 for the year's first ISO week", () => {
    expect(isoWeekNum(new Date(Date.UTC(2024, 0, 1)))).toBe(1);
    expect(isoWeekNum(new Date(Date.UTC(2025, 0, 1)))).toBe(1);
  });

  it("returns 39 for 22 Sep 2025 (the planner's WK39 example)", () => {
    expect(isoWeekNum(new Date(Date.UTC(2025, 8, 22)))).toBe(39);
  });

  it("treats early Jan that belongs to last year's W52/W53 correctly", () => {
    // 1 Jan 2023 is a Sunday → W52 of 2022.
    expect(isoWeekNum(new Date(Date.UTC(2023, 0, 1)))).toBe(52);
  });

  it("treats late Dec that belongs to next year's W1 correctly", () => {
    // 31 Dec 2024 is a Tuesday → W1 of 2025.
    expect(isoWeekNum(new Date(Date.UTC(2024, 11, 31)))).toBe(1);
  });

  it("knows about W53 years", () => {
    // 2020 has 53 ISO weeks.
    expect(isoWeekNum(new Date(Date.UTC(2020, 11, 31)))).toBe(53);
  });
});

describe("isoYear", () => {
  it("rolls back to the previous year for early Jan in last year's W52/W53", () => {
    expect(isoYear(new Date(Date.UTC(2023, 0, 1)))).toBe(2022);
  });

  it("rolls forward to the next year for late Dec in next year's W1", () => {
    expect(isoYear(new Date(Date.UTC(2024, 11, 31)))).toBe(2025);
  });

  it("returns the calendar year mid-year", () => {
    expect(isoYear(new Date(Date.UTC(2025, 5, 15)))).toBe(2025);
  });
});

describe("isoWeeksInYear", () => {
  it("returns 53 for known long ISO years", () => {
    // 2015, 2020, 2026 are 53-week years.
    expect(isoWeeksInYear(2015)).toBe(53);
    expect(isoWeeksInYear(2020)).toBe(53);
    expect(isoWeeksInYear(2026)).toBe(53);
  });

  it("returns 52 for typical years", () => {
    expect(isoWeeksInYear(2024)).toBe(52);
    expect(isoWeeksInYear(2025)).toBe(52);
  });
});

describe("isoWeekMonday", () => {
  it("returns the Monday of W39 2025 = 2025-09-22", () => {
    expect(isoWeekMonday(2025, 39)).toBe("2025-09-22");
  });

  it("returns the Monday of W1 2024 = 2024-01-01", () => {
    expect(isoWeekMonday(2024, 1)).toBe("2024-01-01");
  });

  it("returns the Monday of W1 2025 = 2024-12-30", () => {
    // 2025 ISO week 1 starts on Mon 30 Dec 2024.
    expect(isoWeekMonday(2025, 1)).toBe("2024-12-30");
  });
});

describe("isoWeekReference", () => {
  it("matches the legacy VBA referenceText format", () => {
    expect(isoWeekReference(2025, 39)).toBe("Week 39 (2025)");
  });
});
