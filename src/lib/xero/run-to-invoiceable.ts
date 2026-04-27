/**
 * Pure adapter — projects a `PlannedRun` (the rich shape stored on `runs`)
 * into an `InvoiceableRun` (the slim shape consumed by `groupRuns` and
 * `buildXeroCsv`).
 *
 * Lives outside `app/actions/invoicing.ts` because that file is marked
 * `"use server"` and Next requires every export of a server-actions file to
 * be async.
 */

import type { PlannedRun } from "@/types/runs";
import type { InvoiceableRun } from "@/types/invoicing";

export function runToInvoiceable(run: PlannedRun): InvoiceableRun {
  // Description default mirrors the legacy spreadsheet's column-S formula:
  // "<from> -> <to>" with the registration appended in parens. Falls back to
  // raw_text first line when the to/from postcodes are missing.
  const arrow =
    run.fromPostcode && run.toPostcode
      ? `${run.fromPostcode} -> ${run.toPostcode}`
      : run.rawText.split(/\r?\n/)[0] || run.customer;
  const reg = run.vehicle ? ` (Reg: ${run.vehicle})` : "";
  return {
    id: run.id,
    date: run.date,
    customer: run.customer,
    loadRef: run.loadRef ?? "",
    description: `${arrow}${reg}`,
    amount: run.revenue ?? 0,
  };
}
