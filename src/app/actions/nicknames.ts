"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizePostcode } from "@/lib/postcode-utils";

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

  if (profile?.role !== "admin") throw new Error("Not authorized");
  return supabase;
}

export async function listNicknames() {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("postcode_nicknames")
    .select("postcode, nickname")
    .order("postcode");

  if (error) return { error: error.message, nicknames: [] };
  return { nicknames: data ?? [] };
}

export async function upsertNickname(postcode: string, nickname: string) {
  const supabase = await requireAdmin();
  const norm = normalizePostcode(postcode);

  if (!norm || !nickname.trim()) {
    return { error: "Postcode and nickname are required" };
  }

  const { error } = await supabase
    .from("postcode_nicknames")
    .upsert(
      { postcode: norm, nickname: nickname.trim() },
      { onConflict: "postcode" }
    );

  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteNickname(postcode: string) {
  const supabase = await requireAdmin();

  const { error } = await supabase
    .from("postcode_nicknames")
    .delete()
    .eq("postcode", normalizePostcode(postcode));

  if (error) return { error: error.message };
  return { success: true };
}
