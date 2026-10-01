import { describe, expect, it } from "vitest";
import { cleanDriverInput } from "./driver-validate";

describe("cleanDriverInput", () => {
  it("tidies values and normalises NI numbers and postcodes", () => {
    const out = cleanDriverInput({
      firstNames: " Sam ", surname: "Driver", niNumber: "ab 12 34 56 c", postcode: "gl50 1aa",
      startDate: "2026-10-05", email: "", status: "starter",
    });
    expect(out).toMatchObject({ first_names: "Sam", ni_number: "AB123456C", postcode: "GL50 1AA", start_date: "2026-10-05", email: null });
  });

  it("rejects bad input with readable messages", () => {
    expect(() => cleanDriverInput({ firstNames: "", surname: "X" })).toThrow(/required/);
    expect(() => cleanDriverInput({ firstNames: "A", surname: "B", niNumber: "123" })).toThrow(/National Insurance/);
    expect(() => cleanDriverInput({ firstNames: "A", surname: "B", startDate: "05/10/2026" })).toThrow(/Start date/);
    expect(() => cleanDriverInput({ firstNames: "A", surname: "B", startDate: "2026-10-05", continuousEmploymentDate: "2026-11-01" })).toThrow(/after the start/);
  });
});
