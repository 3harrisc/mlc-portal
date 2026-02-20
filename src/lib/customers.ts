import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/types/runs";

export const DEFAULT_BASE = "GL2 7ND";

/** Fetch all customers from DB, sorted by name */
export async function fetchCustomers(): Promise<Customer[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name, base_postcode, open_time, close_time")
    .order("name", { ascending: true });
  return data ?? [];
}

/** Get customer names as a string array (for dropdowns) */
export async function fetchCustomerNames(): Promise<string[]> {
  const customers = await fetchCustomers();
  return customers.map((c) => c.name);
}
