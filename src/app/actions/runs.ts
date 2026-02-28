"use server";

import { createClient } from "@/lib/supabase/server";
import type { PlannedRun, ProgressState } from "@/types/runs";
import { runToRow } from "@/types/runs";

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

/** Bulk-insert runs */
export async function createRuns(runs: PlannedRun[]) {
  const { supabase, user } = await getUser();

  const rows = runs.map((r) => runToRow(r, user.id));

  const { error } = await supabase.from("runs").insert(rows);
  if (error) return { error: error.message };
  return { success: true };
}

/** Update specific fields of a run */
export async function updateRun(
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

  // Map camelCase fields to snake_case
  const row: Record<string, any> = {};
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

  const { error } = await supabase.from("runs").update(row).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

/** Bulk-update run_order for a set of runs (reordering within vehicle+date) */
export async function updateRunOrders(
  orders: Array<{ id: string; runOrder: number }>
) {
  const { supabase } = await getUser();

  const promises = orders.map(({ id, runOrder }) =>
    supabase.from("runs").update({ run_order: runOrder }).eq("id", id)
  );

  const results = await Promise.all(promises);
  const firstError = results.find((r) => r.error);
  if (firstError?.error) return { error: firstError.error.message };
  return { success: true };
}

/** Delete a single run */
export async function deleteRun(id: string) {
  const { supabase } = await getUser();

  const { error } = await supabase.from("runs").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

/** Atomically get the next job number for a date (e.g. "MLC-20260218-003") */
export async function nextJobNumber(dateISO: string) {
  const { supabase } = await getUser();

  const dateKey = dateISO.replaceAll("-", "");

  // Upsert: increment counter or create with 1
  const { data, error } = await supabase.rpc("increment_job_counter", { p_date_key: dateKey });

  if (error) {
    // Fallback: try manual upsert if RPC doesn't exist
    const { data: existing } = await supabase
      .from("job_counters")
      .select("counter")
      .eq("date_key", dateKey)
      .single();

    const next = (existing?.counter ?? 0) + 1;

    await supabase
      .from("job_counters")
      .upsert({ date_key: dateKey, counter: next });

    return { jobNumber: `MLC-${dateKey}-${String(next).padStart(3, "0")}` };
  }

  const counter = typeof data === "number" ? data : 1;
  return { jobNumber: `MLC-${dateKey}-${String(counter).padStart(3, "0")}` };
}
