"use server";

import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service role config");
  return createClient(url, key);
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Not authorized");
  return user;
}

export async function listCustomers() {
  await requireAdmin();
  const admin = getAdminClient();

  const { data: customers, error } = await admin
    .from("customers")
    .select("*")
    .order("name", { ascending: true });

  if (error) return { error: error.message, customers: [] };

  // Get run counts per customer in one query
  const { data: runs } = await admin
    .from("runs")
    .select("customer");

  const countMap: Record<string, number> = {};
  for (const r of runs ?? []) {
    countMap[r.customer] = (countMap[r.customer] ?? 0) + 1;
  }

  const enriched = (customers ?? []).map((c: any) => ({
    ...c,
    run_count: countMap[c.name] ?? 0,
  }));

  return { customers: enriched };
}

export async function createCustomer(
  name: string,
  basePostcode: string,
  openTime: string,
  closeTime: string
) {
  await requireAdmin();
  const admin = getAdminClient();
  const { error } = await admin.from("customers").insert({
    name: name.trim(),
    base_postcode: basePostcode.trim(),
    open_time: openTime,
    close_time: closeTime,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateCustomer(
  id: string,
  fields: { name?: string; base_postcode?: string; open_time?: string; close_time?: string }
) {
  await requireAdmin();
  const admin = getAdminClient();

  // If name is changing, cascade to runs + templates + profiles
  if (fields.name) {
    const { data: existing } = await admin
      .from("customers")
      .select("name")
      .eq("id", id)
      .single();

    if (existing && existing.name !== fields.name.trim()) {
      const oldName = existing.name;
      const newName = fields.name.trim();

      await admin.from("runs").update({ customer: newName }).eq("customer", oldName);
      await admin.from("templates").update({ customer: newName }).eq("customer", oldName);

      // Update profiles.allowed_customers arrays
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, allowed_customers");

      for (const p of profiles ?? []) {
        const arr: string[] = p.allowed_customers ?? [];
        if (arr.includes(oldName)) {
          const updated = arr.map((c: string) => (c === oldName ? newName : c));
          await admin.from("profiles").update({ allowed_customers: updated }).eq("id", p.id);
        }
      }
    }
  }

  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) row.name = fields.name.trim();
  if (fields.base_postcode !== undefined) row.base_postcode = fields.base_postcode.trim();
  if (fields.open_time !== undefined) row.open_time = fields.open_time;
  if (fields.close_time !== undefined) row.close_time = fields.close_time;

  const { error } = await admin.from("customers").update(row).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteCustomer(id: string) {
  await requireAdmin();
  const admin = getAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("name")
    .eq("id", id)
    .single();

  if (!customer) return { error: "Customer not found" };

  const { count } = await admin
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("customer", customer.name);

  if (count && count > 0) {
    return { error: `Cannot delete: ${count} run(s) are connected to this customer.` };
  }

  const { error } = await admin.from("customers").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}
