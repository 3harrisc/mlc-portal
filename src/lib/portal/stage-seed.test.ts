import { describe, it, expect } from "vitest";
import { stageId, parseStageId, listStages } from "./stage-seed";
import { buildRoutePlan } from "./route-plan";

describe("stage id codec", () => {
  it("round-trips the collection stages", () => {
    for (const k of ["not-started", "at-collection"] as const) {
      expect(parseStageId(stageId({ kind: k }))).toEqual({ kind: k });
    }
  });

  it("round-trips the drop stages with their index", () => {
    const s = { kind: "on-site", dropIdx: 2 } as const;
    expect(stageId(s)).toBe("on-site:2");
    expect(parseStageId("on-site:2")).toEqual(s);
  });

  it("rejects unknown or malformed ids", () => {
    expect(parseStageId("nonsense")).toBeNull();
    expect(parseStageId("on-site:")).toBeNull();
    expect(parseStageId("on-site:-1")).toBeNull();
    expect(parseStageId("on-site:x")).toBeNull();
  });
});

const backload = {
  rawText: "CF83 1BQ",
  fromPostcode: "DN15 8QP",
  toPostcode: "",
  runType: "backload" as const,
  returnToBase: false,
};

describe("listStages", () => {
  it("offers collection stages plus three per drop", () => {
    const plan = buildRoutePlan(backload, null);
    expect(listStages(plan).map((o) => o.id)).toEqual([
      "not-started",
      "at-collection",
      "heading-to:0",
      "on-site:0",
      "delivered:0",
    ]);
  });

  it("labels stages with their postcode", () => {
    const plan = buildRoutePlan(backload, null);
    const byId = Object.fromEntries(
      listStages(plan).map((o) => [o.id, o.label]),
    );
    expect(byId["at-collection"]).toBe("At collection · DN15 8QP");
    expect(byId["heading-to:0"]).toBe("Heading to CF83 1BQ");
    expect(byId["delivered:0"]).toBe("Delivered · CF83 1BQ");
  });

  it("repeats the drop stages for a multi-drop load", () => {
    const plan = buildRoutePlan(
      { ...backload, rawText: "CF83 1BQ\nBS20 7XN\nNG22 8TX" },
      null,
    );
    expect(listStages(plan).map((o) => o.id)).toEqual([
      "not-started",
      "at-collection",
      "heading-to:0",
      "on-site:0",
      "delivered:0",
      "heading-to:1",
      "on-site:1",
      "delivered:1",
      "heading-to:2",
      "on-site:2",
      "delivered:2",
    ]);
  });
});
