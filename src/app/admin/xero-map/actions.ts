"use server";

import { createClient } from "@/lib/supabase/server";
import { rowToCustomerXeroMap, type CustomerXeroMap } from "@/types/invoicing";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admin role required");
  return { supabase, user };
}

export async function listXeroMap(): Promise<{
  entries?: CustomerXeroMap[];
  error?: string;
}> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("customer_xero_map")
    .select("*")
    .order("planner_name", { ascending: true });
  if (error) return { error: error.message };
  return { entries: (data ?? []).map(rowToCustomerXeroMap) };
}

export interface XeroMapInput {
  plannerName: string;
  xeroContactName?: string;
  accountCode?: string;
  taxType?: string;
  dueDays?: number;
  emailAddress?: string;
  brandingTheme?: string;
  notes?: string;
}

export async function createXeroMap(input: XeroMapInput) {
  const { supabase } = await requireAdmin();
  if (!input.plannerName.trim()) return { error: "plannerName is required" };
  const { error } = await supabase.from("customer_xero_map").insert({
    planner_name: input.plannerName.trim(),
    xero_contact_name: input.xeroContactName?.trim() || null,
    account_code: input.accountCode?.trim() || "200",
    tax_type: input.taxType?.trim() || "OUTPUT2",
    due_days: input.dueDays ?? 30,
    email_address: input.emailAddress?.trim() || null,
    branding_theme: input.brandingTheme?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateXeroMap(id: string, input: Partial<XeroMapInput>) {
  const { supabase } = await requireAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.plannerName !== undefined) update.planner_name = input.plannerName.trim();
  if (input.xeroContactName !== undefined) update.xero_contact_name = input.xeroContactName.trim() || null;
  if (input.accountCode !== undefined) update.account_code = input.accountCode.trim();
  if (input.taxType !== undefined) update.tax_type = input.taxType.trim();
  if (input.dueDays !== undefined) update.due_days = input.dueDays;
  if (input.emailAddress !== undefined) update.email_address = input.emailAddress.trim() || null;
  if (input.brandingTheme !== undefined) update.branding_theme = input.brandingTheme.trim() || null;
  if (input.notes !== undefined) update.notes = input.notes.trim() || null;

  const { error } = await supabase.from("customer_xero_map").update(update).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteXeroMap(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("customer_xero_map").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}
