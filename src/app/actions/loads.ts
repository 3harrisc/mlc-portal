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
import { runToRow } from "@/types/runs";

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
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
