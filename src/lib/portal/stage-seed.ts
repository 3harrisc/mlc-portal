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

  if (kind === "heading-to" || kind === "on-site" || kind === "delivered") {
    return { kind, dropIdx };
  }
  return null;
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
    return { progress: base, ...empty };
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
