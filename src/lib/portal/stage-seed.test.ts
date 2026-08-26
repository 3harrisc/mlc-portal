import { describe, it, expect } from "vitest";
import {
  stageId,
  parseStageId,
  listStages,
  seedPatch,
  currentStage,
  type Stage,
} from "./stage-seed";
import { buildRoutePlan } from "./route-plan";
import type { PlannedRun } from "@/types/runs";

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

const NOW = "2026-08-26T14:30:00.000Z";
const NOW_MS = new Date(NOW).getTime();

function mkRun(p: Partial<PlannedRun> = {}): PlannedRun {
  return {
    id: "load-1",
    jobNumber: "MLC-1",
    loadRef: "",
    date: "2026-08-27",
    customer: "Consolid8",
    vehicle: "B15MLC",
    fromPostcode: "DN15 8QP",
    toPostcode: "",
    returnToBase: false,
    startTime: "15:00",
    serviceMins: 30,
    includeBreaks: false,
    rawText: "CF83 1BQ\nBS20 7XN\nNG22 8TX",
    runType: "backload",
    runOrder: null,
    ...p,
  } as PlannedRun;
}

describe("seedPatch", () => {
  it("not-started clears every progress field", () => {
    const run = mkRun({
      completedStopIndexes: [0, 1],
      progress: {
        completedIdx: [0, 1],
        onSiteIdx: 1,
        onSiteSinceMs: 123,
        lastInside: true,
        collectArrivedMs: 111,
        collected: true,
        collectDepartedISO: "2026-08-26T09:00:00.000Z",
      },
    });
    const s = seedPatch({ kind: "not-started" }, run, NOW);
    expect(s.completedStopIndexes).toEqual([]);
    expect(s.completedMeta).toEqual({});
    expect(s.progress.completedIdx).toEqual([]);
    expect(s.progress.onSiteIdx).toBeNull();
    expect(s.progress.collectArrivedMs).toBeNull();
    expect(s.progress.collected).toBe(false);
    expect(s.progress.collectDepartedISO).toBeNull();
  });

  it("at-collection marks arrived and collected but not departed", () => {
    const s = seedPatch({ kind: "at-collection" }, mkRun(), NOW);
    expect(s.progress.collectArrivedMs).toBe(NOW_MS);
    expect(s.progress.collected).toBe(true);
    expect(s.progress.collectDepartedISO).toBeNull();
    expect(s.completedStopIndexes).toEqual([]);
  });

  it("heading-to marks the collection departed and earlier drops done", () => {
    const s = seedPatch({ kind: "heading-to", dropIdx: 2 }, mkRun(), NOW);
    expect(s.progress.collectDepartedISO).toBe(NOW);
    expect(s.completedStopIndexes).toEqual([0, 1]);
    expect(s.progress.completedIdx).toEqual([0, 1]);
    expect(s.progress.onSiteIdx).toBeNull();
  });

  it("heading-to the first drop completes nothing", () => {
    const s = seedPatch({ kind: "heading-to", dropIdx: 0 }, mkRun(), NOW);
    expect(s.completedStopIndexes).toEqual([]);
    expect(s.progress.collectDepartedISO).toBe(NOW);
  });

  it("on-site marks the drop as the one being sat at", () => {
    const s = seedPatch({ kind: "on-site", dropIdx: 1 }, mkRun(), NOW);
    expect(s.progress.onSiteIdx).toBe(1);
    expect(s.progress.onSiteSinceMs).toBe(NOW_MS);
    expect(s.completedStopIndexes).toEqual([0]);
  });

  it("delivered includes the drop itself", () => {
    const s = seedPatch({ kind: "delivered", dropIdx: 1 }, mkRun(), NOW);
    expect(s.completedStopIndexes).toEqual([0, 1]);
    expect(s.progress.onSiteIdx).toBeNull();
  });

  it("stamps completed drops as admin-marked", () => {
    const s = seedPatch({ kind: "delivered", dropIdx: 1 }, mkRun(), NOW);
    expect(s.completedMeta).toEqual({
      0: { atISO: NOW, by: "admin" },
      1: { atISO: NOW, by: "admin" },
    });
  });

  it("passes the cron-owned standstill fields through untouched", () => {
    const run = mkRun({
      progress: {
        completedIdx: [],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: true,
        stillLat: 51.1,
        stillLng: -3.2,
        stillSinceMs: 999,
        stillStopIdx: 4,
      },
    });
    const s = seedPatch({ kind: "at-collection" }, run, NOW);
    expect(s.progress.stillLat).toBe(51.1);
    expect(s.progress.stillLng).toBe(-3.2);
    expect(s.progress.stillSinceMs).toBe(999);
    expect(s.progress.stillStopIdx).toBe(4);
    expect(s.progress.lastInside).toBe(true);
  });
});

describe("currentStage", () => {
  const plan = buildRoutePlan(
    {
      rawText: "CF83 1BQ\nBS20 7XN\nNG22 8TX",
      fromPostcode: "DN15 8QP",
      toPostcode: "",
      runType: "backload" as const,
      returnToBase: false,
    },
    null,
  );

  /** Apply a seed to a run the way the server action does. */
  function seeded(stage: Stage): PlannedRun {
    const s = seedPatch(stage, mkRun(), NOW);
    return mkRun({
      progress: s.progress,
      completedStopIndexes: s.completedStopIndexes,
      completedMeta: s.completedMeta,
    });
  }

  it("reads a fresh load as not started", () => {
    expect(currentStage(mkRun(), plan)).toBe("not-started");
  });

  it("round-trips the stages that are distinguishable", () => {
    const stages: Stage[] = [
      { kind: "not-started" },
      { kind: "at-collection" },
      { kind: "heading-to", dropIdx: 0 },
      { kind: "heading-to", dropIdx: 2 },
      { kind: "on-site", dropIdx: 1 },
      { kind: "delivered", dropIdx: 2 },
    ];
    for (const stage of stages) {
      expect(currentStage(seeded(stage), plan)).toBe(stageId(stage));
    }
  });

  it("normalises a non-final delivered to heading-to the next drop", () => {
    expect(currentStage(seeded({ kind: "delivered", dropIdx: 0 }), plan)).toBe(
      "heading-to:1",
    );
  });

  it("reports the last drop delivered when every drop is done", () => {
    expect(currentStage(seeded({ kind: "delivered", dropIdx: 2 }), plan)).toBe(
      "delivered:2",
    );
  });

  it("unions both completed sources", () => {
    const run = mkRun({
      completedStopIndexes: [0],
      progress: {
        completedIdx: [1],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
        collectDepartedISO: NOW,
      },
    });
    expect(currentStage(run, plan)).toBe("heading-to:2");
  });
});
