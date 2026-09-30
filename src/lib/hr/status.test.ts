import { describe, expect, it } from "vitest";
import {
  addMonths,
  appliesToDriver,
  driverDocumentViews,
  latestSignatures,
  signStatus,
} from "./status";
import type { HrDocument, HrSignature } from "@/types/hr";

const doc = (over: Partial<HrDocument> = {}): HrDocument => ({
  id: "doc-1",
  title: "H&S policy",
  category: "health_safety",
  description: null,
  fileName: "hs.pdf",
  fileSize: 100,
  fileSha256: "abc",
  audience: "all",
  resignMonths: null,
  status: "published",
  createdAt: "2026-01-01T00:00:00Z",
  publishedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const sig = (over: Partial<HrSignature> = {}): HrSignature => ({
  id: "sig-1",
  documentId: "doc-1",
  driverId: "drv-1",
  signedName: "Sam Driver",
  signedAt: "2026-01-10T09:00:00Z",
  ...over,
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    expect(addMonths(new Date("2028-01-31T12:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T12:00:00.000Z",
    );
  });

  it("rolls over years", () => {
    expect(addMonths(new Date("2026-11-15T00:00:00Z"), 12).toISOString()).toBe(
      "2027-11-15T00:00:00.000Z",
    );
  });
});

describe("signStatus", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("is outstanding with no signature", () => {
    expect(signStatus(12, null, now)).toEqual({ status: "outstanding", expiresAt: null });
  });

  it("never lapses without a re-sign period", () => {
    expect(signStatus(null, "2020-01-01T00:00:00Z", now)).toEqual({
      status: "signed",
      expiresAt: null,
    });
  });

  it("is signed well before the deadline", () => {
    expect(signStatus(12, "2026-01-01T00:00:00Z", now).status).toBe("signed");
  });

  it("is due soon within 30 days of the deadline", () => {
    expect(signStatus(12, "2025-06-20T00:00:00Z", now)).toEqual({
      status: "due_soon",
      expiresAt: "2026-06-20T00:00:00.000Z",
    });
  });

  it("is expired on and after the deadline", () => {
    expect(signStatus(12, "2025-06-01T00:00:00Z", now).status).toBe("expired");
    expect(signStatus(6, "2025-01-01T00:00:00Z", now).status).toBe("expired");
  });
});

describe("appliesToDriver", () => {
  it("applies 'all' documents to every driver", () => {
    expect(appliesToDriver(doc(), "anyone", [])).toBe(true);
  });

  it("applies 'selected' documents only to assigned drivers", () => {
    const d = doc({ audience: "selected" });
    const assignments = [{ documentId: "doc-1", driverId: "drv-1" }];
    expect(appliesToDriver(d, "drv-1", assignments)).toBe(true);
    expect(appliesToDriver(d, "drv-2", assignments)).toBe(false);
  });

  it("never applies drafts or archived documents", () => {
    expect(appliesToDriver(doc({ status: "draft" }), "drv-1", [])).toBe(false);
    expect(appliesToDriver(doc({ status: "archived" }), "drv-1", [])).toBe(false);
  });
});

describe("latestSignatures", () => {
  it("keeps the newest signature per driver and document", () => {
    const latest = latestSignatures([
      sig({ id: "old", signedAt: "2025-01-01T00:00:00Z" }),
      sig({ id: "new", signedAt: "2026-01-01T00:00:00Z" }),
      sig({ id: "other", driverId: "drv-2" }),
      sig({ id: "orphan", driverId: null }),
    ]);
    expect(latest.get("drv-1:doc-1")?.id).toBe("new");
    expect(latest.get("drv-2:doc-1")?.id).toBe("other");
    expect(latest.size).toBe(2);
  });
});

describe("driverDocumentViews", () => {
  it("combines applicability and status", () => {
    const views = driverDocumentViews(
      "drv-1",
      [doc(), doc({ id: "doc-2", audience: "selected" }), doc({ id: "doc-3", resignMonths: 12 })],
      [],
      [sig(), sig({ id: "s3", documentId: "doc-3", signedAt: "2024-01-01T00:00:00Z" })],
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(views.map((v) => [v.document.id, v.status])).toEqual([
      ["doc-1", "signed"],
      ["doc-3", "expired"],
    ]);
  });
});
