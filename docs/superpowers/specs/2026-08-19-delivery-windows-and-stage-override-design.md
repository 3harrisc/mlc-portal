# Delivery windows + manual stage override

**Date:** 2026-08-19
**Status:** Approved, not yet implemented

Two independent features that happen to share one migration:

1. **Per-stop delivery windows** — every stop can carry a `from–to` delivery
   slot instead of a single booking time.
2. **Manual stage override** — an admin can force a load's headline status
   instead of accepting the geofence-derived one.

---

## Background

A backload today has four time/date fields on `PlannedRun`:

| Field | Meaning |
| --- | --- |
| `date` | delivery date |
| `collectionDate` | collection day, when it differs from `date` |
| `collectionTime` | pickup slot at `fromPostcode` |
| `bookingTime` | a single delivery time |

So a delivery *date* already exists — `/runs` renders `Collect X → Deliver Y`
off `collectionDate` vs `date`. What is missing is a delivery *window*, and
any way to correct the automatically-derived stage.

Stops live as free-text lines in `raw_text`, one per line:

```
NG22 8TX 12:30 REF:FC156297 ADDR:Unit 4, Somewhere Ind Est
```

`parseStops()` / `parseStopsWithTimes()` in `src/lib/postcode-utils.ts` are the
only readers of that format. `parseStopTime()` scans the portion of the line
*before* any `REF:`/`ADDR:` marker and returns the first `HH:MM` it finds.

Status is derived — there is no status column. `deriveStatus(run, todayISO)` in
`src/lib/portal/loads.ts` infers one of six values from progress + date +
vehicle. It has four production call sites:

- `src/components/portal/PortalDataContext.tsx:59`
- `src/app/portal/loads/[id]/page.tsx:327`
- `src/app/portal/loads/day/[date]/page.tsx:410`
- `src/app/track/[token]/page.tsx:59` (the public share-link tracker)

---

## Part 1 — Per-stop delivery windows

### Decisions

- Windows are **per stop**, not per run.
- They apply to **all run types**, not just backloads.
- They are stored by **extending the `raw_text` line format**, not in a new
  column.
- They are edited through a **structured per-stop editor**, not a textarea.
- They **drive behaviour**: ETA floors at the window start, and running past
  the window end flags the load as delayed.

### Line format

```
NG22 8TX 08:00                                  point booking (unchanged)
NG22 8TX 08:00-12:00                            window
NG22 8TX 08:00-12:00 REF:FC156297 ADDR:Unit 4   window + metadata
```

The separator accepts `-`, `–`, `—`, with or without surrounding spaces.

**Why this needs no data migration:** `parseStopTime()` returns the *first*
`HH:MM` on the line, so on `08:00-12:00` it already returns `08:00` — the
window start. Every existing caller keeps working unchanged, and a stop with
no window behaves exactly as it does today.

Ranges are only recognised in the pre-`REF:`/pre-`ADDR:` head of the line, so a
hyphenated reference or a time-shaped fragment inside an address cannot be
mistaken for a window.

### Parsing changes — `src/lib/postcode-utils.ts`

- `parseStopTime(line)` — **contract unchanged**. Returns the single time, or
  the window start.
- `parseStopWindow(line): { from: string; to: string } | null` — new. Returns
  `null` when the line has no range.
- `StopWithTime` gains `windowEnd: string | null`.
- `parseStopsWithTimes()` populates `windowEnd`. Its index-alignment guarantee
  with `parseStops()` is preserved — both still emit a row only when a postcode
  is found.

### Behaviour changes — `src/lib/portal/loads.ts`

**ETA floor.** No change required. `liveEtaToNextStop()` already floors the
projected ETA at the target stop's parsed time, which is now the window start.
This falls out of the format choice rather than needing new code.

**New accessor.** `bookedDeliveryWindow(run): { from: string; to: string } | null`
— the window on the last timed stop, for display alongside `bookedDeliverySlot()`.

**New helper.** `nextOutstandingIndex(run): number | null` — the first stop
index not present in `completedStopIndexes` union `progress.completedIdx`.
Extracted from the equivalent inline logic in `liveEtaToNextStop()` and reused
by both.

**Late flagging.** `deriveStatus` gains a rule: when the run would otherwise be
`loading` or `in-transit`, **and** `run.date === todayISO`, **and** the next
outstanding stop has a window end, **and** UK-local now is past that end →
return `delayed`.

The `run.date === todayISO` guard is deliberate: without it, every historic
load with a window would retroactively render as delayed.

**Signature.** `deriveStatus(run, todayISO, now: Date = new Date())`. The third
parameter is optional so all four call sites compile untouched, and tests can
inject a clock. The existing module-private `ukMinutesOfDay()` helper does the
UK-local conversion — the same one `liveEtaToNextStop()` uses, so BST is handled
identically.

### Edit UI — `src/components/portal/StopsEditor.tsx` (new)

Replaces the raw stops textarea in `LoadEditModal`.

- One row per stop: postcode (mono, uppercased), from-time, to-time, ref.
- Row controls: move up, move down, remove. Plus an "Add stop" button.
- Seeded by parsing `raw_text` on open; serialises back to `raw_text` on save,
  so the storage format stays the single source of truth.
- **Round-trips `ADDR:` invisibly.** The editor does not surface the address,
  but must carry it through untouched — `email-to-run` writes it and the
  geocoder uses it to pin locations more accurately. Dropping it on an edit
  would silently degrade positioning.
- **Raw-text escape hatch.** A toggle swaps back to the plain textarea for any
  line the structured editor cannot model (e.g. a line carrying no postcode).

`LoadEdits.rawText` keeps its current type, so the `updateLoad` server action
and the load detail page's save path need no changes.

### Out of scope

`/portal/plan` and `/plan-route` keep their existing stops textareas. Windows
can be typed by hand there (`08:00-12:00` parses correctly on entry) or set
afterwards via Edit run. Both files are ~1000 lines with their own stop state
and reordering logic; folding the structured editor into them is a follow-up,
not part of this change.

---

## Part 2 — Manual stage override

### Decisions

- The override targets the **headline stage pill**, not per-stop progress.
- It is **sticky until explicitly cleared** — nothing automatic ever clears it.
- It is **admin-only** to set, and **shown plainly** to everyone, including
  customers on the public tracker.

### Migration 018

Adds to **both** `runs` and `loads`:

```sql
status_override     text        -- null = derive automatically
status_override_by  uuid        -- references auth.users(id)
status_override_at  timestamptz
```

`status_override` carries a CHECK constraint on the six valid values:
`'in-transit'`, `'delivered'`, `'scheduled'`, `'exception'`, `'delayed'`,
`'loading'`.

**Both tables must be altered explicitly.** Migration 013 created `loads` with
`CREATE TABLE loads (LIKE runs INCLUDING ALL)`, which copies the shape at
creation time and does *not* track columns added to `runs` afterwards.

Written idempotently (`add column if not exists`) to match the house style in
migrations 010-017.

### Type changes — `src/types/runs.ts`

`PlannedRun` gains:

```ts
statusOverride?: LoadStatus | null;
statusOverrideBy?: string;
statusOverrideAt?: string;   // ISO timestamp
```

mapped in both `rowToRun()` and `runToRow()` alongside the existing optional
columns.

### Housekeeping — `src/lib/portal/status.ts` (new)

`LoadStatus` and `STATUS_LABEL` currently live in
`src/components/portal/StatusPill.tsx`. `types/runs.ts` must not import a React
component to type a database field, so both move to a new
`src/lib/portal/status.ts`. `StatusPill.tsx` re-exports them, leaving every
existing import site working unchanged.

This is the one piece of incidental refactoring in the change, and it exists
only because the feature needs it.

### Choke point — `deriveStatus`

```ts
export function deriveStatus(run, todayISO, now = new Date()): LoadStatus {
  if (run.statusOverride) return run.statusOverride;
  // ...existing derivation, plus the window-lateness rule from Part 1
}
```

All four production call sites inherit the override for free, including the
public `/track/[token]` page.

### Server actions

- `setLoadStatusOverride(id: string, status: LoadStatus | null)` in
  `src/app/actions/loads.ts`
- `setRunStatusOverride(id: string, status: LoadStatus | null)` in
  `src/app/actions/runs.ts`

Both re-check `profiles.role === 'admin'` server-side — following the pattern
already used by `deleteLoads` — rather than trusting the client-side `isAdmin`
flag. Passing `null` clears the override and stamps `status_override_by` and
`status_override_at` back to null.

### UI

On the load detail page (`src/app/portal/loads/[id]/page.tsx`), beside the
existing `StatusPill`:

- **Admins** see a dropdown reading `Auto (In transit)` by default, listing the
  six statuses. Selecting one sets the override; selecting `Auto` clears it.
- **When overridden**, a line beneath the pill reads
  *"Stage set manually by {name} at {time} - Revert to auto"* — shown to
  customers as well as admins.

`{name}` is resolved by looking up `status_override_by` in `profiles`. When
that lookup returns nothing — deleted user, or a customer without read access
to that profile row — the line degrades to *"Stage set manually at {time}"*
rather than rendering a raw uuid or blocking the render. `{time}` is
`status_override_at` rendered in Europe/London, matching how every other
timestamp on the page is displayed.

Showing it rather than hiding it is deliberate: a customer seeing "Delivered"
while the tracker shows a moving truck otherwise has no explanation, and
neither will the operator reading the row three weeks later.

Nothing in `/api/cron/update-progress` reads or writes `status_override`. The
geofence pipeline continues to maintain `progress` exactly as it does now; the
override sits above it at read time only.

---

## Known trade-off

`delayed` acquires a second meaning. It currently means "dated in the past and
never started"; window-lateness adds "running now, past its slot". Same pill,
two causes.

Accepted deliberately — a customer wants to know their load is late, not which
internal rule concluded it. If the two need to be told apart later, the
window-lateness case is a single branch in `deriveStatus` and can be split into
its own status without touching anything else.

---

## Testing

`src/lib/portal/loads.test.ts` and the postcode-utils tests already cover this
area and are the natural home for:

- `parseStopWindow` — point time, range, range with `REF:`/`ADDR:` following,
  en-dash and spaced separators, no-time line, malformed range.
- `parseStopTime` back-compat — a range still returns its start.
- `parseStopsWithTimes` — index alignment with `parseStops` holds when some
  stops have windows and others do not.
- `deriveStatus` window-lateness — before the end (unchanged), after the end
  (delayed), after the end but dated in the past (unchanged, not
  retroactively delayed), and no window (unchanged). Clock injected via the
  new third parameter.
- `deriveStatus` override — each of the six values wins over the derived
  result, including over `delivered`; `null` falls through to derivation.
- `StopsEditor` round-trip — parse, edit, serialise preserves `ADDR:` and
  `REF:` metadata, and reordering rows moves windows with their stop.

---

## Part 3 — Collection times on the public tracker

Added after the original design review.

`/track/[token]` already renders arrived / departed / on-site times for every
drop, but the collection point gets only an inline pill. That pill shows
"Loading at {postcode} - since {HH:MM}" while on site and
"Collected {HH:MM} - en route" afterwards, so the **arrival** time at the
collection point — which `collectionTimes()` already computes as
`arrivedAt` — is never displayed at all.

The authenticated load page already treats collection as a proper leg with
both times (`src/app/portal/loads/[id]/page.tsx:604`). This ports that
treatment to the public tracker:

- A collection row at the head of the Stops list, badged `C`, showing
  `Arrived` / `Departed`, or `Loading since` while the lorry is on site.
- Badge reads **Loading** (blue) on site, **Collected** (green) once departed.
- The Stops card's render condition widens from `stops.length > 0` to also
  fire when collection has happened, so a backload with no parsed drops still
  shows its collection times.
- The existing inline pill stays — it is the at-a-glance summary; the row is
  the detail.

No new data, no schema change: `collectionTimes()` already returns everything
needed.
