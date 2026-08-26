# Timeline Stage Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pick the stage a load's vehicle is actually at, writing the real progress fields so automatic geofence tracking carries on from there.

**Architecture:** A new pure module `src/lib/portal/stage-seed.ts` owns the whole mapping — which stages a load offers, the progress fields each stage implies, and the inverse (which stage a load currently reads as). A thin server action persists it and a small client component renders the `<select>`. No migration and no cron changes: the fields being written are latching, so the cron resumes from a seeded state instead of fighting it.

**Tech Stack:** TypeScript, Next.js App Router server actions, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-timeline-stage-seed-design.md`

---

## Background you need before starting

Read the spec first. Three facts about this codebase that the tasks depend on:

1. **Completed drops live in two places.** `run.completedStopIndexes` (column
   `completed_stop_indexes`) and `run.progress.completedIdx` (inside the
   `progress` jsonb). Every reader unions both. Anything you write must set
   both, or the UI will disagree with itself.
2. **`progress` carries cron-owned fields you must not clobber.** `stillLat`,
   `stillLng`, `stillSinceMs`, `stillStopIdx` are standstill-matching state
   owned by `/api/cron/update-progress`. Pass them through untouched.
3. **Drop indexes are `stopIndex` on a `PlanLeg`**, which indexes into
   `parseStops(run.rawText)`. Synthetic origin and return-to-base legs have
   `stopIndex === null`.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/portal/stage-seed.ts` (new) | Pure: stage type, id codec, option list, stage-to-progress patch, inverse |
| `src/lib/portal/stage-seed.test.ts` (new) | Unit tests for all of the above |
| `src/app/actions/loads.ts` (modify) | `setLoadStage` server action |
| `src/components/portal/StageSeedControl.tsx` (new) | The `<select>` |
| `src/app/portal/loads/[id]/page.tsx` (modify) | Renders the control, handles the change |

---

### Task 1: Stage type and id codec

**Files:**
- Create: `src/lib/portal/stage-seed.ts`
- Test: `src/lib/portal/stage-seed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/portal/stage-seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stageId, parseStageId } from "./stage-seed";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: FAIL — cannot resolve `./stage-seed`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/portal/stage-seed.ts`:

```ts
/**
 * Manual stage seeding for a load's event timeline.
 *
 * An admin picks the stage the vehicle is actually at; we write the REAL
 * progress fields, stamped now, and let /api/cron/update-progress carry on
 * from there. There is no override column, because every field the cron
 * touches on this path is latching — it only ever advances — so a seeded
 * state is durable rather than something the cron fights.
 *
 * See docs/superpowers/specs/2026-08-26-timeline-stage-seed-design.md
 */

export type Stage =
  | { kind: "not-started" }
  | { kind: "at-collection" }
  | { kind: "heading-to"; dropIdx: number }
  | { kind: "on-site"; dropIdx: number }
  | { kind: "delivered"; dropIdx: number };

/** Serialised form: the <select> value and the server action argument. */
export type StageId = string;

export function stageId(stage: Stage): StageId {
  switch (stage.kind) {
    case "not-started":
    case "at-collection":
      return stage.kind;
    default:
      return stage.kind + ":" + stage.dropIdx;
  }
}

export function parseStageId(id: StageId): Stage | null {
  if (id === "not-started" || id === "at-collection") return { kind: id };

  const sep = id.indexOf(":");
  if (sep < 0) return null;
  const kind = id.slice(0, sep);
  const raw = id.slice(sep + 1);
  if (!/^[0-9]+$/.test(raw)) return null;
  const dropIdx = Number(raw);

  if (kind === "heading-to" || kind === "on-site" || kind === "delivered") {
    return { kind, dropIdx };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/stage-seed.ts src/lib/portal/stage-seed.test.ts && git commit -m "feat(stage-seed): stage type and id codec"
```

---

### Task 2: listStages

**Files:**
- Modify: `src/lib/portal/stage-seed.ts`
- Test: `src/lib/portal/stage-seed.test.ts`

There is deliberately **no** "Loaded & departed" option. It would seed
byte-identical state to "Heading to <first drop>", so offering both would give
a select that snaps to a different label than the one you picked. The timeline
still *renders* a "Loaded & departed" event — that is unaffected.

Each task appends to the same test file. New `import` lines are shown with the
block that needs them; consolidating them at the top of the file is fine.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/portal/stage-seed.test.ts`:

```ts
import { buildRoutePlan } from "./route-plan";
import { listStages } from "./stage-seed";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: FAIL — `listStages is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/portal/stage-seed.ts`:

```ts
import type { RoutePlan } from "@/lib/portal/route-plan";

export type StageOption = { id: StageId; label: string };

/**
 * The stages this specific load can be at, in timeline order. Generated from
 * the plan's legs so a load never offers a stage it does not have.
 */
export function listStages(plan: RoutePlan): StageOption[] {
  const out: StageOption[] = [{ id: "not-started", label: "Not started" }];

  const origin = plan.legs.find((l) => l.kind === "origin");
  if (origin) {
    out.push({
      id: "at-collection",
      label: "At collection · " + origin.postcode,
    });
  }

  for (const leg of plan.legs) {
    if (leg.kind !== "drop" || leg.stopIndex == null) continue;
    const dropIdx = leg.stopIndex;
    out.push({
      id: stageId({ kind: "heading-to", dropIdx }),
      label: "Heading to " + leg.postcode,
    });
    out.push({
      id: stageId({ kind: "on-site", dropIdx }),
      label: "On site at " + leg.postcode,
    });
    out.push({
      id: stageId({ kind: "delivered", dropIdx }),
      label: "Delivered · " + leg.postcode,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/stage-seed.ts src/lib/portal/stage-seed.test.ts && git commit -m "feat(stage-seed): list the stages a load can be at"
```

---

### Task 3: seedPatch

**Files:**
- Modify: `src/lib/portal/stage-seed.ts`
- Test: `src/lib/portal/stage-seed.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/portal/stage-seed.test.ts`. `mkRun` builds a `PlannedRun`
with only the fields this module reads:

```ts
import type { PlannedRun } from "@/types/runs";
import { seedPatch } from "./stage-seed";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: FAIL — `seedPatch is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/portal/stage-seed.ts`:

```ts
import type { PlannedRun, ProgressState } from "@/types/runs";

export type CompletedMeta = NonNullable<PlannedRun["completedMeta"]>;

export type StageSeed = {
  progress: ProgressState;
  completedStopIndexes: number[];
  completedMeta: CompletedMeta;
};

/**
 * The progress state a stage asserts. Absolute, not additive: the result is
 * exactly the chosen stage whether that is forwards or backwards of where the
 * load currently is, which keeps the control's effect independent of what it
 * was clicked from.
 *
 * Every stage at or past the collection point stamps the collection fields
 * with nowISO, so arrival and departure share a timestamp. Deliberate — the
 * seed asserts a state, not a history it cannot know.
 */
export function seedPatch(
  stage: Stage,
  run: PlannedRun,
  nowISO: string,
): StageSeed {
  const nowMs = new Date(nowISO).getTime();
  const prev = run.progress;

  // Standstill fields are cron-owned; carry them through untouched.
  const base: ProgressState = {
    completedIdx: [],
    onSiteIdx: null,
    onSiteSinceMs: null,
    lastInside: prev?.lastInside ?? false,
    stillLat: prev?.stillLat ?? null,
    stillLng: prev?.stillLng ?? null,
    stillSinceMs: prev?.stillSinceMs ?? null,
    stillStopIdx: prev?.stillStopIdx ?? null,
    collectArrivedMs: null,
    collected: false,
    collectDepartedISO: null,
  };

  const empty = { completedStopIndexes: [], completedMeta: {} };

  if (stage.kind === "not-started") {
    return { progress: { ...base, pendingDeparture: undefined }, ...empty };
  }

  if (stage.kind === "at-collection") {
    return {
      progress: { ...base, collectArrivedMs: nowMs, collected: true },
      ...empty,
    };
  }

  // Every drop stage implies the lorry has already left the collection point.
  // pendingDeparture is the cron's chained-run guard; clearing it stops the
  // next cycle holding off tracking because the lorry started at a stop.
  const departed: ProgressState = {
    ...base,
    collectArrivedMs: nowMs,
    collected: true,
    collectDepartedISO: nowISO,
    pendingDeparture: false,
  };

  const lastComplete =
    stage.kind === "delivered" ? stage.dropIdx : stage.dropIdx - 1;
  const completed: number[] = [];
  for (let i = 0; i <= lastComplete; i++) completed.push(i);

  const completedMeta: CompletedMeta = {};
  for (const i of completed) completedMeta[i] = { atISO: nowISO, by: "admin" };

  return {
    progress: {
      ...departed,
      completedIdx: completed,
      onSiteIdx: stage.kind === "on-site" ? stage.dropIdx : null,
      onSiteSinceMs: stage.kind === "on-site" ? nowMs : null,
    },
    completedStopIndexes: completed,
    completedMeta,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/stage-seed.ts src/lib/portal/stage-seed.test.ts && git commit -m "feat(stage-seed): map a stage to the progress state it asserts"
```

---

### Task 4: currentStage

**Files:**
- Modify: `src/lib/portal/stage-seed.ts`
- Test: `src/lib/portal/stage-seed.test.ts`

`currentStage` is the inverse of `seedPatch`, used as the select's resting
value. It is a *normalising* inverse, not a strict one: "Delivered drop 1" of
three drops is the same state as "Heading to drop 2", so it reports the latter.
The tests lock that in rather than pretending otherwise.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/portal/stage-seed.test.ts`:

```ts
import { currentStage, type Stage } from "./stage-seed";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: FAIL — `currentStage is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/portal/stage-seed.ts`:

```ts
/**
 * Which stage a load currently reads as — the select's resting value.
 *
 * A normalising inverse of seedPatch: states that are genuinely identical
 * report the same stage. "Delivered drop 1" of three drops IS "heading to
 * drop 2", so that is what comes back.
 */
export function currentStage(run: PlannedRun, plan: RoutePlan): StageId {
  const dropIdxs = plan.legs
    .filter((l) => l.kind === "drop" && l.stopIndex != null)
    .map((l) => l.stopIndex as number);

  const done = new Set([
    ...(run.completedStopIndexes ?? []),
    ...(run.progress?.completedIdx ?? []),
  ]);
  const outstanding = dropIdxs.filter((i) => !done.has(i));

  if (dropIdxs.length > 0 && outstanding.length === 0) {
    return stageId({
      kind: "delivered",
      dropIdx: dropIdxs[dropIdxs.length - 1],
    });
  }

  const next = outstanding[0];
  const moving = !!run.progress?.collectDepartedISO || done.size > 0;

  if (next != null) {
    if (run.progress?.onSiteIdx === next) {
      return stageId({ kind: "on-site", dropIdx: next });
    }
    if (moving) return stageId({ kind: "heading-to", dropIdx: next });
  }

  if (run.progress?.collectArrivedMs != null) return "at-collection";
  return "not-started";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/portal/stage-seed.test.ts`

Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/stage-seed.ts src/lib/portal/stage-seed.test.ts && git commit -m "feat(stage-seed): report the stage a load currently reads as"
```

---

### Task 5: setLoadStage server action

**Files:**
- Modify: `src/app/actions/loads.ts`

No unit test: this is I/O against Supabase and the repo has no action-level
test harness. Every piece of logic it depends on is covered by Tasks 1-4. It is
exercised by the manual verification in Task 8.

- [ ] **Step 1: Add the import**

At the top of `src/app/actions/loads.ts`, alongside the existing imports:

```ts
import { parseStageId, seedPatch } from "@/lib/portal/stage-seed";
```

`rowToRun` is already imported in this file — check before adding it again.

- [ ] **Step 2: Add the action**

Append to `src/app/actions/loads.ts`, directly after `setLoadStatusOverride`:

```ts
/**
 * Seed a load's progress to the stage an admin says the vehicle is at.
 *
 * Unlike setLoadStatusOverride this writes no override column — it writes the
 * real progress fields, so /api/cron/update-progress carries on from the
 * seeded state on its next cycle. See
 * docs/superpowers/specs/2026-08-26-timeline-stage-seed-design.md
 */
export async function setLoadStage(id: string, stage: string) {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Admin role required" };

  const parsed = parseStageId(stage);
  if (!parsed) return { error: "Unknown stage" };

  const { data: row, error: readErr } = await supabase
    .from("loads")
    .select("*")
    .eq("id", id)
    .single();
  if (readErr || !row) return { error: readErr?.message ?? "Load not found" };

  const seed = seedPatch(parsed, rowToRun(row), new Date().toISOString());

  const { error } = await supabase
    .from("loads")
    .update({
      progress: seed.progress,
      completed_stop_indexes: seed.completedStopIndexes,
      completed_meta: seed.completedMeta,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // Returned so the caller can update local state without a refetch.
  return { success: true as const, seed };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/loads.ts && git commit -m "feat(stage-seed): setLoadStage server action"
```

---

### Task 6: StageSeedControl component

**Files:**
- Create: `src/components/portal/StageSeedControl.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/portal/StageSeedControl.tsx`:

```tsx
"use client";

/**
 * Admin control for saying what stage a load's vehicle is actually at.
 *
 * The value shown is the stage the load currently reads as, not a stored
 * override — choosing a different one seeds real progress state and the
 * geofence tracking carries on from there.
 */

import type { StageId, StageOption } from "@/lib/portal/stage-seed";

export default function StageSeedControl({
  options,
  value,
  saving,
  onChange,
}: {
  options: StageOption[];
  value: StageId;
  saving: boolean;
  onChange: (next: StageId) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 3, justifyItems: "start" }}>
      <span
        className="muted"
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          fontWeight: 600,
        }}
      >
        Vehicle is currently
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        className="input"
        style={{ height: 26, fontSize: 11.5, width: "auto" }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/StageSeedControl.tsx && git commit -m "feat(stage-seed): stage select component"
```

---

### Task 7: Wire the control into the load detail page

**Files:**
- Modify: `src/app/portal/loads/[id]/page.tsx`

- [ ] **Step 1: Add the imports**

Alongside the existing `StageOverrideControl` import (~line 31):

```ts
import StageSeedControl from "@/components/portal/StageSeedControl";
```

Add `setLoadStage` to the existing import list from `@/app/actions/loads`
(the one that already brings in `setLoadStatusOverride`).

Add a new import:

```ts
import {
  currentStage,
  listStages,
  type StageId,
} from "@/lib/portal/stage-seed";
```

- [ ] **Step 2: Add state and handler**

Directly after the existing `handleStageChange` function (~line 355). `plan`
must already be in scope at this point — if it is declared further down the
component, put these lines just after `plan` instead:

```ts
  const stageOptions = useMemo(() => listStages(plan), [plan]);
  const stageValue = useMemo(() => currentStage(run, plan), [run, plan]);
  const [savingSeed, setSavingSeed] = useState(false);

  async function handleStageSeed(next: StageId) {
    setSavingSeed(true);
    const res = await setLoadStage(run.id, next);
    setSavingSeed(false);
    if (res.error) {
      showToast(`Couldn't set stage: ${res.error}`, "err");
      return;
    }
    onRunChange({
      ...run,
      progress: res.seed.progress,
      completedStopIndexes: res.seed.completedStopIndexes,
      completedMeta: res.seed.completedMeta,
    });
    const label = stageOptions.find((o) => o.id === next)?.label ?? next;
    showToast(`Stage set to ${label}`);
  }
```

- [ ] **Step 3: Render the control**

In the header block, immediately after the closing `/>` of the existing
`<StageOverrideControl ... />` (~line 479):

```tsx
              {isAdmin && (
                <StageSeedControl
                  options={stageOptions}
                  value={stageValue}
                  saving={savingSeed}
                  onChange={handleStageSeed}
                />
              )}
```

- [ ] **Step 4: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no output.

Run: `npx vitest run`

Expected: PASS — every file, including the 19 new stage-seed tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/portal/loads/[id]/page.tsx" && git commit -m "feat(stage-seed): render the stage control on the load page"
```

---

### Task 8: Manual verification

**Files:** none — this is a browser check.

The portal requires a login, so a human must drive this.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Check the seed corrects the timeline**

Open a backload whose driver has not set off. Confirm:

1. The header shows **Vehicle is currently: Not started**.
2. The event timeline reads `Scheduled: Drop 1 at <postcode>`, not `Heading to`.
3. The ETA tile shows the booked time with no `live · from vehicle position`.
4. Choose **At collection · <postcode>**. The timeline gains a
   `Loading at <postcode>` entry and the status pill moves to `Loading`.
5. Choose **Heading to <drop postcode>**. The timeline shows
   `Loaded & departed`, the pill moves to `In transit`, and the ETA tile
   switches to `live · from vehicle position`.
6. Open the customer share link for the same load and confirm it agrees.

- [ ] **Step 3: Check the cron does not undo it**

Leave the load seeded at **Heading to** for about 5 minutes (two cron cycles)
with the vehicle parked elsewhere. Reload. The stage must still read
`Heading to`.

Expected sharp edge, per the spec: seeding **Not started** while the vehicle is
genuinely sat at the collection postcode WILL be re-detected within ~2 minutes.
That is reality winning, not a bug.
