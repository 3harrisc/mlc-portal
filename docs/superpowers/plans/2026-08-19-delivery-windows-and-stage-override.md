# Delivery Windows + Manual Stage Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every stop an optional `from–to` delivery window that drives ETA and late-flagging, let admins override the auto-derived stage, and surface collection arrive/depart times on the public share link.

**Architecture:** Windows piggyback on the existing `raw_text` line format (`POSTCODE 08:00-12:00 REF:… ADDR:…`) so no data migration is needed — `parseStopTime()` already returns the first `HH:MM`, which is the window start. The stage override is three new columns on `runs` and `loads`, read at the single choke point `deriveStatus()`, which all four display surfaces already call.

**Tech Stack:** Next.js App Router, React 19, Supabase (Postgres + RLS), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-19-delivery-windows-and-stage-override-design.md`

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/lib/postcode-utils.test.ts` | Tests for the stop-line parsers (no test file exists today) |
| `src/lib/portal/stop-lines.ts` | Parse `raw_text` into editable stop rows and serialise back |
| `src/lib/portal/stop-lines.test.ts` | Round-trip tests, incl. `REF:`/`ADDR:` preservation |
| `src/lib/portal/status.ts` | `LoadStatus` + `STATUS_LABEL`, free of React imports |
| `src/components/portal/StopsEditor.tsx` | Structured per-stop editor UI |
| `src/components/portal/StageOverrideControl.tsx` | Admin stage dropdown + "set manually" note |
| `supabase/migrations/018_status_override.sql` | Override columns on both tables |

**Modify:**

| File | Change |
| --- | --- |
| `src/lib/postcode-utils.ts` | Add `parseStopWindow`, add `windowEnd` to `StopWithTime` |
| `src/lib/portal/loads.ts` | Add `nextOutstandingIndex`, `bookedDeliveryWindow`; window-lateness + override in `deriveStatus` |
| `src/lib/portal/loads.test.ts` | Tests for the above |
| `src/components/portal/StatusPill.tsx` | Re-export from `status.ts` instead of declaring |
| `src/types/runs.ts` | `statusOverride` / `statusOverrideBy` / `statusOverrideAt` + mappers |
| `src/app/actions/loads.ts` | `setLoadStatusOverride` |
| `src/app/actions/runs.ts` | `setRunStatusOverride` |
| `src/components/portal/LoadEditModal.tsx` | Swap stops textarea for `StopsEditor` |
| `src/app/portal/loads/[id]/page.tsx` | Mount `StageOverrideControl`; show window on stops |
| `src/app/track/[token]/page.tsx` | Show window; add collection row with arrived/departed |

---

### Task 1: Parse delivery windows off a stop line

**Files:**
- Modify: `src/lib/postcode-utils.ts`
- Test: `src/lib/postcode-utils.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/postcode-utils.test.ts`:

```ts
/**
 * Stop-line parsing. The raw_text line format is the storage layer for
 * every stop in the system, so its edge cases are worth pinning down —
 * especially the back-compat guarantee that adding a window to a line
 * doesn't change what the pre-existing `parseStopTime` returns.
 */

import { describe, it, expect } from "vitest";
import { parseStopTime, parseStopWindow, parseStopsWithTimes } from "./postcode-utils";

describe("parseStopWindow", () => {
  it("returns null for a point booking", () => {
    expect(parseStopWindow("NG22 8TX 08:00")).toBeNull();
  });

  it("parses a hyphenated range", () => {
    expect(parseStopWindow("NG22 8TX 08:00-12:00")).toEqual({
      from: "08:00",
      to: "12:00",
    });
  });

  it("tolerates spaces and an en-dash", () => {
    expect(parseStopWindow("NG22 8TX 08:00 – 12:00")).toEqual({
      from: "08:00",
      to: "12:00",
    });
  });

  it("zero-pads a single-digit hour", () => {
    expect(parseStopWindow("NG22 8TX 8:00-9:30")).toEqual({
      from: "08:00",
      to: "09:30",
    });
  });

  it("ignores ranges that appear inside REF: or ADDR: metadata", () => {
    expect(
      parseStopWindow("NG22 8TX 08:00 REF:10:00-11:00 ADDR:Unit 4"),
    ).toBeNull();
  });

  it("returns null for a malformed end time", () => {
    expect(parseStopWindow("NG22 8TX 08:00-25:00")).toBeNull();
  });

  it("returns null when the line has no time at all", () => {
    expect(parseStopWindow("NG22 8TX REF:FC1")).toBeNull();
  });
});

describe("parseStopTime back-compat", () => {
  it("still returns the start of a window", () => {
    expect(parseStopTime("NG22 8TX 08:00-12:00")).toBe("08:00");
  });

  it("is unchanged for a point booking", () => {
    expect(parseStopTime("NG22 8TX 12:30 REF:FC156297")).toBe("12:30");
  });
});

describe("parseStopsWithTimes", () => {
  it("populates windowEnd only for stops that carry a range", () => {
    const raw = ["NG22 8TX 08:00-12:00", "BS20 7XN 14:00", "GU11 2HL"].join("\n");
    expect(parseStopsWithTimes(raw)).toEqual([
      { postcode: "NG22 8TX", time: "08:00", windowEnd: "12:00" },
      { postcode: "BS20 7XN", time: "14:00", windowEnd: null },
      { postcode: "GU11 2HL", time: null, windowEnd: null },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/postcode-utils.test.ts
```

Expected: FAIL — `parseStopWindow is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/postcode-utils.ts`, add above `parseStopTime`:

```ts
/** `HH:MM` in 24hr, hour optionally unpadded. Capturing: hour, minute. */
const TIME_SRC = String.raw`([01]?\d|2[0-3]):([0-5]\d)`;

/** A range: two times joined by a hyphen / en-dash / em-dash. */
const WINDOW_RE = new RegExp(String.raw`\b${TIME_SRC}\s*[-–—]\s*${TIME_SRC}\b`);

export interface StopWindow {
  /** Start of the window, "HH:MM". Also what `parseStopTime` returns. */
  from: string;
  /** End of the window, "HH:MM". */
  to: string;
}

/**
 * Extract a delivery window from a raw_text stop line, e.g.
 * "NG22 8TX 08:00-12:00 REF:FC1" → { from: "08:00", to: "12:00" }.
 *
 * Like `parseStopTime`, only the portion of the line BEFORE any REF:/ADDR:
 * marker is scanned, so a hyphenated reference or a time-shaped fragment
 * inside an address can never be mistaken for a window.
 *
 * Returns null when the line carries a single time or no time at all — a
 * malformed range (e.g. "08:00-25:00") also degrades to null, and
 * `parseStopTime` still picks up the valid leading "08:00".
 */
export function parseStopWindow(line: string): StopWindow | null {
  const head = (line || "").split(/\bREF:|\bADDR:/i)[0];
  const m = head.match(WINDOW_RE);
  if (!m) return null;
  return {
    from: `${m[1].padStart(2, "0")}:${m[2]}`,
    to: `${m[3].padStart(2, "0")}:${m[4]}`,
  };
}
```

Then replace the `StopWithTime` interface and the `parseStopsWithTimes` push:

```ts
export interface StopWithTime {
  postcode: string;
  /** Booking/delivery time parsed from the same line, or null. For a
   *  windowed stop this is the window START. */
  time: string | null;
  /** End of the delivery window when the line carries a range, else null. */
  windowEnd: string | null;
}
```

```ts
    if (pc) {
      out.push({
        postcode: pc,
        time: parseStopTime(line),
        windowEnd: parseStopWindow(line)?.to ?? null,
      });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/postcode-utils.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite — nothing else may regress**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/postcode-utils.ts src/lib/postcode-utils.test.ts
git commit -m "feat(stops): parse from-to delivery windows off raw_text lines"
```

---

### Task 2: Stop-line parse / serialise round-trip

**Files:**
- Create: `src/lib/portal/stop-lines.ts`
- Test: `src/lib/portal/stop-lines.test.ts`

This is the model layer under the structured editor in Task 9. Keeping it out
of the component means the round-trip is testable without rendering React.

- [ ] **Step 1: Write the failing test**

Create `src/lib/portal/stop-lines.test.ts`:

```ts
/**
 * The structured stops editor round-trips raw_text through these two
 * functions. If serialise(parse(x)) loses ADDR: metadata, geocoding
 * silently degrades for every load that gets edited — so the preservation
 * cases below matter more than they look.
 */

import { describe, it, expect } from "vitest";
import { canRoundTrip, parseStopLines, serialiseStopLines } from "./stop-lines";

describe("parseStopLines", () => {
  it("splits a full line into its parts", () => {
    expect(parseStopLines("NG22 8TX 08:00-12:00 REF:FC156297 ADDR:Unit 4, Newark")).toEqual([
      {
        postcode: "NG22 8TX",
        from: "08:00",
        to: "12:00",
        ref: "FC156297",
        addr: "Unit 4, Newark",
      },
    ]);
  });

  it("treats a point booking as a window with no end", () => {
    expect(parseStopLines("BS20 7XN 14:00")).toEqual([
      { postcode: "BS20 7XN", from: "14:00", to: "", ref: "", addr: "" },
    ]);
  });

  it("skips lines with no postcode", () => {
    expect(parseStopLines("NG22 8TX\n\nnot a stop\nBS20 7XN")).toHaveLength(2);
  });
});

describe("serialiseStopLines", () => {
  it("writes a window as a range", () => {
    expect(
      serialiseStopLines([
        { postcode: "NG22 8TX", from: "08:00", to: "12:00", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX 08:00-12:00");
  });

  it("writes a point booking as a single time", () => {
    expect(
      serialiseStopLines([
        { postcode: "NG22 8TX", from: "08:00", to: "", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX 08:00");
  });

  it("drops an end time with no start — a window needs an opening", () => {
    expect(
      serialiseStopLines([
        { postcode: "NG22 8TX", from: "", to: "12:00", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX");
  });

  it("uppercases the postcode and drops blank rows", () => {
    expect(
      serialiseStopLines([
        { postcode: "ng22 8tx", from: "", to: "", ref: "", addr: "" },
        { postcode: "   ", from: "", to: "", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX");
  });
});

describe("round trip", () => {
  it("preserves REF: and ADDR: through parse → serialise", () => {
    const raw = "NG22 8TX 08:00-12:00 REF:FC156297 ADDR:Unit 4, Newark";
    expect(serialiseStopLines(parseStopLines(raw))).toBe(raw);
  });

  it("preserves metadata across a reorder", () => {
    const raw = [
      "NG22 8TX 08:00-12:00 REF:A ADDR:First",
      "BS20 7XN 14:00 REF:B ADDR:Second",
    ].join("\n");
    const [a, b] = parseStopLines(raw);
    expect(serialiseStopLines([b, a])).toBe(
      ["BS20 7XN 14:00 REF:B ADDR:Second", "NG22 8TX 08:00-12:00 REF:A ADDR:First"].join("\n"),
    );
  });
});

describe("canRoundTrip", () => {
  it("is true when every non-blank line yields a postcode", () => {
    expect(canRoundTrip("NG22 8TX 08:00\n\nBS20 7XN")).toBe(true);
  });

  it("is false when a line carries no postcode", () => {
    expect(canRoundTrip("NG22 8TX\nMiddleton Foods")).toBe(false);
  });

  it("is true for empty text", () => {
    expect(canRoundTrip("")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/portal/stop-lines.test.ts
```

Expected: FAIL — cannot resolve `./stop-lines`.

- [ ] **Step 3: Implement**

Create `src/lib/portal/stop-lines.ts`:

```ts
/**
 * The editable view of a raw_text stop list.
 *
 * `raw_text` is the storage format ("NG22 8TX 08:00-12:00 REF:… ADDR:…",
 * one stop per line) and stays the single source of truth. This module is
 * the bridge to a structured editor: parse lines into rows, let the UI edit
 * them, serialise straight back.
 *
 * The `addr` field is deliberately carried even though the editor never
 * shows it — the email parser writes it and the geocoder uses it to pin
 * locations more precisely than a postcode centroid can. Dropping it on
 * save would quietly degrade positioning for every edited load.
 */

import { extractPostcode, parseStopTime, parseStopWindow } from "@/lib/postcode-utils";

export interface StopLine {
  /** Normalised postcode, e.g. "NG22 8TX". */
  postcode: string;
  /** Window start, or the single booking time. "" when unset. */
  from: string;
  /** Window end. "" for a point booking. */
  to: string;
  /** Customer reference, "" when absent. */
  ref: string;
  /** Full address hint for the geocoder. Preserved, never surfaced. */
  addr: string;
}

function splitLines(rawText: string): string[] {
  return (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Pull a `REF:` / `ADDR:` value off a line. REF stops at ADDR; ADDR runs on. */
function readTag(line: string, tag: "REF" | "ADDR"): string {
  const re =
    tag === "REF" ? /\bREF:(.*?)(?=\s*\bADDR:|$)/i : /\bADDR:(.*)$/i;
  const m = line.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Parse raw_text into editable rows. Lines carrying no postcode are skipped
 * — call `canRoundTrip` first if you need to know whether that would lose
 * anything.
 */
export function parseStopLines(rawText: string): StopLine[] {
  const out: StopLine[] = [];
  for (const line of splitLines(rawText)) {
    const postcode = extractPostcode(line);
    if (!postcode) continue;
    const win = parseStopWindow(line);
    out.push({
      postcode,
      from: win?.from ?? parseStopTime(line) ?? "",
      to: win?.to ?? "",
      ref: readTag(line, "REF"),
      addr: readTag(line, "ADDR"),
    });
  }
  return out;
}

/**
 * Serialise rows back to raw_text. A row with a `to` but no `from` loses the
 * `to` — a window has to have an opening, and silently inventing one would
 * be worse than dropping it. The editor prevents this state anyway.
 */
export function serialiseStopLines(stops: StopLine[]): string {
  return stops
    .map((s) => {
      const postcode = s.postcode.trim().toUpperCase();
      if (!postcode) return "";
      const parts = [postcode];
      const from = s.from.trim();
      const to = s.to.trim();
      if (from && to) parts.push(`${from}-${to}`);
      else if (from) parts.push(from);
      if (s.ref.trim()) parts.push(`REF:${s.ref.trim()}`);
      if (s.addr.trim()) parts.push(`ADDR:${s.addr.trim()}`);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * True when every non-blank line yields a postcode, i.e. the structured
 * editor can represent this raw_text without losing a line. When false the
 * caller should fall back to plain textarea editing.
 */
export function canRoundTrip(rawText: string): boolean {
  return splitLines(rawText).every((l) => extractPostcode(l) !== null);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/portal/stop-lines.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/stop-lines.ts src/lib/portal/stop-lines.test.ts
git commit -m "feat(stops): parse/serialise raw_text stop lines for structured editing"
```

---

### Task 3: Next-outstanding-stop and window accessors

**Files:**
- Modify: `src/lib/portal/loads.ts`
- Test: `src/lib/portal/loads.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/portal/loads.test.ts`:

```ts
describe("nextOutstandingIndex", () => {
  it("is 0 when nothing is done", () => {
    const r = run({ rawText: "NG22 8TX\nBS20 7XN" });
    expect(nextOutstandingIndex(r)).toBe(0);
  });

  it("skips stops completed via either source", () => {
    const r = run({
      rawText: "NG22 8TX\nBS20 7XN\nGU11 2HL",
      completedStopIndexes: [0],
      progress: {
        completedIdx: [1],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
      },
    });
    expect(nextOutstandingIndex(r)).toBe(2);
  });

  it("is null when every stop is done", () => {
    const r = run({ rawText: "NG22 8TX", completedStopIndexes: [0] });
    expect(nextOutstandingIndex(r)).toBeNull();
  });

  it("is null when there are no stops", () => {
    expect(nextOutstandingIndex(run({ rawText: "" }))).toBeNull();
  });
});

describe("bookedDeliveryWindow", () => {
  it("returns the window on the last windowed stop", () => {
    const r = run({ rawText: "NG22 8TX 06:00-07:00\nBS20 7XN 08:00-12:00" });
    expect(bookedDeliveryWindow(r)).toEqual({ from: "08:00", to: "12:00" });
  });

  it("is null when stops carry point times only", () => {
    const r = run({ rawText: "NG22 8TX 08:00\nBS20 7XN 14:00" });
    expect(bookedDeliveryWindow(r)).toBeNull();
  });

  it("is null when there are no stops", () => {
    expect(bookedDeliveryWindow(run({ rawText: "" }))).toBeNull();
  });
});

describe("liveEtaToNextStop — window floor", () => {
  // The spec claims the ETA floor needs no new code: parseStopTime already
  // returns the window START, which is what liveEtaToNextStop floors at.
  // That's a load-bearing claim, so pin it down.
  const coords = new Map([["GU11 2HL", { lat: 51.25, lng: -0.76 }]]);
  // Effectively on top of the stop, so travel time is ~0 and the floor is
  // the only thing that can move the answer.
  const truckPos = { lat: 51.25, lng: -0.76 };

  it("never promises earlier than the window opens", () => {
    const r = run({ rawText: "GU11 2HL 08:00-12:00" });
    // 06:00 UK — two hours before the window opens.
    const now = new Date("2026-04-30T05:00:00Z");
    expect(liveEtaToNextStop(r, { truckPos, coords, now })).toBe("08:00");
  });

  it("reports the real arrival once the window is open", () => {
    const r = run({ rawText: "GU11 2HL 08:00-12:00" });
    // 09:30 UK — inside the window, so the projection wins over the floor.
    const now = new Date("2026-04-30T08:30:00Z");
    expect(liveEtaToNextStop(r, { truckPos, coords, now })).toBe("09:30");
  });
});
```

Add `nextOutstandingIndex` and `bookedDeliveryWindow` to the existing import
block at the top of that file (it already imports `bookedDeliverySlot`,
`deriveStatus`, etc. from `./loads`).

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/portal/loads.test.ts
```

Expected: FAIL — `nextOutstandingIndex is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/portal/loads.ts`, add after `bookedDeliverySlot`:

```ts
/**
 * Index of the first stop that hasn't been completed, or null when the run
 * is finished or has no stops.
 *
 * Completion has two sources — the legacy `completedStopIndexes` array and
 * the cron-owned `progress.completedIdx` — and both have to be consulted.
 * Extracted here so `liveEtaToNextStop` and the window-lateness rule in
 * `deriveStatus` agree on which stop we're heading to.
 */
export function nextOutstandingIndex(run: PlannedRun): number | null {
  const stops = parseStops(run.rawText);
  const completed = new Set([
    ...(run.completedStopIndexes ?? []),
    ...(run.progress?.completedIdx ?? []),
  ]);
  const idx = stops.findIndex((_, i) => !completed.has(i));
  return idx === -1 ? null : idx;
}

/**
 * The booked delivery WINDOW, when the run has one — the counterpart to
 * `bookedDeliverySlot`, which returns just the opening time.
 *
 * Scans backwards for the last stop carrying a range, on the same reasoning
 * as `bookedDeliverySlot`: the final timed stop is the customer delivery,
 * earlier ones are intermediate drops.
 */
export function bookedDeliveryWindow(
  run: PlannedRun,
): { from: string; to: string } | null {
  const timed = parseStopsWithTimes(run.rawText);
  for (let i = timed.length - 1; i >= 0; i--) {
    const { time, windowEnd } = timed[i];
    if (time && windowEnd) return { from: time, to: windowEnd };
  }
  return null;
}
```

Then simplify `liveEtaToNextStop` to reuse the helper. Replace these lines:

```ts
  const stops = parseStops(run.rawText);
  const completed = new Set([
    ...(run.completedStopIndexes ?? []),
    ...(run.progress?.completedIdx ?? []),
  ]);
  const targetIdx = stops.findIndex((_, i) => !completed.has(i));
  if (targetIdx === -1) return null;
```

with:

```ts
  const stops = parseStops(run.rawText);
  const targetIdx = nextOutstandingIndex(run);
  if (targetIdx == null) return null;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/portal/loads.test.ts
```

Expected: PASS — the new tests plus every pre-existing one (the
`liveEtaToNextStop` refactor is behaviour-preserving and its tests must
still pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/loads.ts src/lib/portal/loads.test.ts
git commit -m "feat(loads): add nextOutstandingIndex and bookedDeliveryWindow"
```

---

### Task 4: Flag a load delayed once it runs past its window

**Files:**
- Modify: `src/lib/portal/loads.ts`
- Test: `src/lib/portal/loads.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/portal/loads.test.ts`:

```ts
describe("deriveStatus — delivery window lateness", () => {
  const today = "2026-04-30";
  /** 13:00 UK on the test's "today". BST, so 12:00Z. */
  const afterWindow = new Date("2026-04-30T12:00:00Z");
  /** 09:00 UK on the test's "today". */
  const insideWindow = new Date("2026-04-30T08:00:00Z");

  const moving = {
    completedIdx: [],
    onSiteIdx: null,
    onSiteSinceMs: null,
    lastInside: false,
    collectDepartedISO: "2026-04-30T06:00:00Z",
  };

  it("stays in-transit while inside the window", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00-12:00",
      progress: moving,
    });
    expect(deriveStatus(r, today, insideWindow)).toBe("in-transit");
  });

  it("flips to delayed once the window has closed", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00-12:00",
      progress: moving,
    });
    expect(deriveStatus(r, today, afterWindow)).toBe("delayed");
  });

  it("flags a load still loading past its window", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00-12:00",
    });
    expect(deriveStatus(r, today, afterWindow)).toBe("delayed");
  });

  it("ignores the window on a stop that is already done", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00-12:00\nBS20 7XN 20:00-22:00",
      completedStopIndexes: [0],
      progress: moving,
    });
    expect(deriveStatus(r, today, afterWindow)).toBe("in-transit");
  });

  it("does not apply the window rule to a load dated in the past", () => {
    // Yesterday's load, still moving, past a window that closed at 12:00.
    // The window rule is gated to today, so this must stay in-transit —
    // if the gate were missing it would read "delayed".
    const r = run({
      date: "2026-04-29",
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00-12:00",
      progress: moving,
    });
    expect(deriveStatus(r, today, afterWindow)).toBe("in-transit");
  });

  it("is unaffected when the stop has no window", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00",
      progress: moving,
    });
    expect(deriveStatus(r, today, afterWindow)).toBe("in-transit");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/portal/loads.test.ts -t "delivery window lateness"
```

Expected: FAIL — "flips to delayed once the window has closed" returns
`in-transit`.

- [ ] **Step 3: Implement**

In `src/lib/portal/loads.ts`, replace the whole `deriveStatus` function with:

```ts
export function deriveStatus(
  run: PlannedRun,
  todayISO: string,
  now: Date = new Date(),
): LoadStatus {
  const stops = parseStops(run.rawText);
  const completed = completedCount(run);

  if (stops.length > 0 && completed >= stops.length) return "delivered";

  // "Moving" = at least one drop done, or the lorry has left the collection
  // point. Either way it's genuinely on the road rather than still loading.
  const moving = completed > 0 || !!run.progress?.collectDepartedISO;
  const isToday = run.date === todayISO;
  const hasVehicle = !!run.vehicle?.trim();

  // Past the booked window on the day it's running. Checked before the
  // in-transit / loading branches so a load that's moving but late reads as
  // late — that's the thing the customer needs to know. Gated to today so
  // historic loads with windows aren't retroactively turned red.
  if (isToday && (moving || hasVehicle) && pastWindowEnd(run, now)) {
    return "delayed";
  }

  if (moving) return "in-transit";
  if (isToday && hasVehicle) return "loading";
  if (run.date < todayISO) return "delayed";
  return "scheduled";
}

/**
 * True when UK-local `now` is past the closing time of the window on the
 * next outstanding stop. False when that stop has no window, or every stop
 * is done.
 */
function pastWindowEnd(run: PlannedRun, now: Date): boolean {
  const idx = nextOutstandingIndex(run);
  if (idx == null) return false;
  const end = parseStopsWithTimes(run.rawText)[idx]?.windowEnd;
  const endMins = timeToMinutes(end ?? undefined);
  if (endMins == null) return false;
  return ukMinutesOfDay(now) > endMins;
}
```

Move the existing `ukMinutesOfDay` helper above `deriveStatus` if it isn't
already — it's currently declared further down the file, and function
declarations hoist, but keeping it near its callers reads better.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/portal/loads.test.ts
```

Expected: PASS — the six new tests plus the two pre-existing
"deriveStatus — collection departure" tests, which call `deriveStatus` with
two arguments and must still work.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/loads.ts src/lib/portal/loads.test.ts
git commit -m "feat(status): flag a load delayed once it runs past its delivery window"
```

---

### Task 5: Extract LoadStatus out of the React component

**Files:**
- Create: `src/lib/portal/status.ts`
- Modify: `src/components/portal/StatusPill.tsx`

Pure refactor — no behaviour change. `types/runs.ts` must be able to type the
override column without importing a React component, which it can't do today.

- [ ] **Step 1: Create the module**

Create `src/lib/portal/status.ts`:

```ts
/**
 * The customer-facing load status enum.
 *
 * Lives here rather than beside StatusPill because `types/runs.ts` needs it
 * to type the `status_override` column, and a types module has no business
 * importing a React component. StatusPill re-exports both names so every
 * existing import site keeps working.
 */

export type LoadStatus =
  | "in-transit"
  | "delivered"
  | "scheduled"
  | "exception"
  | "delayed"
  | "loading";

export const STATUS_LABEL: Record<LoadStatus, string> = {
  "in-transit": "In transit",
  delivered: "Delivered",
  scheduled: "Scheduled",
  exception: "Exception",
  delayed: "Delayed",
  loading: "Loading",
};

/** Every value, in the order the override dropdown should list them. */
export const ALL_STATUSES: LoadStatus[] = [
  "scheduled",
  "loading",
  "in-transit",
  "delivered",
  "delayed",
  "exception",
];
```

- [ ] **Step 2: Point StatusPill at it**

In `src/components/portal/StatusPill.tsx`, delete the `LoadStatus` type and
the `STATUS_LABEL` const, and add at the top:

```ts
import type { CSSProperties } from "react";
import { STATUS_LABEL, type LoadStatus } from "@/lib/portal/status";

export { STATUS_LABEL };
export type { LoadStatus };
```

Leave the component body untouched.

- [ ] **Step 3: Verify nothing broke**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/portal/status.ts src/components/portal/StatusPill.tsx
git commit -m "refactor(status): move LoadStatus into lib so types can import it"
```

---

### Task 6: Migration 018 and the override fields on PlannedRun

**Files:**
- Create: `supabase/migrations/018_status_override.sql`
- Modify: `src/types/runs.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/018_status_override.sql`:

```sql
-- Manual stage override for runs and loads.
--
-- Why this exists
-- ----------------
-- Load status is DERIVED, not stored — deriveStatus() in
-- src/lib/portal/loads.ts infers it from geofence progress + date + vehicle.
-- That's right almost always and wrong exactly when it matters: a breakdown,
-- a refused delivery, a tracker outage. These columns let an admin pin the
-- status; deriveStatus returns the override before consulting anything else.
--
-- The override is sticky. Nothing in /api/cron/update-progress reads or
-- writes it — only an explicit admin action sets or clears it.
--
-- IMPORTANT: both tables need altering separately. Migration 013 created
-- `loads` with CREATE TABLE loads (LIKE runs INCLUDING ALL), which copies
-- the shape at creation time and does NOT track columns added to `runs`
-- afterwards.

alter table runs  add column if not exists status_override    text;
alter table runs  add column if not exists status_override_by uuid;
alter table runs  add column if not exists status_override_at timestamptz;

alter table loads add column if not exists status_override    text;
alter table loads add column if not exists status_override_by uuid;
alter table loads add column if not exists status_override_at timestamptz;

-- Constraints are added conditionally so re-running the migration is safe
-- (ADD CONSTRAINT has no IF NOT EXISTS form).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runs_status_override_check'
  ) then
    alter table runs add constraint runs_status_override_check
      check (status_override is null or status_override in
        ('in-transit', 'delivered', 'scheduled', 'exception', 'delayed', 'loading'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'loads_status_override_check'
  ) then
    alter table loads add constraint loads_status_override_check
      check (status_override is null or status_override in
        ('in-transit', 'delivered', 'scheduled', 'exception', 'delayed', 'loading'));
  end if;

  -- LIKE doesn't copy foreign keys, so both get theirs added by hand — same
  -- reason migration 013 re-added the created_by FK.
  if not exists (
    select 1 from pg_constraint where conname = 'runs_status_override_by_fkey'
  ) then
    alter table runs add constraint runs_status_override_by_fkey
      foreign key (status_override_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'loads_status_override_by_fkey'
  ) then
    alter table loads add constraint loads_status_override_by_fkey
      foreign key (status_override_by) references auth.users(id) on delete set null;
  end if;
end $$;
```

- [ ] **Step 2: Write the failing mapper test**

Append to `src/lib/portal/loads.test.ts`:

```ts
describe("rowToRun / runToRow — status override", () => {
  it("reads the override off a row", () => {
    const r = rowToRun({
      id: "x",
      date: "2026-04-30",
      customer: "Consolid8",
      from_postcode: "NG22 8TX",
      status_override: "exception",
      status_override_by: "user-uuid",
      status_override_at: "2026-04-30T09:00:00Z",
    });
    expect(r.statusOverride).toBe("exception");
    expect(r.statusOverrideBy).toBe("user-uuid");
    expect(r.statusOverrideAt).toBe("2026-04-30T09:00:00Z");
  });

  it("defaults to no override when the columns are absent", () => {
    const r = rowToRun({
      id: "x",
      date: "2026-04-30",
      customer: "Consolid8",
      from_postcode: "NG22 8TX",
    });
    expect(r.statusOverride).toBeNull();
  });

  it("writes the override back out", () => {
    const row = runToRow(run({ statusOverride: "delayed" }));
    expect(row.status_override).toBe("delayed");
  });

  it("writes null when there is no override", () => {
    expect(runToRow(run({})).status_override).toBeNull();
  });
});
```

Add `rowToRun, runToRow` to the `@/types/runs` import at the top of the test
file, and add these lines to the `run()` factory's returned object so the
helper can build overridden runs:

```ts
    statusOverride: p.statusOverride ?? null,
    statusOverrideBy: p.statusOverrideBy,
    statusOverrideAt: p.statusOverrideAt,
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/portal/loads.test.ts -t "status override"
```

Expected: FAIL — `statusOverride` is `undefined`, not `"exception"`.

- [ ] **Step 4: Add the fields and mappers**

In `src/types/runs.ts`, add the import:

```ts
import type { LoadStatus } from "@/lib/portal/status";
```

Add to the `PlannedRun` type, after `xeroExportedAt`:

```ts
  // Manual stage override (migration 018). null / undefined = derive the
  // status automatically from progress. Sticky until an admin clears it.
  statusOverride?: LoadStatus | null;
  statusOverrideBy?: string;
  statusOverrideAt?: string; // ISO timestamp
```

Add to `rowToRun`'s returned object:

```ts
    statusOverride: (row.status_override as LoadStatus | null) ?? null,
    statusOverrideBy: row.status_override_by ?? undefined,
    statusOverrideAt: row.status_override_at ?? undefined,
```

Add to `runToRow`'s returned object:

```ts
    status_override: run.statusOverride ?? null,
    status_override_by: run.statusOverrideBy ?? null,
    status_override_at: run.statusOverrideAt ?? null,
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/018_status_override.sql src/types/runs.ts src/lib/portal/loads.test.ts
git commit -m "feat(status): add status_override columns to runs and loads"
```

- [ ] **Step 7: Run the migration against Supabase**

Paste the contents of `supabase/migrations/018_status_override.sql` into the
Supabase SQL editor and run it. It is idempotent — safe to run twice.

Verify:

```sql
select column_name from information_schema.columns
where table_name in ('runs','loads') and column_name like 'status_override%'
order by table_name, column_name;
```

Expected: 6 rows (3 per table).

---

### Task 7: deriveStatus honours the override

**Files:**
- Modify: `src/lib/portal/loads.ts`
- Test: `src/lib/portal/loads.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/portal/loads.test.ts`:

```ts
describe("deriveStatus — manual override", () => {
  const today = "2026-04-30";

  it("wins over the derived status", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL",
      statusOverride: "exception",
    });
    expect(deriveStatus(r, today)).toBe("exception");
  });

  it("wins even over a fully delivered run", () => {
    const r = run({
      date: today,
      rawText: "GU11 2HL",
      completedStopIndexes: [0],
      statusOverride: "in-transit",
    });
    expect(deriveStatus(r, today)).toBe("in-transit");
  });

  it("wins over window lateness", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL 08:00-12:00",
      statusOverride: "in-transit",
    });
    expect(deriveStatus(r, today, new Date("2026-04-30T12:00:00Z"))).toBe("in-transit");
  });

  it("falls through to derivation when cleared", () => {
    const r = run({
      date: today,
      vehicle: "C12MLC",
      rawText: "GU11 2HL",
      statusOverride: null,
    });
    expect(deriveStatus(r, today)).toBe("loading");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/portal/loads.test.ts -t "manual override"
```

Expected: FAIL — returns `"loading"` instead of `"exception"`.

- [ ] **Step 3: Implement**

In `src/lib/portal/loads.ts`, make the override the very first line of
`deriveStatus`:

```ts
export function deriveStatus(
  run: PlannedRun,
  todayISO: string,
  now: Date = new Date(),
): LoadStatus {
  // An admin has pinned this status. Sticky — nothing automatic clears it.
  if (run.statusOverride) return run.statusOverride;

  const stops = parseStops(run.rawText);
  // …rest unchanged
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/loads.ts src/lib/portal/loads.test.ts
git commit -m "feat(status): honour the manual stage override in deriveStatus"
```

---

### Task 8: Admin-only server actions to set and clear the override

**Files:**
- Modify: `src/app/actions/loads.ts`
- Modify: `src/app/actions/runs.ts`

- [ ] **Step 1: Add the loads action**

Append to `src/app/actions/loads.ts` (after `setLoadVehicle`):

```ts
/**
 * Pin or clear the manual stage override on a load.
 *
 * Admin-only, re-checked server-side. The client's `isAdmin` flag decides
 * whether to RENDER the control; it must never be what decides whether the
 * write is allowed — same posture as `deleteLoads`.
 *
 * Passing `null` clears the override and the audit stamps with it, handing
 * the row back to automatic derivation.
 */
export async function setLoadStatusOverride(
  id: string,
  status: LoadStatus | null,
) {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Admin role required" };

  const { error } = await supabase
    .from("loads")
    .update({
      status_override: status,
      status_override_by: status ? user.id : null,
      status_override_at: status ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}
```

Add to the imports at the top of the file:

```ts
import type { LoadStatus } from "@/lib/portal/status";
```

- [ ] **Step 2: Add the runs action**

Append the same function to `src/app/actions/runs.ts`, renamed and pointed at
the other table:

```ts
/**
 * Pin or clear the manual stage override on a dispatch run. Twin of
 * `setLoadStatusOverride` in actions/loads.ts — see the note at the top of
 * this file about keeping the two tables' actions in step.
 */
export async function setRunStatusOverride(
  id: string,
  status: LoadStatus | null,
) {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Admin role required" };

  const { error } = await supabase
    .from("runs")
    .update({
      status_override: status,
      status_override_by: status ? user.id : null,
      status_override_at: status ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}
```

Add the same `LoadStatus` import to `src/app/actions/runs.ts`.

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. `runs.ts` has its own private `getUser()` helper that
returns the same `{ supabase, user }` shape as the one in `loads.ts`, so the
function body transplants unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/loads.ts src/app/actions/runs.ts
git commit -m "feat(status): admin-only actions to set and clear the stage override"
```

---

### Task 9: The structured stops editor

**Files:**
- Create: `src/components/portal/StopsEditor.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

/**
 * Structured editor for a load's stop list.
 *
 * Replaces free-text editing of raw_text in LoadEditModal. The parent owns
 * the StopLine[] state and does the raw_text (de)serialisation via
 * lib/portal/stop-lines — this component is pure UI over that array.
 *
 * The `addr` field on each row is carried but never rendered: the geocoder
 * uses it and losing it on an edit would silently worsen positioning.
 */

import type { StopLine } from "@/lib/portal/stop-lines";
import Icon from "./Icon";

export default function StopsEditor({
  stops,
  disabled = false,
  onChange,
}: {
  stops: StopLine[];
  disabled?: boolean;
  onChange: (next: StopLine[]) => void;
}) {
  function patch(index: number, field: keyof StopLine, value: string) {
    onChange(
      stops.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(stops.filter((_, i) => i !== index));
  }

  function add() {
    onChange([
      ...stops,
      { postcode: "", from: "", to: "", ref: "", addr: "" },
    ]);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "24px 1fr 92px 92px 1fr 56px",
          gap: 6,
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--ink-500)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        <span />
        <span>Postcode</span>
        <span>From</span>
        <span>To</span>
        <span>Reference</span>
        <span />
      </div>

      {stops.map((stop, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "24px 1fr 92px 92px 1fr 56px",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span className="muted mono" style={{ fontSize: 11, textAlign: "right" }}>
            {i + 1}
          </span>
          <input
            type="text"
            value={stop.postcode}
            onChange={(e) => patch(i, "postcode", e.target.value.toUpperCase())}
            disabled={disabled}
            placeholder="NG22 8TX"
            className="input mono"
            style={{ height: 30, textTransform: "uppercase" }}
          />
          <input
            type="time"
            value={stop.from}
            onChange={(e) => {
              const from = e.target.value;
              // Clearing the start clears the end too — a window with no
              // opening can't be serialised, so don't let the UI hold one.
              onChange(
                stops.map((s, idx) =>
                  idx === i ? { ...s, from, to: from ? s.to : "" } : s,
                ),
              );
            }}
            disabled={disabled}
            className="input mono"
            style={{ height: 30 }}
          />
          <input
            type="time"
            value={stop.to}
            onChange={(e) => patch(i, "to", e.target.value)}
            disabled={disabled || !stop.from}
            title={stop.from ? "Window closes" : "Set a from-time first"}
            className="input mono"
            style={{ height: 30 }}
          />
          <input
            type="text"
            value={stop.ref}
            onChange={(e) => patch(i, "ref", e.target.value)}
            disabled={disabled}
            placeholder="optional"
            className="input mono"
            style={{ height: 30 }}
          />
          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={disabled || i === 0}
              className="btn sm ghost icon-btn"
              aria-label={`Move stop ${i + 1} up`}
            >
              <Icon name="arrowUp" size={11} />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={disabled || i === stops.length - 1}
              className="btn sm ghost icon-btn"
              aria-label={`Move stop ${i + 1} down`}
            >
              <Icon name="arrowDown" size={11} />
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              className="btn sm ghost icon-btn"
              aria-label={`Remove stop ${i + 1}`}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="btn sm ghost"
        >
          + Add stop
        </button>
      </div>

      <span className="muted" style={{ fontSize: 11 }}>
        Leave <em>To</em> blank for a fixed booking time. Set both for a
        delivery window — the ETA never reads earlier than <em>From</em>, and
        the load flags as delayed once <em>To</em> passes.
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. (`arrowUp`, `arrowDown` and `x` all exist in
`src/components/portal/Icon.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/StopsEditor.tsx
git commit -m "feat(stops): structured per-stop editor with delivery windows"
```

---

### Task 10: Wire the editor into LoadEditModal

**Files:**
- Modify: `src/components/portal/LoadEditModal.tsx`

- [ ] **Step 1: Add the state and imports**

At the top of `src/components/portal/LoadEditModal.tsx`, add:

```ts
import StopsEditor from "./StopsEditor";
import {
  canRoundTrip,
  parseStopLines,
  serialiseStopLines,
  type StopLine,
} from "@/lib/portal/stop-lines";
```

Inside the component, after the `edits` state declaration, add:

```tsx
  // Structured stop rows, mirrored back into edits.rawText on every change so
  // the modal's save path (which hands back LoadEdits.rawText) is untouched.
  const [stopRows, setStopRows] = useState<StopLine[]>(() =>
    parseStopLines(run.rawText ?? ""),
  );
  // Fall back to the raw textarea when a line can't be modelled as a stop
  // row — otherwise opening the modal would silently delete it.
  const [rawMode, setRawMode] = useState(() => !canRoundTrip(run.rawText ?? ""));
```

Extend the existing reset effect so re-opening against a different run
reseeds both:

```tsx
  useEffect(() => {
    if (!open) return;
    setEdits(seedFromRun(run));
    setStopRows(parseStopLines(run.rawText ?? ""));
    setRawMode(!canRoundTrip(run.rawText ?? ""));
  }, [open, run]);
```

Add the handler beside `update`:

```tsx
  function updateStops(next: StopLine[]) {
    setStopRows(next);
    setEdits((prev) => ({ ...prev, rawText: serialiseStopLines(next) }));
  }
```

- [ ] **Step 2: Replace the stops field**

Replace the entire `<Field label="Stops (one postcode per line, in order)">`
block with:

```tsx
            <Field label="Stops">
              {rawMode ? (
                <>
                  <textarea
                    value={edits.rawText}
                    onChange={(e) => update("rawText", e.target.value)}
                    disabled={saving}
                    rows={Math.max(4, Math.min(12, edits.rawText.split("\n").length + 1))}
                    className="input mono"
                    style={{ minHeight: 96, padding: 8, lineHeight: 1.45 }}
                  />
                  <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    One stop per line: <span className="mono">NG22 8TX 08:00-12:00</span>.
                    {canRoundTrip(edits.rawText) && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => {
                            setStopRows(parseStopLines(edits.rawText));
                            setRawMode(false);
                          }}
                          disabled={saving}
                        >
                          Switch to stop rows
                        </button>
                      </>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <StopsEditor
                    stops={stopRows}
                    disabled={saving}
                    onChange={updateStops}
                  />
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setRawMode(true)}
                    disabled={saving}
                    style={{ justifySelf: "start", marginTop: 4 }}
                  >
                    Edit as raw text
                  </button>
                </>
              )}
            </Field>
```

- [ ] **Step 3: Verify by hand**

```bash
npm run dev
```

Open a load at `/portal/loads/<id>`, click **Edit run**, and check:
1. Existing stops appear as rows with their times in **From**.
2. Setting a **To** on a stop, saving, and reopening shows the window intact.
3. Reordering with the arrows and saving reorders the stops on the page.
4. A load whose `raw_text` has a non-postcode line opens in raw-text mode.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/LoadEditModal.tsx
git commit -m "feat(stops): edit stops as structured rows with delivery windows"
```

---

### Task 11: Stage override control on the load detail page

**Files:**
- Create: `src/components/portal/StageOverrideControl.tsx`
- Modify: `src/app/portal/loads/[id]/page.tsx`

- [ ] **Step 1: Create the control**

```tsx
"use client";

/**
 * Admin control for pinning a load's stage, plus the public note explaining
 * that it was pinned.
 *
 * The note renders for everyone, not just admins: a customer seeing
 * "Delivered" while the map shows a moving lorry otherwise has no
 * explanation, and neither will the operator reading the row in three weeks.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALL_STATUSES, STATUS_LABEL, type LoadStatus } from "@/lib/portal/status";

export default function StageOverrideControl({
  override,
  overrideBy,
  overrideAt,
  derived,
  isAdmin,
  saving,
  onChange,
}: {
  override: LoadStatus | null;
  overrideBy?: string;
  overrideAt?: string;
  /** What the status WOULD be with no override — shown in the Auto option. */
  derived: LoadStatus;
  isAdmin: boolean;
  saving: boolean;
  onChange: (next: LoadStatus | null) => void;
}) {
  const [byName, setByName] = useState<string | null>(null);

  // Resolve the setter's name. RLS may hide the row from a customer, and the
  // user may have been deleted — either way we degrade to no name rather
  // than rendering a raw uuid.
  useEffect(() => {
    if (!overrideBy) {
      setByName(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", overrideBy)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setByName(data?.full_name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [overrideBy]);

  const stamp = overrideAt
    ? new Date(overrideAt).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  if (!isAdmin && !override) return null;

  return (
    <div style={{ display: "grid", gap: 3 }}>
      {isAdmin && (
        <select
          value={override ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? (e.target.value as LoadStatus) : null)
          }
          disabled={saving}
          aria-label="Stage"
          className="input"
          style={{ height: 26, fontSize: 11.5, width: "auto" }}
        >
          <option value="">Auto ({STATUS_LABEL[derived]})</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      )}
      {override && (
        <span className="muted" style={{ fontSize: 11 }}>
          Stage set manually
          {byName ? ` by ${byName}` : ""}
          {stamp ? ` at ${stamp}` : ""}
          {isAdmin && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={saving}
                className="btn sm ghost"
                style={{ padding: "0 4px", height: "auto" }}
              >
                Revert to auto
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it on the detail page**

In `src/app/portal/loads/[id]/page.tsx`, add the imports:

```ts
import StageOverrideControl from "@/components/portal/StageOverrideControl";
import { setLoadStatusOverride } from "@/app/actions/loads";
import type { LoadStatus } from "@/lib/portal/status";
```

Beside the existing `const status = deriveStatus(run, today);` line (~line 327),
add the derived-without-override value and the save handler:

```tsx
  const status = deriveStatus(run, today);
  // What the status would be with no override — shown in the Auto option so
  // an admin can see what they're overriding before they commit.
  const derivedStatus = deriveStatus({ ...run, statusOverride: null }, today);
  const [savingStage, setSavingStage] = useState(false);

  async function handleStageChange(next: LoadStatus | null) {
    setSavingStage(true);
    const res = await setLoadStatusOverride(run.id, next);
    setSavingStage(false);
    if (res.error) {
      showToast(`Couldn't set stage: ${res.error}`, "err");
      return;
    }
    onRunChange({
      ...run,
      statusOverride: next,
      statusOverrideAt: next ? new Date().toISOString() : undefined,
      statusOverrideBy: next ? profile?.id : undefined,
    });
    showToast(next ? `Stage pinned to ${next}` : "Stage back on auto");
  }
```

Then in the header (~line 436), replace the bare `<StatusPill status={status} />`
with:

```tsx
            <div style={{ display: "grid", gap: 3 }}>
              <StatusPill status={status} />
              <StageOverrideControl
                override={run.statusOverride ?? null}
                overrideBy={run.statusOverrideBy}
                overrideAt={run.statusOverrideAt}
                derived={derivedStatus}
                isAdmin={isAdmin}
                saving={savingStage}
                onChange={handleStageChange}
              />
            </div>
```

- [ ] **Step 3: Verify by hand**

```bash
npm run dev
```

At `/portal/loads/<id>` as an admin:
1. The dropdown reads `Auto (…)` matching the pill.
2. Picking **Exception** turns the pill to Exception and shows the note with
   your name and the time.
3. **Revert to auto** restores the derived status.
4. Reload the page — the override survives.
5. The load's row on `/portal/loads` shows the overridden status too.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/StageOverrideControl.tsx "src/app/portal/loads/[id]/page.tsx"
git commit -m "feat(status): admin stage override control on the load detail page"
```

---

### Task 12: Show delivery windows on the load detail page and tracker

**Files:**
- Modify: `src/app/portal/loads/[id]/page.tsx`
- Modify: `src/app/track/[token]/page.tsx`

Both pages already render a per-stop list; this adds the booked window to each
row so the customer can see the slot they were promised.

- [ ] **Step 1: Add the helper import to both pages**

In each file, add `parseStopsWithTimes` to the existing `@/lib/postcode-utils`
import.

- [ ] **Step 2: Render the window on the tracker's stop rows**

In `src/app/track/[token]/page.tsx`, just before the `return` of the page
component, add:

```tsx
  const stopTimes = parseStopsWithTimes(run.rawText);
```

Inside the `stops.map((pc, i) => {` callback, after `const site = legSiteTimes(run, i);`,
add:

```tsx
                const booked = stopTimes[i];
                const bookedLabel = booked?.time
                  ? booked.windowEnd
                    ? `${booked.time}–${booked.windowEnd}`
                    : booked.time
                  : null;
```

Then inside the `<div style={{ flex: 1, minWidth: 0 }}>`, immediately after the
postcode line, add:

```tsx
                      {bookedLabel && (
                        <div className="mono" style={{ fontSize: 11, marginTop: 2 }}>
                          <span className="muted">Booked</span>{" "}
                          <span className="bold">{bookedLabel}</span>
                        </div>
                      )}
```

- [ ] **Step 3: Do the same on the authenticated detail page**

In `src/app/portal/loads/[id]/page.tsx`, add near the other `useMemo`s:

```tsx
  const stopTimes = useMemo(
    () => parseStopsWithTimes(run.rawText),
    [run.rawText],
  );
```

In the leg list around line 609 (where `legSiteTimes(run, leg.stopIndex ?? null)`
is computed), add alongside it:

```tsx
                  const booked =
                    leg.stopIndex != null ? stopTimes[leg.stopIndex] : undefined;
                  const bookedLabel = booked?.time
                    ? booked.windowEnd
                      ? `${booked.time}–${booked.windowEnd}`
                      : booked.time
                    : null;
```

and render `bookedLabel` beside the existing arrived/departed times in that
row, matching their `className="mono"` / `<span className="muted">` treatment:

```tsx
                  {bookedLabel && (
                    <span className="mono">
                      <span className="muted">Booked</span>{" "}
                      <span className="bold">{bookedLabel}</span>
                    </span>
                  )}
```

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

1. Give a stop a window via **Edit run**.
2. The detail page stop row shows `Booked 08:00–12:00`.
3. Open the share link for that load — the same window shows there.
4. A stop with a single time still shows `Booked 12:30` with no dash.

- [ ] **Step 5: Commit**

```bash
git add "src/app/portal/loads/[id]/page.tsx" "src/app/track/[token]/page.tsx"
git commit -m "feat(stops): show booked delivery windows on the load page and tracker"
```

---

### Task 13: Collection arrive/depart times on the public tracker

**Files:**
- Modify: `src/app/track/[token]/page.tsx`

The tracker shows arrived/departed for every drop, but the collection point
only gets an inline pill — and that pill never shows when the lorry *arrived*
to load, only "since" while loading or the departure time after. The
authenticated page already renders collection as a proper leg with both times
(`src/app/portal/loads/[id]/page.tsx:604`); this ports that treatment across.

- [ ] **Step 1: Add a collection row above the drops**

In `src/app/track/[token]/page.tsx`, inside the Stops card, immediately before
`{stops.map((pc, i) => {`, insert a collection row. `collectionTimes(run)` is
already computed above as part of the pill block — hoist it so both use one
value: move `const c = collectionTimes(run);` out of the inline IIFE to sit
beside `const stopTimes = …`, rename it `const collection = collectionTimes(run);`,
and update the pill block to use `collection` instead of its local `c`.

Then add the row:

```tsx
              {(collection.arrivedAt || collection.departedAt || collection.loading) && (
                <li
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 10px",
                    border: collection.loading
                      ? "1px solid var(--mlc-blue)"
                      : "1px solid var(--line)",
                    borderRadius: 6,
                    background: collection.loading
                      ? "var(--mlc-blue-50, #eef4ff)"
                      : collection.departed
                        ? "var(--ok-bg, #e8f5e9)"
                        : "var(--surface-alt, #fafafa)",
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: collection.loading
                        ? "var(--mlc-blue)"
                        : collection.departed
                          ? "var(--ok)"
                          : "var(--ink-500)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    C
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bold mono" style={{ fontSize: 12.5 }}>
                      {run.fromPostcode}
                    </div>
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      Collection point
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        marginTop: 4,
                        fontSize: 11,
                      }}
                    >
                      {collection.arrivedAt && (
                        <span className="mono">
                          <span className="muted">Arrived</span>{" "}
                          <span className="bold">{collection.arrivedAt}</span>
                        </span>
                      )}
                      {collection.departedAt && (
                        <span className="mono">
                          <span className="muted">Departed</span>{" "}
                          <span className="bold">{collection.departedAt}</span>
                        </span>
                      )}
                      {collection.loading && collection.loadingSince && (
                        <span className="mono" style={{ color: "var(--mlc-blue)" }}>
                          <span className="muted">Loading since</span>{" "}
                          <span className="bold">{collection.loadingSince}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  {collection.loading ? (
                    <span
                      style={{
                        background: "var(--mlc-blue)",
                        color: "#fff",
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontSize: 10.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Loading
                    </span>
                  ) : collection.departed ? (
                    <span
                      style={{
                        background: "var(--ok)",
                        color: "#fff",
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontSize: 10.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Collected
                    </span>
                  ) : null}
                </li>
              )}
```

- [ ] **Step 2: Let the Stops card render when only collection has happened**

The card is currently gated on `{stops.length > 0 && (`. Change that condition to:

```tsx
      {(stops.length > 0 || collection.arrivedAt || collection.loading) && (
```

so a backload that has been collected but has no parsed drops still shows the
collection times.

- [ ] **Step 3: Verify by hand**

```bash
npm run dev
```

1. Open the share link for a load whose lorry has been to the collection point.
2. The Stops card leads with a **C** row showing `Arrived HH:MM` and, once it
   has left, `Departed HH:MM` and a green **Collected** badge.
3. While on site it shows `Loading since HH:MM` with the blue **Loading** badge.
4. A load that hasn't reached collection yet shows no C row.

- [ ] **Step 4: Commit**

```bash
git add "src/app/track/[token]/page.tsx"
git commit -m "feat(track): show collection arrive/depart times on the share link"
```

---

### Task 14: Full verification

- [ ] **Step 1: Test suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 2: Types and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Confirm the migration is live**

```sql
select table_name, column_name from information_schema.columns
where table_name in ('runs','loads') and column_name like 'status_override%'
order by table_name, column_name;
```

Expected: 6 rows.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint and type issues from delivery windows work"
```
