/**
 * Group billable runs into invoices for the Xero CSV export.
 *
 * Ported from `XeroExport_FinalLogic.bas` (the inline grouping section
 * around line 246–280). The rule is:
 *
 *   1. If the customer name (normalised) is in `noGroupingCustomers`
 *      (defaults to ['ashwood']), every run becomes its own invoice.
 *   2. Else if the run has a non-empty Load Ref that isn't literally "0",
 *      group all runs that share the same `(customer, loadRef)`.
 *   3. Else group all runs that share the same `(customer, ISO-week)`.
 *
 * Pure, side-effect-free, fully tested in `group-runs.test.ts`.
 */

import type {
  InvoiceGroup,
  InvoiceableRun,
  XeroExportConfig,
} from "@/types/invoicing";
import { DEFAULT_XERO_CONFIG } from "@/types/invoicing";
import { isoWeekNum, isoYear } from "@/lib/iso-week";
import { normaliseKey } from "./resolve-customer";
import { parseISODate } from "./due-date";

interface GroupRunsOptions {
  config?: XeroExportConfig;
}

/**
 * Group billable runs into invoices.
 *
 * Order is deterministic:
 *  - Groups are returned sorted by (customer, key).
 *  - Each group's `lines` are sorted by (date, id) so the CSV is stable.
 */
export function groupRuns(
  runs: ReadonlyArray<InvoiceableRun>,
  opts: GroupRunsOptions = {}
): ReadonlyArray<InvoiceGroup> {
  const cfg = opts.config ?? DEFAULT_XERO_CONFIG;
  const noGroup = new Set(cfg.noGroupingCustomers.map((c) => normaliseKey(c)));

  // Map keyed by group-key.
  const buckets = new Map<string, InvoiceableRun[]>();
  const customers = new Map<string, string>(); // key → planner customer name (first wins)

  for (const r of runs) {
    const key = groupKeyFor(r, noGroup);
    const list = buckets.get(key);
    if (list) {
      list.push(r);
    } else {
      buckets.set(key, [r]);
      customers.set(key, r.customer);
    }
  }

  const out: InvoiceGroup[] = [];
  for (const [key, lines] of buckets) {
    const sorted = [...lines].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    // Invoice date is the latest line date in the group — matches VBA.
    const lastDate = sorted[sorted.length - 1].date;
    const lastDateObj = parseISODate(lastDate);
    out.push({
      key,
      customer: customers.get(key) ?? sorted[0].customer,
      invoiceDate: lastDate,
      isoWeek: isoWeekNum(lastDateObj),
      isoYear: isoYear(lastDateObj),
      lines: sorted,
    });
  }

  // Stable, alphabetical-ish ordering.
  out.sort((a, b) => {
    const c = a.customer.localeCompare(b.customer);
    return c !== 0 ? c : a.key.localeCompare(b.key);
  });
  return out;
}

/**
 * Compute the grouping key for a single run.
 *  - 'ASH|<id>'         — never combine
 *  - 'REF|<cust>|<ref>' — combine by reference
 *  - 'WK|<cust>|YYYY-Www' — combine weekly
 */
export function groupKeyFor(
  run: InvoiceableRun,
  noGroupNorm: ReadonlySet<string>
): string {
  const cust = normaliseKey(run.customer);
  if (noGroupNorm.has(cust)) {
    return `ASH|${run.id}`;
  }
  const ref = (run.loadRef ?? "").trim();
  if (ref.length > 0 && ref !== "0") {
    return `REF|${cust}|${normaliseKey(ref)}`;
  }
  const d = parseISODate(run.date);
  const wk = isoWeekNum(d);
  const yr = isoYear(d);
  const wkPad = String(wk).padStart(2, "0");
  return `WK|${cust}|${yr}-W${wkPad}`;
}
