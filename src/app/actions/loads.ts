"use server";

/**
 * Server actions for the customer-facing `loads` table.
 *
 * `loads` is structurally identical to `runs` (same columns), so we reuse the
 * PlannedRun type and the rowToRun / runToRow converters. The only difference
 * between this file and `runs.ts` is which Postgres table we touch.
 *
 * If you find yourself adding a column or a behaviour that should also exist
 * on the dispatch planner, add it to runs.ts too — the two are deliberately
 * twins for the time being. Future divergence (separate Load type, separate
 * status enum, etc.) is on the roadmap but out of scope for the split.
 */

import { createClient } from "@/lib/supabase/server";
import type { PlannedRun, ProgressState } from "@/types/runs";
import { rowToRun, runToRow } from "@/types/runs";
import type { LoadStatus } from "@/lib/portal/status";
import { isStageValidFor, parseStageId, seedPatch } from "@/lib/portal/stage-seed";

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

/**
 * All loads on a specific date, scoped by allowed_customers for non-admin
 * users. Sorted by vehicle → run_order → start_time (matches the dispatch
 * planner sort) so chained-start computation downstream is deterministic.
 */
export async function listLoadsForDate(
  date: string,
): Promise<{ loads?: PlannedRun[]; error?: string }> {
  const { supabase, user } = await getUser();

  // Scope check: non-admins only see their allowed_customers.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_customers")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";
  const allowed: string[] = profile?.allowed_customers ?? [];

  let query = supabase
    .from("loads")
    .select("*")
    .eq("date", date)
    .order("vehicle", { ascending: true, nullsFirst: false })
    .order("run_order", { ascending: true, nullsFirst: false })
    .order("start_time", { ascending: true });
  if (!isAdmin) {
    if (allowed.length === 0) return { loads: [] };
    query = query.in("customer", allowed);
  }
  const { data, error } = await query;
  if (error) return { error: error.message };
  return { loads: (data ?? []).map(rowToRun) };
}

/** Bulk-insert customer loads. */
export async function createLoads(loads: PlannedRun[]) {
  const { supabase, user } = await getUser();
  const rows = loads.map((r) => runToRow(r, user.id));
  const { error } = await supabase.from("loads").insert(rows);
  if (error) return { error: error.message };
  return { success: true };
}

/** Update fields on a single load. Mirrors `updateRun`. */
export async function updateLoad(
  id: string,
  fields: Partial<{
    date: string;
    vehicle: string;
    loadRef: string;
    rawText: string;
    progress: ProgressState;
    completedStopIndexes: number[];
    completedMeta: Record<number, { atISO?: string; by: "auto" | "admin" | "driver"; arrivedISO?: string }>;
    runType: string;
    runOrder: number | null;
    collectionTime: string | null;
    collectionDate: string | null;
    startTime: string;
    serviceMins: number;
    includeBreaks: boolean;
    fromPostcode: string;
    toPostcode: string;
    returnToBase: boolean;
    customer: string;
  }>
) {
  const { supabase } = await getUser();

  // Map camelCase fields to snake_case (same translation as updateRun).
  const row: Record<string, unknown> = {};
  if (fields.date !== undefined) row.date = fields.date;
  if (fields.vehicle !== undefined) row.vehicle = fields.vehicle;
  if (fields.loadRef !== undefined) row.load_ref = fields.loadRef;
  if (fields.rawText !== undefined) row.raw_text = fields.rawText;
  if (fields.progress !== undefined) row.progress = fields.progress;
  if (fields.completedStopIndexes !== undefined) row.completed_stop_indexes = fields.completedStopIndexes;
  if (fields.completedMeta !== undefined) row.completed_meta = fields.completedMeta;
  if (fields.runType !== undefined) row.run_type = fields.runType;
  if (fields.runOrder !== undefined) row.run_order = fields.runOrder;
  if (fields.collectionTime !== undefined) row.collection_time = fields.collectionTime;
  if (fields.collectionDate !== undefined) row.collection_date = fields.collectionDate;
  if (fields.startTime !== undefined) row.start_time = fields.startTime;
  if (fields.serviceMins !== undefined) row.service_mins = fields.serviceMins;
  if (fields.includeBreaks !== undefined) row.include_breaks = fields.includeBreaks;
  if (fields.fromPostcode !== undefined) row.from_postcode = fields.fromPostcode;
  if (fields.toPostcode !== undefined) row.to_postcode = fields.toPostcode;
  if (fields.returnToBase !== undefined) row.return_to_base = fields.returnToBase;
  if (fields.customer !== undefined) row.customer = fields.customer;

  const { error } = await supabase.from("loads").update(row).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Bulk-update run_order for a set of loads (drag-reorder within a vehicle on
 * a single day). Mirrors `updateRunOrders` for the dispatch planner.
 */
export async function updateLoadOrders(
  orders: Array<{ id: string; runOrder: number }>
) {
  const { supabase } = await getUser();

  const promises = orders.map(({ id, runOrder }) =>
    supabase.from("loads").update({ run_order: runOrder }).eq("id", id)
  );

  const results = await Promise.all(promises);
  const firstError = results.find((r) => r.error);
  if (firstError?.error) return { error: firstError.error.message };
  return { success: true };
}

/** Inline-edit helper: assign / clear the vehicle on a single load. */
export async function setLoadVehicle(id: string, vehicle: string) {
  const { supabase } = await getUser();
  const trimmed = vehicle.trim().toUpperCase();
  const { error } = await supabase
    .from("loads")
    .update({ vehicle: trimmed })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true, vehicle: trimmed };
}

/** Delete a single load. */
export async function deleteLoad(id: string) {
  const { supabase } = await getUser();
  const { error } = await supabase.from("loads").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Bulk delete. Admin-only — non-admins are scoped to their own customer rows
 * by RLS in app code anyway, but we keep the rule explicit just like
 * `deleteRuns`.
 */
export async function deleteLoads(ids: ReadonlyArray<string>): Promise<{
  deleted?: number;
  error?: string;
}> {
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Admin role required" };

  const { error } = await supabase.from("loads").delete().in("id", ids);
  if (error) return { error: error.message };
  return { deleted: ids.length };
}

/**
 * Promote a customer load into the dispatch planner.
 *
 * Reads the loads row, copies it across to the runs table with a fresh ID
 * (so the load and the planner row are separate records — same physical
 * journey, two perspectives) and a freshly minted job number for the
 * planner side. The original loads row is left in place so the customer
 * keeps their tracking view; the operator can delete it manually if they
 * no longer need it on the customer surface.
 *
 * Admin-only — only dispatch should be promoting loads to the planner.
 */
export async function copyLoadToPlanner(
  loadId: string,
): Promise<{ runId?: string; jobNumber?: string; error?: string }> {
  const { supabase, user } = await getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Admin role required" };

  // 1. Fetch the source load.
  const { data: load, error: fetchErr } = await supabase
    .from("loads")
    .select("*")
    .eq("id", loadId)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!load) return { error: "Load not found" };

  // 2. Mint a new ID + job number for the planner side. The job number RPC
  //    keys on the run date so the format matches the rest of the planner.
  const newRunId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dateKey = String(load.date ?? "").replaceAll("-", "");
  let jobNumber = "";
  if (dateKey) {
    const { data: counter, error: rpcErr } = await supabase.rpc(
      "increment_job_counter",
      { p_date_key: dateKey },
    );
    if (!rpcErr && typeof counter === "number") {
      jobNumber = `MLC-${dateKey}-${String(counter).padStart(3, "0")}`;
    }
  }

  // 3. Build the runs row from the load row. We deliberately copy the full
  //    payload (postcodes, raw_text, vehicle, times, etc.) so the planner
  //    has everything it needs out of the gate. Progress / completion meta
  //    are reset — the planner side starts from scratch even if the
  //    customer-tracking view already showed some progress.
  const planner = {
    ...load,
    id: newRunId,
    job_number: jobNumber,
    completed_stop_indexes: [],
    completed_meta: {},
    progress: {
      completedIdx: [],
      onSiteIdx: null,
      onSiteSinceMs: null,
      lastInside: false,
    },
    share_token: null,
    share_token_created_at: null,
    created_by: user.id,
    created_at: new Date().toISOString(),
  };
  // Drop columns Postgres will set on insert.
  delete (planner as Record<string, unknown>).updated_at;

  const { error: insertErr } = await supabase.from("runs").insert(planner);
  if (insertErr) return { error: insertErr.message };

  return { runId: newRunId, jobNumber };
}

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

/**
 * The pinned statuses that assert WHERE the vehicle is. Seeding a stage is a
 * positional assertion too, so it supersedes these — see setLoadStage.
 *
 * "delayed" and "exception" are absent on purpose: they describe lateness or a
 * problem, not position, and isEnRoute already falls through to the movement
 * signal for them, so they contradict nothing.
 */
const POSITIONAL_STATUSES: LoadStatus[] = [
  "scheduled",
  "loading",
  "in-transit",
  "delivered",
];

/**
 * Seed a load's progress to the stage an admin says the vehicle is at.
 *
 * Unlike setLoadStatusOverride this writes no override column — it writes the
 * real progress fields, so /api/cron/update-progress carries on from the
 * seeded state on its next cycle. See
 * docs/superpowers/specs/2026-08-26-timeline-stage-seed-design.md
 */
export async function setLoadStage(id: string, stage: string) {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Admin role required" };

  const parsed = parseStageId(stage);
  if (!parsed) return { error: "Unknown stage" };

  const { data: row, error: readErr } = await supabase
    .from("loads")
    .select("*")
    .eq("id", id)
    .single();
  if (readErr || !row) return { error: readErr?.message ?? "Load not found" };

  // The stage id is a <select> value and a plain server action argument, so a
  // hand-rolled POST can name a drop this load does not have. Checked against
  // the fetched row, because "legal" is a property of the load, not the id.
  const run = rowToRun(row);
  if (!isStageValidFor(parsed, run)) return { error: "Unknown stage" };

  const seed = seedPatch(parsed, run, new Date().toISOString());

  // A positional assertion supersedes a positional pin. The load detail page's
  // isEnRoute short-circuits on statusOverride BEFORE consulting progress, so a
  // load pinned "Scheduled" and then seeded to "heading to drop 2" would render
  // drop 1 done and 1/3 complete while the timeline still said "Scheduled: Drop
  // 2", the live ETA stayed suppressed and the pill still read "Scheduled".
  // Pinning the status is the existing workaround for the very bug this control
  // replaces, so production rows already carry one.
  const clearedOverride =
    run.statusOverride != null &&
    POSITIONAL_STATUSES.includes(run.statusOverride);

  const { error } = await supabase
    .from("loads")
    .update({
      progress: seed.progress,
      completed_stop_indexes: seed.completedStopIndexes,
      completed_meta: seed.completedMeta,
      ...(clearedOverride
        ? {
            status_override: null,
            status_override_by: null,
            status_override_at: null,
          }
        : {}),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // Returned so the caller can update local state without a refetch.
  return { success: true as const, seed, clearedOverride };
}
