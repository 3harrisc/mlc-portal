"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
import type { CostCategory } from "@/types/costs";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service role config");
  return createAdminSupabase(url, key);
}

async function requireAdmin() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Not authorized");
  return user;
}

/** Create a cost entry */
export async function createCost(fields: {
  runId: string | null;
  vehicle: string;
  date: string;
  category: CostCategory;
  amount: number;
  note: string;
  receiptUrl: string | null;
}) {
  const { supabase, user } = await getUser();

  const { error } = await supabase.from("costs").insert({
    driver_id: user.id,
    run_id: fields.runId,
    vehicle: fields.vehicle,
    date: fields.date,
    category: fields.category,
    amount: fields.amount,
    note: fields.note || "",
    receipt_url: fields.receiptUrl,
  });

  if (error) return { error: error.message };
  return { success: true };
}

/** Delete a cost entry (driver can delete own, admin can delete any) */
export async function deleteCost(id: string) {
  const { supabase } = await getUser();

  const { error } = await supabase.from("costs").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

/** List costs for the authenticated driver in a date range */
export async function listDriverCosts(date: string) {
  const { supabase, user } = await getUser();

  const { data, error } = await supabase
    .from("costs")
    .select("*")
    .eq("driver_id", user.id)
    .eq("date", date)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message, costs: [] };
  return { costs: data ?? [] };
}

/** Admin: list all costs in a date range with driver info */
export async function listAllCosts(dateFrom: string, dateTo: string) {
  await requireAdmin();
  const admin = getAdminClient();

  const { data, error } = await admin
    .from("costs")
    .select("*, profiles!costs_driver_id_fkey(email, full_name, assigned_vehicle)")
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return { error: error.message, costs: [] };
  return { costs: data ?? [] };
}
