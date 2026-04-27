import { describe, it, expect } from "vitest";
import {
  calculateDueDate,
  endOfMonth,
  parseISODate,
  toISODate,
  toXeroDate,
} from "./due-date";

describe("parseISODate", () => {
  it("parses a yyyy-MM-dd at UTC midnight", () => {
    const d = parseISODate("2025-09-22");
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(8); // September = month 8
    expect(d.getUTCDate()).toBe(22);
    expect(d.getUTCHours()).toBe(0);
  });

  it("throws on garbage input", () => {
    expect(() => parseISODate("not a date")).toThrow();
    expect(() => parseISODate("")).toThrow();
  });
});

describe("toXeroDate", () => {
  it("formats as dd/MM/yyyy", () => {
    expect(toXeroDate("2025-09-22")).toBe("22/09/2025");
    expect(toXeroDate("2025-01-01")).toBe("01/01/2025");
    expect(toXeroDate("2025-12-31")).toBe("31/12/2025");
  });
});

describe("toISODate", () => {
  it("formats a UTC Date as yyyy-MM-dd", () => {
    const d = new Date(Date.UTC(2025, 8, 22));
    expect(toISODate(d)).toBe("2025-09-22");
  });
});

describe("endOfMonth", () => {
  it("returns the last day of a 30-day month", () => {
    expect(toISODate(endOfMonth(parseISODate("2025-09-15")))).toBe("2025-09-30");
  });

  it("returns the last day of a 31-day month", () => {
    expect(toISODate(endOfMonth(parseISODate("2025-10-15")))).toBe("2025-10-31");
  });

  it("returns Feb 28 in a non-leap year", () => {
    expect(toISODate(endOfMonth(parseISODate("2025-02-15")))).toBe("2025-02-28");
  });

  it("returns Feb 29 in a leap year", () => {
    expect(toISODate(endOfMonth(parseISODate("2024-02-15")))).toBe("2024-02-29");
  });
});

describe("calculateDueDate", () => {
  it("net-30 from end-of-month", () => {
    // Invoice Sep 22 → EOM Sep 30 → +30 days = Oct 30.
    expect(toISODate(calculateDueDate("2025-09-22", 30))).toBe("2025-10-30");
  });

  it("zero dueDays = end of invoice month", () => {
    expect(toISODate(calculateDueDate("2025-09-22", 0))).toBe("2025-09-30");
  });

  it("works when invoice date is itself the last day of the month", () => {
    expect(toISODate(calculateDueDate("2025-09-30", 30))).toBe("2025-10-30");
  });

  it("crosses year boundary correctly", () => {
    // Invoice Dec 1 → EOM Dec 31 → +30 days = Jan 30 next year.
    expect(toISODate(calculateDueDate("2025-12-01", 30))).toBe("2026-01-30");
  });

  it("handles February in a leap year", () => {
    expect(toISODate(calculateDueDate("2024-02-15", 30))).toBe("2024-03-30");
  });

  it("handles February in a non-leap year", () => {
    expect(toISODate(calculateDueDate("2025-02-15", 30))).toBe("2025-03-30");
  });

  it("rejects negative due-days", () => {
    expect(() => calculateDueDate("2025-09-22", -1)).toThrow();
  });

  it("rejects non-integer due-days", () => {
    expect(() => calculateDueDate("2025-09-22", 30.5)).toThrow();
  });

  it("accepts a Date object as well as a string", () => {
    const d = parseISODate("2025-09-22");
    expect(toISODate(calculateDueDate(d, 30))).toBe("2025-10-30");
  });
});
