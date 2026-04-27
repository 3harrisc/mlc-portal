import { describe, it, expect } from "vitest";
import { runToInvoiceable } from "./run-to-invoiceable";
import type { PlannedRun } from "@/types/runs";

function makeRun(p: Partial<PlannedRun>): PlannedRun {
  return {
    id: "r1",
    jobNumber: "MLC-20250922-001",
    loadRef: "",
    date: "2025-09-22",
    customer: "CONSOLID8",
    vehicle: "C12MLC",
    fromPostcode: "NEWARK",
    toPostcode: "TAMWORTH",
    returnToBase: true,
    startTime: "08:00",
    serviceMins: 25,
    includeBreaks: true,
    rawText: "",
    runType: "regular",
    runOrder: null,
    ...p,
  };
}

describe("runToInvoiceable", () => {
  it("renders description as 'FROM -> TO (Reg: VEHICLE)'", () => {
    const i = runToInvoiceable(makeRun({}));
    expect(i.description).toBe("NEWARK -> TAMWORTH (Reg: C12MLC)");
  });

  it("falls back to first raw_text line when postcodes are missing", () => {
    const i = runToInvoiceable(
      makeRun({
        fromPostcode: "",
        toPostcode: "",
        rawText: "DURHAM\nLEEDS",
      })
    );
    expect(i.description).toBe("DURHAM (Reg: C12MLC)");
  });

  it("omits the vehicle parens when vehicle is empty", () => {
    const i = runToInvoiceable(makeRun({ vehicle: "" }));
    expect(i.description).toBe("NEWARK -> TAMWORTH");
  });

  it("uses revenue as amount, defaulting to 0", () => {
    expect(runToInvoiceable(makeRun({ revenue: 250 })).amount).toBe(250);
    expect(runToInvoiceable(makeRun({ revenue: undefined })).amount).toBe(0);
  });

  it("passes through id, date, customer, loadRef", () => {
    const i = runToInvoiceable(
      makeRun({ id: "x", date: "2025-09-25", customer: "MONTPELLIER", loadRef: "Z37-10" })
    );
    expect(i.id).toBe("x");
    expect(i.date).toBe("2025-09-25");
    expect(i.customer).toBe("MONTPELLIER");
    expect(i.loadRef).toBe("Z37-10");
  });
});
