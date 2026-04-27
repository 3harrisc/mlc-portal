"use server";

import { createClient } from "@/lib/supabase/server";
import { rowToRun } from "@/types/runs";
import {
  rowToCustomerXeroMap,
  type CustomerXeroMap,
} from "@/types/invoicing";
import type { PlannedRun } from "@/types/runs";
import { isoWeekMonday } from "@/lib/iso-week";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

async function requireAdmin() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    throw new Error("Admin role required");
  }
  return { supabase, user };
}

/** End of an ISO week (Sunday). */
function isoWeekSunday(year: number, week: number): string {
  const monday = isoWeekMonday(year, week);
  const [y, m, d] = monday.split("-").map(Number);
  const sun = new Date(Date.UTC(y, m - 1, d + 6));
  const yyyy = sun.getUTCFullYear();
  const mm = String(sun.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(sun.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Return all runs in a given ISO week (Monday..Sunday inclusive). */
export async function listRunsForWeek(year: number, week: number) {
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

  const runs: PlannedRun[] = (data ?? []).map(rowToRun);
  return { runs, startDate, endDate };
}

/** Update billable / revenue / loadRef on a single run. */
export async function setRunBillingFields(
  id: string,
  fields: {
    billable?: boolean;
    revenue?: number;
    loadRef?: string;
    invoiceStatus?: "open" | "billable" | "sent" | "paid" | "cancelled";
  }
) {
  const { supabase } = await getUser();

  const update: Record<string, unknown> = {};
  if (fields.billable !== undefined) update.billable = fields.billable;
  if (fields.revenue !== undefined) update.revenue = fields.revenue;
  if (fields.loadRef !== undefined) update.load_ref = fields.loadRef;
  if (fields.invoiceStatus !== undefined) update.invoice_status = fields.invoiceStatus;

  const { error } = await supabase.from("runs").update(update).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

/** Read the customer_xero_map table. */
export async function listCustomerXeroMap(): Promise<{
  entries?: CustomerXeroMap[];
  error?: string;
}> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("customer_xero_map")
    .select("*")
    .order("planner_name", { ascending: true });
  if (error) return { error: error.message };
  return { entries: (data ?? []).map(rowToCustomerXeroMap) };
}

/**
 * Reserve `count` invoice numbers atomically. Returns the highest reserved
 * number; caller numbers their invoices `(reserved - count + 1) ... reserved`.
 *
 * Uses the `reserve_invoice_numbers` RPC defined in migration 008.
 */
export async function reserveInvoiceNumbers(count: number): Promise<{
  highest?: number;
  error?: string;
}> {
  if (!Number.isInteger(count) || count <= 0) {
    return { error: "count must be a positive integer" };
  }
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("reserve_invoice_numbers", {
    p_id: "xero",
    p_count: count,
  });
  if (error) return { error: error.message };
  const highest = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(highest)) return { error: "reserve_invoice_numbers returned non-numeric" };
  return { highest };
}

/**
 * After a successful Xero export, mark the runs as 'sent' and stamp the
 * invoice id + export timestamp.
 */
export async function markRunsExported(
  assignments: ReadonlyArray<{ runIds: ReadonlyArray<string>; invoiceNumber: string }>
) {
  const { supabase } = await requireAdmin();
  const now = new Date().toISOString();

  const updates = assignments.flatMap((a) =>
    a.runIds.map((id) => ({ id, invoice: a.invoiceNumber }))
  );

  // Fan out one update per row. The volumes are small (a week is ~150 rows)
  // and Supabase doesn't support bulk update-by-ids in a single call.
  const errors: string[] = [];
  for (const u of updates) {
    const { error } = await supabase
      .from("runs")
      .update({
        invoice_status: "sent",
        xero_invoice_id: u.invoice,
        xero_exported_at: now,
      })
      .eq("id", u.id);
    if (error) errors.push(`${u.id}: ${error.message}`);
  }

  if (errors.length > 0) {
    return { error: `Marked some rows but ${errors.length} failed: ${errors.slice(0, 3).join("; ")}` };
  }
  return { success: true, count: updates.length };
}

/** Admin: clear export flags so the row can be re-exported. */
export async function unexportRun(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("runs")
    .update({
      invoice_status: "billable",
      xero_invoice_id: null,
      xero_exported_at: null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

