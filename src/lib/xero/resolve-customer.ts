/**
 * Customer-name resolver for the Xero CSV export.
 *
 * Ported from the Master Planner spreadsheet's `XeroExport_FinalLogic.bas`
 * (see `BuildCustomerMap`, `ResolveMapKey`, `ScrubCompanyKey`,
 * `NormaliseKey`, `GetXeroContactName`).
 *
 * Why so much logic? Planner-side names drift over time — they get typed
 * by hand on every daily sheet — while Xero needs an exact ContactName
 * match. The resolver fuzzy-matches in a deterministic, four-tier order:
 *
 *   1. Exact match on the normalised key.
 *   2. Match on a "scrubbed" key (Ltd / Limited / UK / Group / Holdings /
 *      Company / Co / The all stripped, plus parens / slashes / etc).
 *   3. Longest-substring match in either direction.
 *   4. Fall back to the entry whose `plannerName === 'default'`.
 *
 * Pure, side-effect-free, fully tested in `resolve-customer.test.ts`.
 */

import type { CustomerXeroMap } from "@/types/invoicing";

const FILLER_WORDS: ReadonlyArray<string> = [
  " ltd ",
  " limited ",
  " uk ",
  " group ",
  " holdings ",
  " company ",
  " co ",
  " the ",
];

/**
 * Lowercase, NBSP-strip, collapse whitespace, replace underscores/hyphens
 * with spaces. Used as the canonical lookup key.
 */
export function normaliseKey(input: string): string {
  let s = (input ?? "").replace(/ /g, " ").trim();
  while (s.includes("  ")) s = s.replace(/  /g, " ");
  s = s.toLowerCase().replace(/_/g, " ").replace(/-/g, " ");
  while (s.includes("  ")) s = s.replace(/  /g, " ");
  return s;
}

/**
 * "Scrubbed" lookup key. Strips company-name filler words and noisy
 * punctuation so "Montpellier (UK) Ltd" and "Montpellier" both resolve to
 * `montpellier`.
 */
export function scrubCompanyKey(input: string): string {
  // Pad with spaces so word-boundary matches work even at start/end.
  let k = " " + normaliseKey(input) + " ";
  k = k.replace(/[()/&,.']/g, " ");
  for (const w of FILLER_WORDS) k = k.replaceAll(w, " ");
  while (k.includes("  ")) k = k.replace(/  /g, " ");
  return k.trim();
}

export interface ResolvedCustomer {
  /** The matched map entry. Always non-null because `default` is the floor. */
  entry: CustomerXeroMap;
  /** The contact name to write into the CSV. */
  xeroContactName: string;
  /** Which tier won, useful for debug / UI tooltips. */
  matchTier: "exact" | "scrubbed" | "substring" | "default";
}

/**
 * Resolve a planner-side customer name against the customer_xero_map list.
 *
 * `mapEntries` MUST include at least one entry whose `plannerName === 'default'`
 * — the migration seeds one. If it's missing the function throws so the
 * caller fails loudly rather than producing a malformed CSV.
 */
export function resolveCustomer(
  plannerName: string,
  mapEntries: ReadonlyArray<CustomerXeroMap>
): ResolvedCustomer {
  const byKey = new Map<string, CustomerXeroMap>();
  for (const e of mapEntries) byKey.set(normaliseKey(e.plannerName), e);

  const fallback = byKey.get("default");
  if (!fallback) {
    throw new Error(
      "customer_xero_map is missing the 'default' row — cannot resolve customers"
    );
  }

  // Tier 1 — exact match.
  const exactKey = normaliseKey(plannerName);
  const exact = byKey.get(exactKey);
  if (exact && exactKey !== "default") {
    return makeResolved(exact, plannerName, "exact");
  }

  // Tier 2 — scrubbed match.
  const scrubbedKey = scrubCompanyKey(plannerName);
  const scrubbed = byKey.get(scrubbedKey);
  if (scrubbed && scrubbedKey !== "default") {
    return makeResolved(scrubbed, plannerName, "scrubbed");
  }

  // Tier 3 — substring match either direction. Longest-key wins.
  let bestKey = "";
  let bestEntry: CustomerXeroMap | null = null;
  for (const [k, e] of byKey) {
    if (k === "default" || !k) continue;
    const hit =
      (scrubbedKey.length > 0 && (k.includes(scrubbedKey) || scrubbedKey.includes(k))) ||
      false;
    if (hit && k.length > bestKey.length) {
      bestKey = k;
      bestEntry = e;
    }
  }
  if (bestEntry) {
    return makeResolved(bestEntry, plannerName, "substring");
  }

  // Tier 4 — default.
  return makeResolved(fallback, plannerName, "default");
}

function makeResolved(
  entry: CustomerXeroMap,
  plannerName: string,
  tier: ResolvedCustomer["matchTier"]
): ResolvedCustomer {
  // If the matched entry has a Xero ContactName override, use it. Otherwise
  // fall back to the original planner-side name (NOT the matched entry's
  // plannerName, which might be a normalised stub).
  const xeroContactName =
    entry.xeroContactName && entry.xeroContactName.length > 0
      ? entry.xeroContactName
      : plannerName;
  return { entry, xeroContactName, matchTier: tier };
}
