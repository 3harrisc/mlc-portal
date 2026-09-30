import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// Shared by the HR server actions. All HR writes use the service role after
// an explicit role check here; the tables have read-only RLS and the bucket
// has no storage policies.

export const HR_BUCKET = "hr-documents";
export const URL_TTL_SECONDS = 10 * 60;

export interface SessionProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "customer" | "driver";
  active: boolean;
}

export async function getSessionProfile(): Promise<SessionProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!profile || !profile.active) throw new Error("Account not active");
  return profile as SessionProfile;
}

export async function requireAdmin(): Promise<SessionProfile> {
  const p = await getSessionProfile();
  if (p.role !== "admin") throw new Error("Admin role required");
  return p;
}

export async function requireDriver(): Promise<SessionProfile> {
  const p = await getSessionProfile();
  if (p.role !== "driver") throw new Error("Driver role required");
  return p;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function downloadHrFile(path: string): Promise<Uint8Array> {
  const { data, error } = await getSupabaseAdmin().storage.from(HR_BUCKET).download(path);
  if (error || !data) throw new Error("Couldn't read the stored file");
  return new Uint8Array(await data.arrayBuffer());
}

/** Client IP and device, recorded on signature certificates. */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) || null,
  };
}

/** Signature columns plus the embedded countersignature, if any. */
export const SIGNATURE_SELECT =
  "id, document_id, driver_id, signed_name, signed_at, hr_countersignatures(signer_name, signer_title, signed_at)";
