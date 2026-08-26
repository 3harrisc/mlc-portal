# Timeline stage seed

**Date:** 2026-08-26
**Status:** Approved, not yet implemented

An admin can tell a load what stage its vehicle is actually at. The choice is
written into the load's real progress state and automatic tracking carries on
from there. It is a starting point, not a permanent override.

---

## Background

The event timeline on `/portal/loads/[id]` is built by `buildTimeline()` from
the route plan's legs plus geofence progress. Progress is owned by
`/api/cron/update-progress`, which runs every ~2 minutes and derives state from
Webfleet vehicle positions.

That derivation cannot know a vehicle is busy on work the portal never sees. A
tractor unit finishing a non-portal job still reports a position, so a load
booked to collect at 15:00 rendered as though it were already running:

- the timeline marked the first outstanding drop `Heading to CF83 1BQ`
- the ETA tile projected a live arrival from the vehicle's current position

### Prior work

`isEnRoute(run, completedIdx)` in `src/app/portal/loads/[id]/page.tsx` now
gates both the `Heading to` entry and the live ETA on a genuine movement
signal: departed the collection point, or at least one drop completed. It is
deliberately date-free, because a backload collects one day and delivers the
next, so the run's `date` says nothing about whether it has started today.

That stopped the display claiming movement that has not happened. It does not
let an operator say what *is* happening. This spec covers that.

Migration 018's `status_override` column pins the headline status pill. It
stays as-is and is **not** what this feature extends.

## The idea: seed, not pin

**Rejected:** a sticky "position override" column alongside `status_override`.
It needs expiry rules, an auto-release heuristic, a stale-pin warning, and
separate threading into every consumer.

**Adopted:** the control writes the **real progress fields**, stamped at the
moment it is set, then gets out of the way.

This works because every field the cron touches on the collection and
completion path is *latching* — it only ever advances:

| Field | Cron behaviour |
| --- | --- |
| `collectArrivedMs` | set once, when first near the collection postcode |
| `collected` | set true after the dwell threshold, never cleared |
| `collectDepartedISO` | set once, on departure |
| `completedIdx` | appended to, never removed from |

`update-progress/route.ts:308` skips the collection block entirely once
`collected` and `collectDepartedISO` are both set. A seeded state is therefore
durable: the cron resumes from it rather than fighting it.

What falls out for free:

- **No migration.** No new columns, no check constraint, no `loads`-table twin.
- **No cron changes.**
- **The customer share link corrects itself.** `/track/[token]` reads the same
  progress fields.
- **Nothing to explain to the customer.** There is no "set manually" caveat to
  render, because the state genuinely *is* the state.
- **The status pill follows.** `deriveStatus()` reads progress, so the pill
  lands on the right value without anyone touching `status_override`.

## The control

A `<select>` beneath the existing status pill on the load detail page,
labelled **Vehicle is currently**, rendered for admins only — matching
`StageOverrideControl`'s `isAdmin` gate.

Options are generated from the load's own `plan.legs`, so a load only offers
stages it actually has:

```
Not started
At collection · DN15 8QP
Heading to CF83 1BQ
On site at CF83 1BQ
Delivered · CF83 1BQ
```

The final three repeat per drop on multi-drop loads.

There is deliberately no separate "Loaded & departed" option: it would seed
byte-identical state to "Heading to <first drop>", so offering both would give
a select that snaps to a different label than the one just picked. The timeline
still renders a "Loaded & departed" *event* — that is unaffected.

There is no "Auto" entry. Because seeding writes real state there is no
override to revert to, so the select simply *shows* the stage the load
currently reads as, and changing it seeds a new one. The resting value is
always the truth as the system sees it.

## Stage to progress patch

`now` is the moment the admin makes the choice.

Every stage at or past the collection point stamps the collection fields with
`now`, so arrival and departure share a timestamp. That is deliberate: the seed
asserts a state, not a history it cannot know.

| Stage | Patch applied to `progress` |
| --- | --- |
| Not started | `collectArrivedMs=null`, `collected=false`, `collectDepartedISO=null`, `completedIdx=[]`, `onSiteIdx=null`, `onSiteSinceMs=null`, `pendingDeparture=undefined` |
| At collection | `collectArrivedMs=now`, `collected=true`, `collectDepartedISO=null` |
| Heading to drop N (also the state "loaded & departed" describes) | `collectArrivedMs=now`, `collected=true`, `collectDepartedISO=now`; `completedIdx` = every drop before N, each with `completedMeta[i] = { atISO: now, by: "admin" }`; `onSiteIdx=null` |
| On site at drop N | as "Heading to drop N", plus `onSiteIdx=N`, `onSiteSinceMs=now` |
| Delivered drop N | as "Heading to drop N", plus N itself in `completedIdx` with `completedMeta[N] = { atISO: now, by: "admin" }` |

Seeding is absolute, not additive: choosing a stage sets the load to exactly
that state, forwards or backwards. This keeps `currentStage` a true inverse and
avoids a control whose effect depends on what it is clicked from.

## Modules

Pure core, thin shell — the whole mapping is testable without a DB or browser.

- **`src/lib/portal/stage-seed.ts`** (new, pure):
  - `listStages(plan): Stage[]` — selectable stages for a load
  - `seedPatch(stage, run, now): ProgressPatch` — fields a stage implies
  - `currentStage(run, plan): Stage` — inverse; the stage a load reads as now
- **`src/app/actions/loads.ts`** — new `setLoadStage(id, stage)` action,
  modelled on `setLoadStatusOverride`
- **`src/components/portal/StageSeedControl.tsx`** — the select
- **`src/app/portal/loads/[id]/page.tsx`** — renders it

## Error handling

- **Non-admin:** control not rendered, and the server action re-checks role and
  rejects. Same shape as `setLoadStatusOverride`.
- **Write failure:** toast `Couldn't set stage: <error>`; the select reverts to
  its previous value.
- **Concurrent cron write:** the action writes to the DB server-side; the
  page's existing `progressChanged()` / `dbProgressRef` merge covers the
  client's next poll.

## Normalisation

`currentStage` is a *normalising* inverse, not a strict one. Two stage labels
can describe the same state, and it reports the canonical one:

- "Delivered drop N" where N is not the last drop is the same state as
  "Heading to drop N+1", and reports as the latter.
- "Delivered" reports as itself only for the final drop, when nothing is
  outstanding.

This is a property of the domain, not a defect: there is no state in which a
lorry has finished drop 1 of 3 and is not therefore heading to drop 2.

## Known sharp edge

Seeding *backwards* — choosing "Not started" while the vehicle is genuinely
parked at the collection postcode — will be re-detected by the cron within
~2 minutes and the fields set again. This is correct (reality wins) but reads
as the override "not taking". Documented, not defended against.

## Testing

`src/lib/portal/stage-seed.test.ts`, following the existing `loads.test.ts`
pattern:

- `listStages` for single-drop, multi-drop, and return-to-base plans
- `seedPatch` for every stage, including the backwards case clearing fields
- `currentStage(seedPatch(s))` returns `s` for every distinguishable stage,
  and normalises the rest (see below)
- a multi-drop "Heading to drop 3" patch marks drops 1 and 2 complete

## Out of scope

- An audit stamp for who seeded the *collection* fields. Drops already record
  `completedMeta[i].by = "admin"`; collection has nowhere to put it. Add a
  column only if disputes turn out to need it.
- Any change to `status_override` or `StageOverrideControl`.
- The `/runs` planner page, which has its own progress view.
