import { describe, expect, it } from "vitest";
import {
  driverFieldsFromLicence,
  licenceChanges,
  licenceFlags,
  titleCase,
  toIsoDate,
  type LicenceCheck,
} from "./licence";

// Fictional driver, laid out like a real AssetGo check.
const check = (over: Partial<LicenceCheck> = {}): LicenceCheck => ({
  check_number: "10001",
  checked_on: "2026-09-01",
  surname: "O'NEIL-JONES",
  forenames: "SAMUEL JAMES",
  gender: "Male",
  date_of_birth: "1990-05-14",
  address_lines: ["12 HIGH STREET", "CHARLTON KINGS", "CHELTENHAM"],
  postcode: "gl53 8aa",
  licence_number: "ONEIL905140SJ9AB",
  issue_number: "12",
  licence_status: "VALID",
  photocard_expiry: "2030-05-13",
  disqualified: false,
  categories: [
    { code: "B", status: "Full", valid_from: "2008-06-01", valid_to: "2060-05-13", restriction_codes: [] },
    { code: "C", status: "Full", valid_from: "2015-03-01", valid_to: "2035-05-13", restriction_codes: [] },
    { code: "CE", status: "Full", valid_from: "2016-03-01", valid_to: "2035-05-13", restriction_codes: [] },
  ],
  endorsements: [],
  total_points: 0,
  tacho_card: { number: "DB000000000001", status: "ISSUED", valid_from: "2025-01-01", expiry: "2029-12-31" },
  cpc: { lgv_valid_to: "2029-09-01", pcv_valid_to: null },
  ...over,
});
const TODAY = new Date("2026-10-01T09:00:00Z");

describe("formatting", () => {
  it("title-cases names and normalises dates", () => {
    expect(titleCase("O'NEIL-JONES")).toBe("O'Neil-Jones");
    expect(toIsoDate("20-04-2028")).toBe("2028-04-20");
    expect(toIsoDate("5/4/2025")).toBe("2025-04-05");
    expect(toIsoDate("2025-04-05")).toBe("2025-04-05");
    expect(toIsoDate("-")).toBeNull();
  });

  it("maps a check onto driver record fields", () => {
    expect(driverFieldsFromLicence(check())).toEqual({
      firstNames: "Samuel James",
      surname: "O'Neil-Jones",
      dateOfBirth: "1990-05-14",
      address: "12 High Street, Charlton Kings, Cheltenham",
      postcode: "GL53 8AA",
    });
  });
});

describe("licenceFlags", () => {
  it("raises nothing for a clean, experienced driver", () => {
    expect(licenceFlags(check(), TODAY)).toEqual([]);
  });

  it("flags points, expiries, missing C+E and new C+E holders", () => {
    const flags = licenceFlags(
      check({
        total_points: 6,
        photocard_expiry: "2026-11-15",
        cpc: { lgv_valid_to: "2026-09-01", pcv_valid_to: null },
        categories: [{ code: "CE", status: "Full", valid_from: "2025-10-07", valid_to: "2048-04-19", restriction_codes: [] }],
      }),
      TODAY,
    ).map((f) => `${f.level}: ${f.message}`);
    expect(flags).toEqual([
      "danger: 6 penalty points on the licence",
      "danger: Driver CPC (LGV) expired on 2026-09-01",
      "warn: Photocard expires in 45 days (2026-11-15)",
      "info: C+E held for under 2 years (since 2025-10-07) - check insurer conditions",
    ]);
  });

  it("treats disqualification and no HGV entitlement as serious", () => {
    const flags = licenceFlags(check({ disqualified: true, categories: [] }), TODAY);
    expect(flags.filter((f) => f.level === "danger").map((f) => f.message)).toEqual([
      "DVLA shows the driver as disqualified",
      "No full C or C+E entitlement",
    ]);
  });
});

describe("licenceChanges", () => {
  it("lists what changed since the last check", () => {
    const next = check({
      total_points: 3,
      endorsements: [{ offence_code: "SP30", description: "Speeding", offence_date: "2026-08-01", conviction_date: null, expiry_date: null, points: 3 }],
      tacho_card: { number: "DB000000000002", status: "ISSUED", valid_from: "2026-09-01", expiry: "2031-08-31" },
    });
    expect(licenceChanges(check(), next)).toEqual([
      "Penalty points 0 -> 3",
      "New endorsement SP30 (3 points, offence 2026-08-01)",
      "Tachograph card number changed",
      "Tachograph card expiry 2029-12-31 -> 2031-08-31",
    ]);
    expect(licenceChanges(null, next)).toEqual([]);
  });
});
