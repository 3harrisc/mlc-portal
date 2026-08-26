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

import type { RoutePlan } from "@/lib/portal/route-plan";
import { parseStops } from "@/lib/postcode-utils";
import type { PlannedRun, ProgressState } from "@/types/runs";

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
  // Canonical and bounded. `String(dropIdx) !== raw` rejects "007" and any
  // digits that lose precision on the way through Number, so ids round-trip
  // bijectively; isSafeInteger keeps 1e20 out of seedPatch's loop, which
  // would never terminate.
  if (!Number.isSafeInteger(dropIdx) || String(dropIdx) !== raw) return null;

  if (kind === "heading-to" || kind === "on-site" || kind === "delivered") {
    return { kind, dropIdx };
  }
  return null;
}

/**
 * Whether a stage is legal for this specific load.
 *
 * The stage id arrives as a <select> value and a server action argument, so a
 * caller can hand us a drop index this load does not have. Unchecked,
 * seedPatch fabricates completed stops for indexes that do not exist — which
 * completedCount() measures by array LENGTH, so the load would read as
 * delivered to the customer — and a large index builds an array that size.
 *
 * Drop indexes live in the parseStops(run.rawText) index space, the same one
 * the cron and the route plan use.
 */
export function isStageValidFor(stage: Stage, run: PlannedRun): boolean {
  if (stage.kind === "not-started" || stage.kind === "at-collection") {
    return true;
  }
  const dropCount = parseStops(run.rawText).length;
  return stage.dropIdx >= 0 && stage.dropIdx < dropCount;
}

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
 * Timestamps are preserved where real, stamped where newly asserted. A stop
 * or a collection time the cron already observed keeps its own timestamp and
 * its own `by` — the event timeline and the customer share link render those,
 * and a seed cannot know a history better than the tracker did. Only the
 * stops and fields this seed newly asserts get nowISO / by:"admin".
 *
 * That does not make the seed additive: it still decides exactly WHICH stops
 * are completed, so a backwards seed drops the meta for every stop it
 * un-completes.
 */
export function seedPatch(
  stage: Stage,
  run: PlannedRun,
  nowISO: string,
): StageSeed {
  const nowMs = new Date(nowISO).getTime();
  if (Number.isNaN(nowMs)) throw new Error(`seedPatch: invalid nowISO ${nowISO}`);
  const prev = run.progress;

  // Standstill fields are cron-owned; carry them through untouched.
  // pendingDeparture is deliberately absent: leaving the key off clears the
  // cron's chained-run gate for the non-drop stages, so a seeded load starts
  // tracking from scratch instead of holding off because the lorry is parked
  // at a stop. The drop path below sets it false explicitly for the same
  // reason — the asymmetry is only that `undefined` means "undetermined" and
  // the cron re-derives it, which is what we want before departure.
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
    return { progress: base, ...empty };
  }

  if (stage.kind === "at-collection") {
    return {
      progress: {
        ...base,
        collectArrivedMs: prev?.collectArrivedMs ?? nowMs,
        collected: true,
      },
      ...empty,
    };
  }

  // Every drop stage implies the lorry has already left the collection point.
  // pendingDeparture is the cron's chained-run guard; clearing it stops the
  // next cycle holding off tracking because the lorry started at a stop.
  const departed: ProgressState = {
    ...base,
    collectArrivedMs: prev?.collectArrivedMs ?? nowMs,
    collected: true,
    collectDepartedISO: prev?.collectDepartedISO ?? nowISO,
    pendingDeparture: false,
  };

  const lastComplete =
    stage.kind === "delivered" ? stage.dropIdx : stage.dropIdx - 1;
  const completed: number[] = [];
  for (let i = 0; i <= lastComplete; i++) completed.push(i);

  // Keep the real arrival/departure the cron recorded for stops that stay
  // completed; only stamp the ones this seed is newly asserting.
  const prevMeta = run.completedMeta ?? {};
  const completedMeta: CompletedMeta = {};
  for (const i of completed) {
    completedMeta[i] = prevMeta[i] ?? { atISO: nowISO, by: "admin" };
  }

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

/**
 * Which stage a load currently reads as — the select's resting value.
 *
 * A normalising inverse of seedPatch: states that are genuinely identical
 * report the same stage. "Delivered drop 1" of three drops IS "heading to
 * drop 2", so that is what comes back.
 */
export function currentStage(run: PlannedRun, plan: RoutePlan): StageId {
  const dropIdxs = plan.legs.flatMap((l) =>
    l.kind === "drop" && l.stopIndex != null ? [l.stopIndex] : [],
  );

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

  // onSiteIdx wins wherever it points, not just at the first outstanding
  // drop: the cron completes whichever uncompleted stop the vehicle is
  // INSIDE, chosen by distance, and drivers reorder their drops. Ignored once
  // that drop is done, because the cron clears onSiteIdx on departure and a
  // stale value must not outrank the real progress.
  const onSite = run.progress?.onSiteIdx;
  if (onSite != null && dropIdxs.includes(onSite) && !done.has(onSite)) {
    return stageId({ kind: "on-site", dropIdx: onSite });
  }

  const next = outstanding[0];
  const moving = !!run.progress?.collectDepartedISO || done.size > 0;

  if (next != null && moving) {
    return stageId({ kind: "heading-to", dropIdx: next });
  }

  if (run.progress?.collectArrivedMs != null) return "at-collection";
  return "not-started";
}
