"use server";

import { createClient } from "@/lib/supabase/server";
import { rowToRun, runToRow } from "@/types/runs";
import type { PlannedRun } from "@/types/runs";
import { isoWeekMonday } from "@/lib/iso-week";
import {
  FIXED_WEEKDAY_RUNS,
  fixedRunId,
  isWeekday,
} from "@/lib/planner/fixed-runs";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

/** End of an ISO week (Sunday) as yyyy-MM-dd. */
function isoWeekSunday(year: number, week: number): string {
  const monday = isoWeekMonday(year, week);
  const [y, m, d] = monday.split("-").map(Number);
  const sun = new Date(Date.UTC(y, m - 1, d + 6));
  const yyyy = sun.getUTCFullYear();
  const mm = String(sun.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(sun.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** All runs for a single date, ordered by vehicle then start time. */
export async function listRunsForDate(
  date: string
): Promise<{ runs?: PlannedRun[]; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .eq("date", date)
    .order("vehicle", { ascending: true, nullsFirst: false })
    .order("run_order", { ascending: true, nullsFirst: false })
    .order("start_time", { ascending: true });
  if (error) return { error: error.message };
  return { runs: (data ?? []).map(rowToRun) };
}

/** All runs for an ISO week (Mon..Sun inclusive). */
export async function listRunsForIsoWeek(
  year: number,
  week: number
): Promise<{ runs?: PlannedRun[]; startDate?: string; endDate?: string; error?: string }> {
  const { supabase } = await getUser();
  const startDate = isoWeekMonday(year, week);
  const endDate = isoWeekSunday(year, week);
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("vehicle", { ascending: true });
  if (error) return { error: error.message };
  return { runs: (data ?? []).map(rowToRun), startDate, endDate };
}

/** Distinct list of vehicle codes seen on any run (used for column headers). */
export async function listKnownVehicles(): Promise<{ vehicles?: string[]; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("runs")
    .select("vehicle")
    .neq("vehicle", "")
    .order("vehicle", { ascending: true });
  if (error) return { error: error.message };
  const set = new Set<string>();
  for (const row of data ?? []) {
    const v = (row as { vehicle?: string | null }).vehicle?.trim();
    if (v) set.add(v);
  }
  return { vehicles: Array.from(set).sort() };
}

/**
 * Patch a single run with planner-sheet fields. All fields optional;
 * undefined = no change. Used for inline-cell edits.
 */
export async function updatePlannerCell(
  id: string,
  fields: Partial<{
    factory: string | null;
    bookingTime: string | null;
    subbyDriver: string | null;
    subbyCost: number | null;
    trailerNumber: string | null;
    trailerDropped: boolean;
    reference: string | null;
    revenue: number;
    customer: string;
    vehicle: string;
    fromPostcode: string;
    toPostcode: string;
    loadRef: string;
    billable: boolean;
    invoiceStatus: "open" | "billable" | "sent" | "paid" | "cancelled";
    dayIndex: number | null;
    dayCount: number | null;
  }>
) {
  const { supabase } = await getUser();
  const update: Record<string, unknown> = {};
  if (fields.factory !== undefined) update.factory = fields.factory;
  if (fields.bookingTime !== undefined) update.booking_time = fields.bookingTime;
  if (fields.subbyDriver !== undefined) update.subby_driver = fields.subbyDriver;
  if (fields.subbyCost !== undefined) update.subby_cost = fields.subbyCost;
  if (fields.trailerNumber !== undefined) update.trailer_number = fields.trailerNumber;
  if (fields.trailerDropped !== undefined) update.trailer_dropped = fields.trailerDropped;
  if (fields.reference !== undefined) update.reference = fields.reference;
  if (fields.revenue !== undefined) update.revenue = fields.revenue;
  if (fields.customer !== undefined) update.customer = fields.customer;
  if (fields.vehicle !== undefined) update.vehicle = fields.vehicle;
  if (fields.fromPostcode !== undefined) update.from_postcode = fields.fromPostcode;
  if (fields.toPostcode !== undefined) update.to_postcode = fields.toPostcode;
  if (fields.loadRef !== undefined) update.load_ref = fields.loadRef;
  if (fields.billable !== undefined) update.billable = fields.billable;
  if (fields.invoiceStatus !== undefined) update.invoice_status = fields.invoiceStatus;
  if (fields.dayIndex !== undefined) update.day_index = fields.dayIndex;
  if (fields.dayCount !== undefined) update.day_count = fields.dayCount;

  const { error } = await supabase.from("runs").update(update).eq("id", id);
  if (error) return { error: error.message };

  // Multi-day auto-carry: when the user sets "1 OF N" on a leg, create
  // sibling legs for days 2..N on subsequent dates. Sibling IDs follow the
  // pattern `${parentId}-day{N}` so they're stable across edits and easy to
  // delete if the user later shrinks the day count.
  if (fields.dayIndex !== undefined || fields.dayCount !== undefined) {
    const sync = await syncMultiDaySiblings(id);
    if (sync.error) return { error: `Cell saved but multi-day sync failed: ${sync.error}` };
  }

  return { success: true };
}

/**
 * Keep multi-day sibling legs in sync with their parent.
 *
 *  - If the parent has dayIndex=1 and dayCount>=2: upsert siblings on the
 *    subsequent dates, copying the parent's planning fields. Siblings start
 *    with revenue=0, billable=false, invoice_status='open'.
 *  - If the parent has dayIndex=1 and dayCount<=1 (or null): delete any
 *    existing siblings.
 *  - If parent isn't day 1 (it's itself a sibling, or single-day): do nothing.
 *
 * Each sibling has a deterministic ID `${parentId}-day{N}` so re-running this
 * function is idempotent — it never duplicates and only creates / deletes as
 * needed.
 */
async function syncMultiDaySiblings(parentId: string): Promise<{ error?: string }> {
  const { supabase, user } = await getUser();

  const { data: parent, error: parentErr } = await supabase
    .from("runs")
    .select("*")
    .eq("id", parentId)
    .maybeSingle();
  if (parentErr) return { error: parentErr.message };
  if (!parent) return {};

  const parentTyped = parent as Record<string, unknown>;
  const dayIndex = parentTyped.day_index as number | null;
  const dayCount = parentTyped.day_count as number | null;

  // Only auto-carry when the EDITED leg is itself day 1 of the trip.
  // Sibling legs (day_index > 1) shouldn't trigger any cascade.
  if (dayIndex !== 1) return {};

  const baseDate = parentTyped.date as string;
  const desired = dayCount && dayCount >= 2 ? dayCount : 1;

  // Helper: compute target sibling date.
  const dateOf = (offsetDays: number): string => {
    const [y, m, d] = baseDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // 1. Upsert needed siblings (day 2..N).
  const desiredSiblings: Array<Record<string, unknown>> = [];
  for (let n = 2; n <= desired; n++) {
    const siblingId = `${parentId}-day${n}`;
    desiredSiblings.push({
      id: siblingId,
      job_number: "",
      load_ref: parentTyped.load_ref ?? "",
      date: dateOf(n - 1),
      customer: parentTyped.customer,
      vehicle: parentTyped.vehicle ?? "",
      from_postcode: parentTyped.from_postcode,
      to_postcode: parentTyped.to_postcode ?? "",
      return_to_base: parentTyped.return_to_base ?? true,
      start_time: parentTyped.start_time ?? "08:00",
      service_mins: parentTyped.service_mins ?? 25,
      include_breaks: parentTyped.include_breaks ?? true,
      raw_text: parentTyped.raw_text ?? "",
      completed_stop_indexes: [],
      completed_meta: {},
      progress: { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false },
      created_by: user.id,
      run_type: parentTyped.run_type ?? "regular",
      run_order: null,
      collection_time: null,
      collection_date: null,
      factory: parentTyped.factory ?? null,
      booking_time: parentTyped.booking_time ?? null,
      subby_driver: parentTyped.subby_driver ?? null,
      subby_cost: null,                                        // £ only on day 1
      trailer_number: parentTyped.trailer_number ?? null,
      trailer_dropped: false,
      reference: parentTyped.reference ?? null,
      day_index: n,
      day_count: desired,
      revenue: 0,
      billable: false,
      invoice_status: "open",
      xero_invoice_id: null,
      xero_exported_at: null,
    });
  }

  // We want INSERT-IF-MISSING semantics, not full overwrite — so a user who
  // edited the sibling separately doesn't lose their changes. Two-step:
  //   a) fetch existing sibling IDs for this parent
  //   b) only insert siblings whose IDs don't exist yet
  //   c) update day_count on existing siblings if it changed
  const siblingIds = desiredSiblings.map((s) => s.id as string);
  const { data: existing, error: existErr } = await supabase
    .from("runs")
    .select("id, day_count")
    .like("id", `${parentId}-day%`);
  if (existErr) return { error: existErr.message };
  const existingById = new Map(
    (existing ?? []).map((r: { id: string; day_count: number | null }) => [r.id, r])
  );

  const newSiblings = desiredSiblings.filter((s) => !existingById.has(s.id as string));
  if (newSiblings.length > 0) {
    const { error: insErr } = await supabase.from("runs").insert(newSiblings);
    if (insErr) return { error: insErr.message };
  }

  // Update day_count on existing siblings whose value disagrees with the
  // new total. We only touch day_count + day_index to avoid clobbering
  // user edits to other columns.
  for (const sibling of desiredSiblings) {
    const ex = existingById.get(sibling.id as string);
    if (!ex) continue; // freshly inserted above
    if (ex.day_count !== desired) {
      const { error: upErr } = await supabase
        .from("runs")
        .update({ day_count: desired })
        .eq("id", sibling.id as string);
      if (upErr) return { error: upErr.message };
    }
  }

  // 2. Delete orphan siblings (existing-but-no-longer-needed because user
  //    reduced the day count).
  const orphanIds: string[] = [];
  for (const [id] of existingById) {
    if (!siblingIds.includes(id)) orphanIds.push(id);
  }
  if (orphanIds.length > 0) {
    const { error: delErr } = await supabase.from("runs").delete().in("id", orphanIds);
    if (delErr) return { error: delErr.message };
  }

  return {};
}

/**
 * Insert a blank planner row for a given date. Returns the new run.
 * Used by the "Add row" button on the daily transport sheet.
 */
export async function insertBlankPlannerRun(date: string, customer = ""): Promise<{
  run?: PlannedRun;
  error?: string;
}> {
  const { supabase, user } = await getUser();
  const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const blank: PlannedRun = {
    id,
    jobNumber: "",
    loadRef: "",
    date,
    customer,
    vehicle: "",
    fromPostcode: "",
    toPostcode: "",
    returnToBase: true,
    startTime: "08:00",
    serviceMins: 25,
    includeBreaks: true,
    rawText: "",
    runType: "regular",
    runOrder: null,
  };
  const { data, error } = await supabase
    .from("runs")
    .insert(runToRow(blank, user.id))
    .select("*")
    .single();
  if (error) return { error: error.message };
  return { run: rowToRun(data) };
}

/**
 * Pre-populate the standing weekday runs (Consolid8 daily fixtures) on the
 * dispatch planner for a given date.
 *
 * Behaviour:
 *   - On Sat/Sun, returns immediately (no fixed runs at the weekend).
 *   - For each entry in FIXED_WEEKDAY_RUNS that has no corresponding row
 *     for the date, inserts one. The id is deterministic
 *     (`fixed-{slug}-{date}`) so this is idempotent — re-running it won't
 *     create duplicates, and a row the dispatcher has already edited stays
 *     intact (subsequent runs leave it alone).
 *   - Returns the count of newly-inserted rows.
 *
 * Called from two places:
 *   1. The /portal/planner/[date] page on load, so opening a fresh weekday
 *      always shows the fixtures even if the cron hasn't fired yet.
 *   2. A daily cron at /api/cron/materialize-fixed-runs that pre-creates
 *      tomorrow's fixtures so they're ready first thing.
 */
export async function materializeFixedRuns(
  date: string,
): Promise<{ inserted?: number; error?: string }> {
  if (!isWeekday(date)) return { inserted: 0 };
  const { supabase, user } = await getUser();

  // Look up which slugs already have a row for this date so we only insert
  // the missing ones. Cheap because of the indexed PK lookup with .in().
  const candidateIds = FIXED_WEEKDAY_RUNS.map((spec) =>
    fixedRunId(spec.slug, date),
  );
  const { data: existing, error: fetchErr } = await supabase
    .from("runs")
    .select("id")
    .in("id", candidateIds);
  if (fetchErr) return { error: fetchErr.message };
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));

  const toInsert = FIXED_WEEKDAY_RUNS.filter(
    (spec) => !existingIds.has(fixedRunId(spec.slug, date)),
  ).map((spec) => {
    const id = fixedRunId(spec.slug, date);
    return {
      id,
      job_number: "",
      load_ref: spec.loadRef,
      date,
      customer: spec.customer,
      vehicle: "",
      from_postcode: spec.fromPostcode,
      to_postcode: spec.toPostcode,
      return_to_base: spec.returnToBase,
      start_time: spec.startTime,
      service_mins: spec.serviceMins,
      include_breaks: spec.includeBreaks,
      raw_text: spec.toPostcode,
      completed_stop_indexes: [],
      completed_meta: {},
      progress: {
        completedIdx: [],
        onSiteIdx: null,
        onSiteSinceMs: null,
        lastInside: false,
      },
      created_by: user.id,
      run_type: spec.runType,
      run_order: null,
      collection_time: null,
      collection_date: null,
      factory: spec.factory,
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
    };
  });

  if (toInsert.length === 0) return { inserted: 0 };

  // Use ON CONFLICT-equivalent semantics via .upsert with ignoreDuplicates so
  // a concurrent insert (cron + page load racing on the same date) doesn't
  // bubble a duplicate-key error.
  const { error: insErr } = await supabase
    .from("runs")
    .upsert(toInsert, { onConflict: "id", ignoreDuplicates: true });
  if (insErr) return { error: insErr.message };

  return { inserted: toInsert.length };
}

/** Delete a row from the planner. */
export async function deletePlannerRun(id: string) {
  const { supabase } = await getUser();
  const { error } = await supabase.from("runs").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Copy every run from `sourceDate` into `targetDate`.
 *
 * The copy strategy mirrors how the spreadsheet workflow leaves last week's
 * jobs on the page so you can edit-not-rewrite them. We:
 *   - Insert NEW rows (so completion / progress / billing state from the
 *     source week stays untouched and isolated).
 *   - Reset all "instance" fields: revenue=0, billable=false,
 *     invoice_status='open', xero_invoice_id=null, xero_exported_at=null,
 *     completed_stop_indexes=[], progress=default, completed_meta={},
 *     job_number='', day_index=null, day_count=null.
 *   - Keep the planning content: customer, vehicle, from/to postcodes,
 *     factory, booking_time, subby_driver, subby_cost, trailer_number,
 *     reference, raw_text, etc.
 *
 * Returns the number of rows inserted.
 */
export async function copyDayForward(
  sourceDate: string,
  targetDate: string
): Promise<{ inserted?: number; error?: string }> {
  if (sourceDate === targetDate) return { error: "Source and target dates are identical" };
  const { supabase, user } = await getUser();

  // Refuse if target already has runs — caller should clear or pick a fresh date.
  const { count: existing, error: countErr } = await supabase
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("date", targetDate);
  if (countErr) return { error: countErr.message };
  if ((existing ?? 0) > 0) {
    return { error: `Target ${targetDate} already has ${existing} runs. Clear it or pick another date.` };
  }

  // Fetch source rows.
  const { data: source, error: srcErr } = await supabase
    .from("runs")
    .select("*")
    .eq("date", sourceDate);
  if (srcErr) return { error: srcErr.message };
  if (!source || source.length === 0) return { inserted: 0 };

  // Project each into a fresh insert payload.
  const payload = source.map((row) => {
    const newId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: newId,
      job_number: "",
      load_ref: row.load_ref ?? "",
      date: targetDate,
      customer: row.customer,
      vehicle: row.vehicle ?? "",
      from_postcode: row.from_postcode,
      to_postcode: row.to_postcode ?? "",
      return_to_base: row.return_to_base ?? true,
      start_time: row.start_time ?? "08:00",
      service_mins: row.service_mins ?? 25,
      include_breaks: row.include_breaks ?? true,
      raw_text: row.raw_text ?? "",
      completed_stop_indexes: [],
      completed_meta: {},
      progress: { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false },
      created_by: user.id,
      run_type: row.run_type ?? "regular",
      run_order: row.run_order ?? null,
      collection_time: row.collection_time ?? null,
      collection_date: null, // backloads with a collection_date relative to the source week don't carry forward
      factory: row.factory ?? null,
      booking_time: row.booking_time ?? null,
      subby_driver: row.subby_driver ?? null,
      subby_cost: row.subby_cost ?? null,
      trailer_number: row.trailer_number ?? null,
      trailer_dropped: false,
      reference: row.reference ?? null,
      revenue: 0,
      billable: false,
      invoice_status: "open",
      xero_invoice_id: null,
      xero_exported_at: null,
      day_index: null,
      day_count: null,
    };
  });

  const { error: insErr } = await supabase.from("runs").insert(payload);
  if (insErr) return { error: insErr.message };
  return { inserted: payload.length };
}

/**
 * Copy a whole week (Mon..Sun) of runs from one ISO week into another, day
 * by day. Stops at the first error and reports how many days/rows were copied.
 */
export async function copyWeekForward(
  fromYear: number,
  fromWeek: number,
  toYear: number,
  toWeek: number
): Promise<{ insertedRows?: number; error?: string }> {
  if (fromYear === toYear && fromWeek === toWeek) {
    return { error: "Source and target week are identical" };
  }
  // Resolve Mondays.
  const { isoWeekMonday } = await import("@/lib/iso-week");
  const sourceMon = isoWeekMonday(fromYear, fromWeek);
  const targetMon = isoWeekMonday(toYear, toWeek);

  let total = 0;
  for (let d = 0; d < 7; d++) {
    const src = shiftIso(sourceMon, d);
    const tgt = shiftIso(targetMon, d);
    const res = await copyDayForward(src, tgt);
    if (res.error) {
      return {
        error: `Day ${d + 1} (${src} → ${tgt}): ${res.error}. Copied ${total} rows so far.`,
      };
    }
    total += res.inserted ?? 0;
  }
  return { insertedRows: total };
}
