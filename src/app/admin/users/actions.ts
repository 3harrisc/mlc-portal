"use server";

import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Admin client that can manage auth users (uses service role key)
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

export async function inviteUser(email: string, role: string) {
  await requireAdmin();

  const admin = getAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  // Invite user by email — Supabase creates the auth user and sends a magic link
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth/callback`,
  });

  if (error) return { error: error.message };

  // The DB trigger creates a profile with role='customer'.
  // Update to the admin-selected role if different.
  if (role !== "customer" && data.user) {
    await admin
      .from("profiles")
      .update({ role })
      .eq("id", data.user.id);
  }

  return { success: true };
}

export async function updateUserRole(userId: string, role: string) {
  await requireAdmin();

  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) return { error: error.message };
  return { success: true };
}

export async function toggleUserActive(userId: string, active: boolean) {
  await requireAdmin();

  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) return { error: error.message };
  return { success: true };
}

export async function listUsers() {
  await requireAdmin();

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, active, created_at")
    .order("created_at", { ascending: true });

  if (error) return { error: error.message, users: [] };
  return { users: data ?? [] };
}
