"use client";

import { createClient } from "@/lib/supabase/client";
import { createDriverFileUpload } from "@/app/actions/hr-drivers";
import type { LicenceCheck } from "@/lib/hr/licence";

const MAX_BYTES = 20 * 1024 * 1024;

/** Upload a driver file straight to private storage; returns its storage path. */
export async function uploadDriverFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 20 MB.");
  const start = await createDriverFileUpload(file.name);
  if (start.error || !start.path || !start.token) throw new Error(start.error ?? "Upload failed");
  const { error } = await createClient()
    .storage.from("hr-documents")
    .uploadToSignedUrl(start.path, start.token, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return start.path;
}

/** Ask the HR assistant to read an uploaded AssetGo licence check. */
export async function readLicenceCheck(path: string): Promise<LicenceCheck> {
  const res = await fetch("/api/hr/licence-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.licence) throw new Error(j.error ?? `Couldn't read the licence check (${res.status})`);
  return j.licence as LicenceCheck;
}
