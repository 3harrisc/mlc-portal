/**
 * Consolid8-specific post-parse rules for the email-to-run pipeline.
 *
 * The Anthropic prompt in `/api/email-to-run` already tells Claude that
 * Middleton Foods / Purity Soft Drinks backloads are same-day collections
 * for Consolid8. These helpers double-up that rule on the server side so
 * the schedule is correct even if a particular email confuses the model
 * (e.g. mentions "next day", reorders sections, etc.).
 *
 * Pure functions — no I/O — so they're trivial to unit test.
 */

export interface ParsedRun {
  type?: string;
  customer?: string;
  date?: string;
  fromLocation?: string;
  fromPostcode?: string;
  // Other fields exist on the real parser shape but aren't relevant here.
  [key: string]: unknown;
}

/** True for any Consolid8 alias the parser might emit. */
export function isConsolid8(customer: string | undefined): boolean {
  return /\b(consolid8|con001)\b/i.test(customer ?? "");
}

/**
 * True when the parsed run looks like a Middleton Foods or Purity Soft
 * Drinks pickup — by location name OR resolved postcode. The depot alias
 * resolver is injected so this stays a pure function (no top-level imports
 * pulling in the route handler).
 */
export function isMiddletonOrPurity(
  run: ParsedRun,
  resolveLocation: (s: string) => string,
): boolean {
  const blob = `${run.fromLocation ?? ""} ${run.fromPostcode ?? ""}`.toLowerCase();
  if (/middleton|willenhall|purity|wednesbury/i.test(blob)) return true;
  // Catch the case where Claude returned just the postcode without the
  // human name — the alias resolver normalises both forms to the same key.
  const fromValue = (run.fromPostcode || run.fromLocation || "") as string;
  if (!fromValue) return false;
  const resolved = resolveLocation(fromValue);
  return resolved === "WV13 3LH" || resolved === "WS10 0BU";
}

/**
 * Mutates `parsedRuns` in place: any Consolid8 backload from Middleton or
 * Purity is pinned to the date of the first Consolid8 outbound run in the
 * same batch. If no outbound is present, nothing happens (we don't have a
 * truth source to pin against).
 *
 * Returns the count of dates that were changed — handy for telemetry.
 */
export function pinConsolid8SameDayBackloads(
  parsedRuns: ParsedRun[],
  resolveLocation: (s: string) => string,
): number {
  const outbound = parsedRuns.find(
    (r) => r.type !== "backload" && isConsolid8(r.customer) && !!r.date,
  );
  if (!outbound) return 0;

  let changed = 0;
  for (const r of parsedRuns) {
    if (r.type !== "backload") continue;
    if (!isConsolid8(r.customer)) continue;
    if (!isMiddletonOrPurity(r, resolveLocation)) continue;
    if (r.date !== outbound.date) {
      r.date = outbound.date;
      changed += 1;
    }
  }
  return changed;
}
