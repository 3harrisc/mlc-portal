"use server";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { HR_BUCKET, URL_TTL_SECONDS, downloadHrFile, errorMessage, requireAdmin } from "@/lib/hr/server";
import { cleanDriverInput } from "@/lib/hr/driver-validate";
import { sha256Hex } from "@/lib/hr/certificate";
import { LicenceCheckSchema } from "@/lib/hr/licence";
import {
  rowToDriver,
  rowToDriverFile,
  type DriverFile,
  type DriverFileKind,
  type DriverInput,
  type DriverRecord,
} from "@/types/hr-drivers";

const FILE_PATH_RE = /^driver-files\/[0-9a-f-]{36}\.(pdf|png|jpe?g|heic)$/i;
const KINDS: DriverFileKind[] = ["licence_check", "right_to_work", "cpc_card", "tacho_card", "other"];

export interface DriverLogin {
  id: string;
  email: string;
  fullName: string | null;
}

export async function listDriverRecords(): Promise<{ drivers?: DriverRecord[]; logins?: DriverLogin[]; error?: string }> {
  try {
    await requireAdmin();
    const db = getSupabaseAdmin();
    const [drivers, logins] = await Promise.all([
      db.from("hr_drivers").select("*").order("surname"),
      db.from("profiles").select("id, email, full_name").eq("role", "driver").order("email"),
    ]);
    if (drivers.error) return { error: drivers.error.message };
    return {
      drivers: (drivers.data ?? []).map(rowToDriver),
      logins: (logins.data ?? []).map((p) => ({ id: p.id, email: p.email, fullName: p.full_name })),
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function getDriverRecord(id: string): Promise<{ driver?: DriverRecord; files?: DriverFile[]; error?: string }> {
  try {
    await requireAdmin();
    const db = getSupabaseAdmin();
    const [driver, files] = await Promise.all([
      db.from("hr_drivers").select("*").eq("id", id).single(),
      db.from("hr_driver_files").select("id, driver_id, kind, title, uploaded_at").eq("driver_id", id).order("uploaded_at", { ascending: false }),
    ]);
    if (!driver.data) return { error: "Driver not found" };
    return { driver: rowToDriver(driver.data), files: (files.data ?? []).map(rowToDriverFile) };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Create (no id) or update a driver record. */
export async function saveDriverRecord(id: string | null, input: Partial<DriverInput>): Promise<{ id?: string; error?: string }> {
  try {
    const admin = await requireAdmin();
    const values = cleanDriverInput(input);
    const db = getSupabaseAdmin();
    if (values.profile_id) {
      const { data: p } = await db.from("profiles").select("role").eq("id", values.profile_id).single();
      if (p?.role !== "driver") return { error: "Choose a driver login." };
    }
    const { data, error } = id
      ? await db.from("hr_drivers").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id).select("id").single()
      : await db.from("hr_drivers").insert({ ...values, created_by: admin.id }).select("id").single();
    if (error) {
      return { error: error.code === "23505" ? "That login is already linked to another driver." : error.message };
    }
    return { id: data.id };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** One-time URL for the browser to upload a driver file straight to private storage. */
export async function createDriverFileUpload(fileName: string): Promise<{ path?: string; token?: string; error?: string }> {
  try {
    await requireAdmin();
    const ext = fileName.toLowerCase().match(/\.(pdf|png|jpe?g|heic)$/)?.[1];
    if (!ext) return { error: "Upload a PDF or a photo (JPG, PNG, HEIC)." };
    const path = `driver-files/${randomUUID()}.${ext}`;
    const { data, error } = await getSupabaseAdmin().storage.from(HR_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { error: error?.message ?? "Couldn't start upload" };
    return { path, token: data.token };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export interface AddDriverFileInput {
  driverId: string;
  path: string;
  kind: DriverFileKind;
  title: string;
  /** For licence checks: the details read by the assistant, as confirmed by the admin. */
  licence?: unknown;
}

/** Attach an uploaded file to a driver. A licence check also becomes the record's current licence. */
export async function addDriverFile(input: AddDriverFileInput): Promise<{ error?: string }> {
  try {
    const admin = await requireAdmin();
    if (!FILE_PATH_RE.test(input.path)) return { error: "Invalid file" };
    if (!KINDS.includes(input.kind)) return { error: "Unknown file type" };
    const db = getSupabaseAdmin();
    const bytes = await downloadHrFile(input.path);

    let licence = null;
    if (input.kind === "licence_check" && input.licence) {
      const parsed = LicenceCheckSchema.safeParse(input.licence);
      if (!parsed.success) return { error: "The licence details aren't in the expected format." };
      licence = parsed.data;
    }

    const { error } = await db.from("hr_driver_files").insert({
      driver_id: input.driverId,
      kind: input.kind,
      title: (input.title || "File").slice(0, 200),
      storage_path: input.path,
      file_sha256: sha256Hex(bytes),
      file_size: bytes.length,
      extracted: licence,
      uploaded_by: admin.id,
    });
    if (error) return { error: error.message };

    if (licence) {
      // Only move the record forward: an older check uploaded later doesn't replace a newer one.
      const { data: current } = await db.from("hr_drivers").select("licence_checked_on").eq("id", input.driverId).single();
      if (!current?.licence_checked_on || !licence.checked_on || licence.checked_on >= current.licence_checked_on) {
        await db
          .from("hr_drivers")
          .update({ licence, licence_checked_on: licence.checked_on, updated_at: new Date().toISOString() })
          .eq("id", input.driverId);
      }
    }
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function getDriverFileUrl(fileId: string): Promise<{ url?: string; error?: string }> {
  try {
    await requireAdmin();
    const db = getSupabaseAdmin();
    const { data: f } = await db.from("hr_driver_files").select("storage_path").eq("id", fileId).single();
    if (!f) return { error: "File not found" };
    const { data, error } = await db.storage.from(HR_BUCKET).createSignedUrl(f.storage_path, URL_TTL_SECONDS);
    if (error || !data) return { error: error?.message ?? "Couldn't open file" };
    return { url: data.signedUrl };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
