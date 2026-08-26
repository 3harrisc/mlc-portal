import { describe, it, expect } from "vitest";
import {
  stageId,
  parseStageId,
  listStages,
  hasSeedableDrop,
  seedPatch,
  currentStage,
  isStageValidFor,
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

  it("rejects non-canonical indexes so ids round-trip bijectively", () => {
    expect(parseStageId("on-site:007")).toBeNull();
    expect(parseStageId("heading-to:007")).toBeNull();
  });

  it("rejects indexes beyond the safe integer range", () => {
    expect(parseStageId("on-site:99999999999999999999")).toBeNull();
    expect(parseStageId("delivered:9007199254740993")).toBeNull();
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

describe("hasSeedableDrop", () => {
  it("is true for a plan whose drops map to parsed stops", () => {
    expect(hasSeedableDrop(buildRoutePlan(backload, null))).toBe(true);
  });

  it("is false for a regular load with no parsed stops", () => {
    // No rawText, so the synthesised plan's drop leg carries stopIndex null
    // and listStages can't offer a delivery stage at all.
    const plan = buildRoutePlan(
      {
        rawText: "",
        fromPostcode: "DN15 8QP",
        toPostcode: "CF83 1BQ",
        runType: "regular",
        returnToBase: false,
      },
      null,
    );
    expect(plan.legs.some((l) => l.kind === "drop")).toBe(true);
    expect(hasSeedableDrop(plan)).toBe(false);
    expect(listStages(plan).map((o) => o.id)).toEqual([
      "not-started",
      "at-collection",
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

describe("isStageValidFor", () => {
  // mkRun's rawText is a three-drop load: indexes 0, 1 and 2.
  it("accepts a drop index the load actually has", () => {
    for (const kind of ["heading-to", "on-site", "delivered"] as const) {
      expect(isStageValidFor({ kind, dropIdx: 2 }, mkRun())).toBe(true);
    }
  });

  it("rejects a drop index past the last drop", () => {
    expect(isStageValidFor({ kind: "delivered", dropIdx: 3 }, mkRun())).toBe(
      false,
    );
    expect(isStageValidFor({ kind: "on-site", dropIdx: 9 }, mkRun())).toBe(
      false,
    );
  });

  it("rejects a huge index rather than letting seedPatch build the array", () => {
    expect(
      isStageValidFor({ kind: "delivered", dropIdx: 3_000_000 }, mkRun()),
    ).toBe(false);
  });

  it("rejects a negative drop index", () => {
    expect(isStageValidFor({ kind: "heading-to", dropIdx: -1 }, mkRun())).toBe(
      false,
    );
  });

  it("always accepts the collection stages", () => {
    const noDrops = mkRun({ rawText: "" });
    expect(isStageValidFor({ kind: "not-started" }, noDrops)).toBe(true);
    expect(isStageValidFor({ kind: "at-collection" }, noDrops)).toBe(true);
  });
});

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

  it("preserves real completedMeta for stops that stay completed", () => {
    const run = mkRun({
      completedStopIndexes: [0],
      completedMeta: {
        0: {
          arrivedISO: "2026-08-26T09:00:00.000Z",
          atISO: "2026-08-26T09:40:00.000Z",
          by: "auto",
        },
      },
      progress: {
        completedIdx: [0],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
      },
    });
    const s = seedPatch({ kind: "on-site", dropIdx: 2 }, run, NOW);
    expect(s.completedMeta[0]).toEqual({
      arrivedISO: "2026-08-26T09:00:00.000Z",
      atISO: "2026-08-26T09:40:00.000Z",
      by: "auto",
    });
    // Drop 1 is newly asserted by the seed, so it is stamped now.
    expect(s.completedMeta[1]).toEqual({ atISO: NOW, by: "admin" });
  });

  it("preserves real collection arrive/depart times", () => {
    const run = mkRun({
      progress: {
        completedIdx: [],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
        collectArrivedMs: new Date("2026-08-26T06:00:00.000Z").getTime(),
        collected: true,
        collectDepartedISO: "2026-08-26T07:00:00.000Z",
      },
    });
    const s = seedPatch({ kind: "on-site", dropIdx: 2 }, run, NOW);
    expect(s.progress.collectArrivedMs).toBe(
      new Date("2026-08-26T06:00:00.000Z").getTime(),
    );
    expect(s.progress.collectDepartedISO).toBe("2026-08-26T07:00:00.000Z");
  });

  it("preserves a real arrival time on the at-collection stage", () => {
    const run = mkRun({
      progress: {
        completedIdx: [],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
        collectArrivedMs: new Date("2026-08-26T06:00:00.000Z").getTime(),
        collected: true,
      },
    });
    const s = seedPatch({ kind: "at-collection" }, run, NOW);
    expect(s.progress.collectArrivedMs).toBe(
      new Date("2026-08-26T06:00:00.000Z").getTime(),
    );
    expect(s.progress.collectDepartedISO).toBeNull();
  });

  it("still clears completedMeta entirely on a backwards seed", () => {
    const run = mkRun({
      completedStopIndexes: [0, 1],
      completedMeta: {
        0: { atISO: "2026-08-26T09:40:00.000Z", by: "auto" },
        1: { atISO: "2026-08-26T11:20:00.000Z", by: "auto" },
      },
      progress: {
        completedIdx: [0, 1],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
        collectArrivedMs: 111,
        collected: true,
        collectDepartedISO: "2026-08-26T07:00:00.000Z",
      },
    });
    expect(seedPatch({ kind: "not-started" }, run, NOW).completedMeta).toEqual(
      {},
    );
    // Un-completing drop 1 drops its meta too.
    expect(
      seedPatch({ kind: "delivered", dropIdx: 0 }, run, NOW).completedMeta,
    ).toEqual({ 0: { atISO: "2026-08-26T09:40:00.000Z", by: "auto" } });
  });

  it("throws rather than writing NaN for an invalid timestamp", () => {
    expect(() => seedPatch({ kind: "at-collection" }, mkRun(), "no")).toThrow(
      /invalid nowISO/,
    );
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

  // The cron completes whichever uncompleted stop the vehicle is INSIDE,
  // picked by distance — not by lowest index — so onSiteIdx routinely points
  // past the first outstanding drop when a driver reorders their drops.
  it("honours an onSiteIdx that is not the first outstanding drop", () => {
    const run = mkRun({
      completedStopIndexes: [1],
      progress: {
        completedIdx: [1],
        onSiteIdx: 2,
        onSiteSinceMs: NOW_MS,
        lastInside: true,
        collectArrivedMs: 111,
        collected: true,
        collectDepartedISO: "2026-08-26T07:00:00.000Z",
      },
    });
    expect(currentStage(run, plan)).toBe("on-site:2");
  });

  it("ignores an onSiteIdx pointing at an already-completed drop", () => {
    const run = mkRun({
      completedStopIndexes: [0, 1],
      progress: {
        completedIdx: [0, 1],
        onSiteIdx: 1,
        onSiteSinceMs: NOW_MS,
        lastInside: true,
        collectArrivedMs: 111,
        collected: true,
        collectDepartedISO: "2026-08-26T07:00:00.000Z",
      },
    });
    expect(currentStage(run, plan)).toBe("heading-to:2");
  });

  it("ignores an onSiteIdx the plan has no drop for", () => {
    const run = mkRun({
      progress: {
        completedIdx: [],
        onSiteIdx: 7,
        onSiteSinceMs: NOW_MS,
        lastInside: true,
        collectArrivedMs: 111,
        collected: true,
        collectDepartedISO: "2026-08-26T07:00:00.000Z",
      },
    });
    expect(currentStage(run, plan)).toBe("heading-to:0");
  });
});
