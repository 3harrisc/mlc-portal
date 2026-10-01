import { describe, expect, it } from "vitest";
import { driverChecklist } from "./checklist";
import type { DriverDocumentView, HrDocument } from "@/types/hr";
import type { DriverRecord } from "@/types/hr-drivers";

const driver = (over: Partial<DriverRecord> = {}): DriverRecord => ({
  id: "d1", profileId: "p1", status: "starter", firstNames: "Sam", surname: "Driver",
  dateOfBirth: null, address: null, postcode: null, phone: "07700900000", email: null,
  niNumber: "AB123456C", emergencyContactName: "Alex", emergencyContactPhone: "07700900001",
  startDate: "2026-10-05", continuousEmploymentDate: null, leaveDate: null, notes: null,
  licence: { total_points: 0 } as DriverRecord["licence"], licenceCheckedOn: "2026-09-01", ...over,
});
const doc = (over: Partial<HrDocument>): HrDocument => ({
  id: "x", title: "Doc", category: "policy", description: null, fileName: null, fileSize: null, fileSha256: "",
  audience: "all", resignMonths: null, status: "published", requiresCountersign: false, collectsParticulars: false,
  createdAt: "", publishedAt: "", ...over,
});
const view = (d: HrDocument, status: DriverDocumentView["status"], countersigned = false): DriverDocumentView => ({
  document: d, status, expiresAt: null, assignment: null,
  lastSignature: status === "outstanding" ? null : {
    id: "s", documentId: d.id, driverId: "p1", signedName: "Sam Driver", signedAt: "2026-10-02T09:00:00Z",
    countersign: countersigned ? { signerName: "David Harris", signerTitle: "Company Director", signedAt: "2026-10-03T09:00:00Z" } : null,
  },
});

describe("driverChecklist", () => {
  it("shows what's missing for a new starter", () => {
    const items = driverChecklist(driver({ profileId: null, niNumber: null }), [], []);
    const open = items.filter((i) => !i.done).map((i) => i.key);
    expect(open).toEqual(["login", "ni", "licence", "rtw", "contract"]);
  });

  it("tracks the contract through signing and countersigning", () => {
    const contract = doc({ id: "c", title: "Contract", category: "contract", audience: "selected", collectsParticulars: true, requiresCountersign: true });
    const handbook = doc({ id: "h", title: "Handbook" });
    const files = [{ kind: "licence_check" as const }, { kind: "right_to_work" as const }];

    const awaiting = driverChecklist(driver(), files, [view(contract, "signed"), view(handbook, "outstanding")]);
    expect(awaiting.filter((i) => !i.done).map((i) => i.label)).toEqual(["Contract countersigned by MLC", "Handbook signed"]);

    const complete = driverChecklist(driver(), files, [view(contract, "signed", true), view(handbook, "signed")]);
    expect(complete.every((i) => i.done)).toBe(true);
  });
});
