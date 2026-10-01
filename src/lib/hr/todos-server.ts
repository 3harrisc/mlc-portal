/**
 * Loads everything the HR to-do list needs with the service role. No auth
 * check here: callers are the admin-only getHrTodos action and the
 * CRON_SECRET-protected digest job.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { ASSIGNMENT_SELECT, SIGNATURE_SELECT } from "./server";
import { hrTodos, type HrTodo } from "./todos";
import { rowToHrAssignment, rowToHrDocument, rowToHrSignature } from "@/types/hr";
import { rowToDriver, type DriverFileKind } from "@/types/hr-drivers";

export async function loadHrTodos(now = new Date()): Promise<HrTodo[]> {
  const db = getSupabaseAdmin();
  const [drivers, files, docs, assigns, sigs, logins] = await Promise.all([
    db.from("hr_drivers").select("*"),
    db.from("hr_driver_files").select("driver_id, kind"),
    db.from("hr_documents").select("*").eq("status", "published"),
    db.from("hr_document_assignments").select(ASSIGNMENT_SELECT),
    db.from("hr_signatures").select(SIGNATURE_SELECT),
    db.from("profiles").select("id, email, full_name, active").eq("role", "driver"),
  ]);
  const failed = [drivers, files, docs, assigns, sigs, logins].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const fileKinds: Record<string, DriverFileKind[]> = {};
  for (const f of files.data ?? []) (fileKinds[f.driver_id] ??= []).push(f.kind);

  return hrTodos({
    drivers: (drivers.data ?? []).map(rowToDriver),
    fileKinds,
    documents: (docs.data ?? []).map(rowToHrDocument),
    assignments: (assigns.data ?? []).map(rowToHrAssignment),
    signatures: (sigs.data ?? []).map(rowToHrSignature),
    logins: (logins.data ?? []).filter((l) => l.active).map((l) => ({ id: l.id, email: l.email, fullName: l.full_name })),
    now,
  });
}
