/**
 * Daily cron: materialise standing weekday runs (Consolid8 fixtures).
 *
 * Runs once a day a few hours ahead of the operator's morning shift so
 * "tomorrow's" planner is already populated by the time anyone opens it.
 * Also pre-creates today's rows (cheap insurance — they should already
 * exist from yesterday's run, but if a deploy or outage missed a day we
 * heal it here).
 *
 * Idempotent: each spec → date pair has a deterministic id
 * (`fixed-{slug}-{date}`) so re-running the cron never duplicates rows,
 * and an upsert with ignoreDuplicates is used as belt-and-braces.
 *
 * Auth: Bearer CRON_SECRET (matches the existing /api/cron/* routes).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  FIXED_WEEKDAY_RUNS,
  fixedRunId,
  isWeekday,
} from "@/lib/planner/fixed-runs";

function isoDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();

  // Materialise today, tomorrow, and the day after so any one-off cron
  // miss self-heals on the next run. Skips weekend dates inside isWeekday().
  const now = new Date();
  const targets = [0, 1, 2]
    .map((offset) => isoDate(shiftDays(now, offset)))
    .filter(isWeekday);

  const summary: Record<string, number> = {};
  for (const date of targets) {
    const candidateIds = FIXED_WEEKDAY_RUNS.map((spec) =>
      fixedRunId(spec.slug, date),
    );
    const { data: existing } = await sb
      .from("runs")
      .select("id")
      .in("id", candidateIds);
    const existingIds = new Set((existing ?? []).map((r) => r.id as string));

    const toInsert = FIXED_WEEKDAY_RUNS.filter(
      (spec) => !existingIds.has(fixedRunId(spec.slug, date)),
    ).map((spec) => ({
      id: fixedRunId(spec.slug, date),
      job_number: "",
      load_ref: spec.loadRef,
      date,
      customer: spec.customer,
      vehicle: "",
      from_postcode: spec.fromPostcode,
      // Delivery cell shows the friendly label; raw postcode lives in
      // raw_text. See materializeFixedRuns for the rationale.
      to_postcode: spec.destinationLabel,
      return_to_base: spec.returnToBase,
      start_time: spec.startTime,
      service_mins: spec.serviceMins,
      include_breaks: spec.includeBreaks,
      raw_text: spec.destinationPostcode,
      completed_stop_indexes: [],
      completed_meta: {},
      progress: {
        completedIdx: [],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
      },
      // service-role insert: created_by left null is fine, we don't have a
      // user context here.
      created_by: null,
      run_type: spec.runType,
      run_order: null,
      collection_time: null,
      collection_date: null,
      factory: null,
      booking_time: null,
      subby_driver: null,
      subby_cost: null,
      trailer_number: null,
      trailer_dropped: false,
      reference: null,
      revenue: spec.revenue,
      billable: false,
      invoice_status: "open",
      xero_invoice_id: null,
      xero_exported_at: null,
      day_index: null,
      day_count: null,
    }));

    if (toInsert.length === 0) {
      summary[date] = 0;
      continue;
    }

    const { error } = await sb
      .from("runs")
      .upsert(toInsert, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      return NextResponse.json(
        { ok: false, date, error: error.message },
        { status: 500 },
      );
    }
    summary[date] = toInsert.length;
  }

  return NextResponse.json({ ok: true, summary });
}
