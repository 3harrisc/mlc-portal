"use server";

import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

interface ActionResult<T = undefined> {
  success?: true;
  data?: T;
  error?: string;
}

interface ShareTokenInfo {
  token: string;
  createdAt: string;
  url: string;
}

async function getAuthedSupabase() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

async function ensurePermission(runId: string) {
  const { supabase, user } = await getAuthedSupabase();
  const [{ data: run }, { data: profile }] = await Promise.all([
    supabase.from("runs").select("customer").eq("id", runId).maybeSingle(),
    supabase
      .from("profiles")
      .select("role, allowed_customers")
      .eq("id", user.id)
      .single(),
  ]);
  if (!run) throw new Error("Load not found");
  if (!profile) throw new Error("Profile missing");
  if (profile.role !== "admin") {
    const allowed: string[] = profile.allowed_customers ?? [];
    if (!allowed.includes(run.customer)) {
      throw new Error("You don't have access to this load");
    }
  }
  return supabase;
}

function makeToken(): string {
  return randomBytes(18).toString("base64url");
}

function publicUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/track/${token}`;
}

/** Return the current token for a run, or null. */
export async function getPortalShareToken(
  runId: string,
): Promise<ActionResult<ShareTokenInfo | null>> {
  try {
    const supabase = await ensurePermission(runId);
    const { data, error } = await supabase
      .from("runs")
      .select("share_token, share_token_created_at")
      .eq("id", runId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data?.share_token) return { success: true, data: null };
    return {
      success: true,
      data: {
        token: data.share_token,
        createdAt: data.share_token_created_at,
        url: publicUrl(data.share_token),
      },
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Generate a new token for the run, replacing any existing one. */
export async function generatePortalShareToken(
  runId: string,
): Promise<ActionResult<ShareTokenInfo>> {
  try {
    const supabase = await ensurePermission(runId);
    const token = makeToken();
    const createdAt = new Date().toISOString();
    const { error } = await supabase
      .from("runs")
      .update({
        share_token: token,
        share_token_created_at: createdAt,
      })
      .eq("id", runId);
    if (error) return { error: error.message };
    return {
      success: true,
      data: { token, createdAt, url: publicUrl(token) },
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Revoke the run's share token. The public URL will then 404. */
export async function revokePortalShareToken(
  runId: string,
): Promise<ActionResult> {
  try {
    const supabase = await ensurePermission(runId);
    const { error } = await supabase
      .from("runs")
      .update({ share_token: null, share_token_created_at: null })
      .eq("id", runId);
    if (error) return { error: error.message };
    return { success: true };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
