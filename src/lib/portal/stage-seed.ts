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
