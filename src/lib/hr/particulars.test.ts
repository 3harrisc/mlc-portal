import { describe, expect, it } from "vitest";
import { cleanDriverDetails, cleanEmploymentDates } from "./particulars";

describe("cleanDriverDetails", () => {
  it("tidies name spacing and joins address lines", () => {
    expect(cleanDriverDetails("  Sam   Driver ", "1 High St\n Cheltenham,\nGL50 1AA ")).toEqual({
      legalName: "Sam Driver",
      address: "1 High St, Cheltenham, GL50 1AA",
    });
  });

  it("rejects missing details", () => {
    expect(() => cleanDriverDetails("S", "1 High St, GL50 1AA")).toThrow(/legal name/);
    expect(() => cleanDriverDetails("Sam Driver", "")).toThrow(/address/);
  });
});

describe("cleanEmploymentDates", () => {
  it("defaults continuous employment to the start date", () => {
    expect(cleanEmploymentDates("2026-10-05", "")).toEqual({ startDate: "2026-10-05", continuousDate: "2026-10-05" });
  });

  it("allows an earlier continuous date (e.g. a transfer)", () => {
    expect(cleanEmploymentDates("2026-10-05", "2024-01-15").continuousDate).toBe("2024-01-15");
  });

  it("rejects invalid or inconsistent dates", () => {
    expect(() => cleanEmploymentDates("2026-02-30", "")).toThrow(/start date/);
    expect(() => cleanEmploymentDates("", "")).toThrow(/start date/);
    expect(() => cleanEmploymentDates("2026-10-05", "2026-11-01")).toThrow(/can't be after/);
  });
});
