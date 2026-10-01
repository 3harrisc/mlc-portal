import { describe, expect, it } from "vitest";
import { hrTodos, todoCounts, type TodoInputs } from "./todos";
import type { HrDocument } from "@/types/hr";
import type { DriverRecord } from "@/types/hr-drivers";

const NOW = new Date("2026-10-20T09:00:00Z");
const licence = {
  check_number: "1", checked_on: "2026-09-01", surname: "DRIVER", forenames: "SAM", gender: null, date_of_birth: null,
  address_lines: [], postcode: null, licence_number: "X", issue_number: null, licence_status: "VALID", photocard_expiry: "2031-01-01",
  disqualified: false, total_points: 0, endorsements: [],
  categories: [{ code: "CE", status: "Full", valid_from: "2015-01-01", valid_to: "2040-01-01", restriction_codes: [] }],
  tacho_card: { number: "DB1", status: "ISSUED", valid_from: "2025-01-01", expiry: "2030-01-01" },
  cpc: { lgv_valid_to: "2030-01-01", pcv_valid_to: null },
};
const driver = (over: Partial<DriverRecord> = {}): DriverRecord => ({
  id: "d1", profileId: "p1", status: "active", firstNames: "Sam", surname: "Driver", dateOfBirth: null, address: null,
  postcode: null, phone: "07700900000", email: null, niNumber: "AB123456C", emergencyContactName: "Alex",
  emergencyContactPhone: "07700900001", startDate: "2026-09-01", continuousEmploymentDate: null, leaveDate: null,
  notes: null, licence, licenceCheckedOn: "2026-09-01", ...over,
});
const doc = (over: Partial<HrDocument>): HrDocument => ({
  id: "x", title: "Doc", category: "policy", description: null, fileName: null, fileSize: null, fileSha256: "",
  audience: "all", resignMonths: null, status: "published", requiresCountersign: false, collectsParticulars: false,
  createdAt: "", publishedAt: "2026-09-01T00:00:00Z", ...over,
});
const contract = doc({ id: "c", title: "Contract", category: "contract", audience: "selected", collectsParticulars: true, requiresCountersign: true });
const base = (over: Partial<TodoInputs> = {}): TodoInputs => ({
  drivers: [driver()], fileKinds: { d1: ["licence_check", "right_to_work"] }, documents: [contract],
  assignments: [{ documentId: "c", driverId: "p1", startDate: "2026-09-01", continuousDate: "2026-09-01", assignedAt: "2026-09-01T00:00:00Z" }],
  signatures: [{ id: "s", documentId: "c", driverId: "p1", signedName: "Sam Driver", signedAt: "2026-09-02T00:00:00Z",
    countersign: { signerName: "David Harris", signerTitle: "Company Director", signedAt: "2026-09-03T00:00:00Z" } }],
  logins: [{ id: "p1", email: "sam@example.com", fullName: "Sam Driver" }], now: NOW, ...over,
});

describe("hrTodos", () => {
  it("is empty for a fully compliant driver", () => {
    expect(hrTodos(base())).toEqual([]);
  });

  it("lists problems most serious first", () => {
    const todos = hrTodos(base({
      drivers: [driver({ niNumber: null })],
      fileKinds: { d1: ["licence_check"] },
      documents: [contract, doc({ id: "h", title: "Handbook" })],
      logins: [{ id: "p1", email: "sam@example.com", fullName: "Sam Driver" }, { id: "p2", email: "new@example.com", fullName: null }],
    }));
    expect(todos.map((t) => `${t.level}|${t.who}|${t.message}`)).toEqual([
      "danger|Sam Driver|No right-to-work evidence on file",
      "warn|new@example.com|Has a driver login but no driver record",
      "warn|Sam Driver|Hasn't signed Handbook (oldest 49 days)",
      "info|Sam Driver|Missing details: NI number",
    ]);
    expect(todoCounts(todos)).toEqual({ danger: 1, warn: 2, info: 1 });
  });

  it("flags countersigning, unsent contracts for starters and skips leavers", () => {
    const awaiting = hrTodos(base({ signatures: [{ id: "s", documentId: "c", driverId: "p1", signedName: "Sam", signedAt: "2026-10-18T00:00:00Z", countersign: null }] }));
    expect(awaiting.map((t) => t.message)).toEqual(['Signed "Contract" - waiting for MLC to countersign']);

    const unsent = hrTodos(base({ drivers: [driver({ status: "starter" })], assignments: [], signatures: [] }));
    expect(unsent.map((t) => `${t.level}|${t.message}`)).toEqual(["warn|Contract not sent yet - use Send starter pack"]);

    expect(hrTodos(base({ drivers: [driver({ status: "left" })], fileKinds: {} })).filter((t) => t.who === "Sam Driver")).toEqual([]);
  });

  it("counts unsigned days from the start date for documents published earlier", () => {
    const todos = hrTodos(base({
      drivers: [driver({ startDate: "2026-10-16" })],
      documents: [contract, doc({ id: "h", title: "Handbook", publishedAt: "2026-01-01T00:00:00Z" })],
    }));
    expect(todos.map((t) => `${t.level}|${t.message}`)).toEqual(["info|Hasn't signed Handbook (oldest 4 days)"]);
  });
});
