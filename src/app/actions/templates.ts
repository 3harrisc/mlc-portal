"use server";

import { createClient } from "@/lib/supabase/server";
import type { RouteTemplate } from "@/types/runs";
import { templateToRow } from "@/types/runs";

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

/** Insert a new template */
export async function createTemplate(template: RouteTemplate) {
  const { supabase, user } = await getUser();

  const row = templateToRow(template, user.id);
  const { error } = await supabase.from("templates").insert(row);
  if (error) return { error: error.message };
  return { success: true };
}

/** Delete a template by ID */
export async function deleteTemplate(id: string) {
  const { supabase } = await getUser();

  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}
