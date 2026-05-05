/**
 * Locks in the Consolid8 same-day-backload rule. Adjusting which depots
 * count as same-day, or which customer aliases match, should require a
 * deliberate test update — this is exactly the kind of dispatcher-rule
 * regression that's painful to catch in production.
 */

import { describe, it, expect } from "vitest";
import {
  isConsolid8,
  isMiddletonOrPurity,
  pinConsolid8SameDayBackloads,
  type ParsedRun,
} from "./consolid8-rules";

// Same alias map the email-to-run handler uses, restricted to the depots
// the rule cares about. Keeps these tests independent of the route file.
const DEPOTS: Record<string, string> = {
  "middleton foods": "WV13 3LH",
  "middleton foods willenhall": "WV13 3LH",
  willenhall: "WV13 3LH",
  "purity soft drinks": "WS10 0BU",
  "purity soft drinks wednesbury": "WS10 0BU",
  wednesbury: "WS10 0BU",
};

function fakeResolve(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  // If it already looks like a UK postcode, just upper-case + space
  if (/^[A-Z]{1,2}\d/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, " ").toUpperCase().trim();
  }
  const lower = trimmed.toLowerCase();
  for (const [alias, pc] of Object.entries(DEPOTS)) {
    if (lower.includes(alias) || alias.includes(lower)) return pc;
  }
  return trimmed;
}

describe("isConsolid8", () => {
  it.each([
    ["Consolid8", true],
    ["CONSOLID8", true],
    ["consolid8", true],
    ["CON001", true],
    ["con001", true],
    ["Consolid8 Ltd", true],
    ["Ashwood", false],
    ["", false],
    [undefined, false],
  ])("isConsolid8(%j) === %j", (input, expected) => {
    expect(isConsolid8(input)).toBe(expected);
  });
});

describe("isMiddletonOrPurity", () => {
  it("matches by location name", () => {
    expect(isMiddletonOrPurity({ fromLocation: "Middleton Foods" }, fakeResolve)).toBe(true);
    expect(isMiddletonOrPurity({ fromLocation: "Purity Soft Drinks" }, fakeResolve)).toBe(true);
    expect(isMiddletonOrPurity({ fromLocation: "Willenhall depot" }, fakeResolve)).toBe(true);
    expect(isMiddletonOrPurity({ fromLocation: "Wednesbury yard" }, fakeResolve)).toBe(true);
  });

  it("matches by postcode (with or without space)", () => {
    expect(isMiddletonOrPurity({ fromPostcode: "WV13 3HJ" }, fakeResolve)).toBe(false); // not exact
    expect(isMiddletonOrPurity({ fromPostcode: "WV13 3LH" }, fakeResolve)).toBe(true);
    expect(isMiddletonOrPurity({ fromPostcode: "WS10 0BU" }, fakeResolve)).toBe(true);
  });

  it("does NOT match unrelated places", () => {
    expect(isMiddletonOrPurity({ fromLocation: "Tamworth" }, fakeResolve)).toBe(false);
    expect(isMiddletonOrPurity({ fromLocation: "Portbury" }, fakeResolve)).toBe(false);
    expect(isMiddletonOrPurity({ fromPostcode: "B78 3HJ" }, fakeResolve)).toBe(false);
  });

  it("matches when only a postcode-shaped string is supplied", () => {
    expect(isMiddletonOrPurity({ fromPostcode: "WV13 3LH" }, fakeResolve)).toBe(true);
  });

  it("returns false when both fields are empty", () => {
    expect(isMiddletonOrPurity({}, fakeResolve)).toBe(false);
  });
});

describe("pinConsolid8SameDayBackloads", () => {
  it("pins a Middleton backload to the Consolid8 outbound date", () => {
    const runs: ParsedRun[] = [
      { type: "regular", customer: "Consolid8", date: "2026-04-29" },
      {
        type: "backload",
        customer: "Consolid8",
        date: "2026-04-30", // wrong: claude pulled "next day" from the email
        fromLocation: "Middleton Foods",
      },
    ];
    const changed = pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(changed).toBe(1);
    expect(runs[1].date).toBe("2026-04-29");
  });

  it("pins a Purity backload identified by postcode only", () => {
    const runs: ParsedRun[] = [
      { type: "regular", customer: "CON001", date: "2026-04-29" },
      {
        type: "backload",
        customer: "CON001",
        date: "2026-05-01",
        fromPostcode: "WS10 0BU",
      },
    ];
    pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(runs[1].date).toBe("2026-04-29");
  });

  it("does NOT touch backloads from other depots", () => {
    const runs: ParsedRun[] = [
      { type: "regular", customer: "Consolid8", date: "2026-04-29" },
      {
        type: "backload",
        customer: "Consolid8",
        date: "2026-04-30",
        fromLocation: "Tamworth",
      },
    ];
    const changed = pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(changed).toBe(0);
    expect(runs[1].date).toBe("2026-04-30");
  });

  it("does NOT touch backloads for other customers from Middleton/Purity", () => {
    // Defensive: only Consolid8 has the same-day rule. If Ashwood ever
    // happens to use Middleton, that's a separate workflow.
    const runs: ParsedRun[] = [
      { type: "regular", customer: "Consolid8", date: "2026-04-29" },
      {
        type: "backload",
        customer: "Ashwood",
        date: "2026-04-30",
        fromLocation: "Middleton Foods",
      },
    ];
    const changed = pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(changed).toBe(0);
    expect(runs[1].date).toBe("2026-04-30");
  });

  it("no-op when there's no Consolid8 outbound to pin against", () => {
    const runs: ParsedRun[] = [
      {
        type: "backload",
        customer: "Consolid8",
        date: "2026-04-30",
        fromLocation: "Middleton Foods",
      },
    ];
    const changed = pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(changed).toBe(0);
    expect(runs[0].date).toBe("2026-04-30"); // untouched
  });

  it("leaves an already-correct backload alone (idempotent)", () => {
    const runs: ParsedRun[] = [
      { type: "regular", customer: "Consolid8", date: "2026-04-29" },
      {
        type: "backload",
        customer: "Consolid8",
        date: "2026-04-29",
        fromLocation: "Middleton Foods",
      },
    ];
    const changed = pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(changed).toBe(0);
    expect(runs[1].date).toBe("2026-04-29");
  });

  it("handles multiple backloads in one email", () => {
    const runs: ParsedRun[] = [
      { type: "regular", customer: "Consolid8", date: "2026-04-29" },
      { type: "regular", customer: "Consolid8", date: "2026-04-29" },
      {
        type: "backload",
        customer: "Consolid8",
        date: "2026-04-30",
        fromLocation: "Middleton Foods",
      },
      {
        type: "backload",
        customer: "Consolid8",
        date: "2026-05-02",
        fromLocation: "Purity Soft Drinks",
      },
    ];
    const changed = pinConsolid8SameDayBackloads(runs, fakeResolve);
    expect(changed).toBe(2);
    expect(runs[2].date).toBe("2026-04-29");
    expect(runs[3].date).toBe("2026-04-29");
  });
});
