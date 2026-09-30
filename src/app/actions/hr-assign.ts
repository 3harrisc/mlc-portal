"use server";

import { getSupabaseAdmin } from "@/lib/supabase";
import { errorMessage, requireAdmin } from "@/lib/hr/server";
import { cleanEmploymentDates } from "@/lib/hr/particulars";

export interface AssignDocumentInput {
  documentId: string;
  driverId: string;
  /** Required for documents that collect particulars (YYYY-MM-DD). */
  startDate?: string;
  continuousDate?: string;
}

/**
 * "Send to driver": add a driver to a selected-audience document. For a
 * particulars document (e.g. the blank contract) MLC sets the start dates
 * here. Re-sending before the driver has signed just corrects the dates.
 */
export async function assignDocument(input: AssignDocumentInput): Promise<{ error?: string }> {
  try {
    const admin = await requireAdmin();
    const db = getSupabaseAdmin();

    const [{ data: doc }, { data: driver }] = await Promise.all([
      db.from("hr_documents").select("id, status, audience, collects_particulars").eq("id", input.documentId).single(),
      db.from("profiles").select("id, role, active").eq("id", input.driverId).single(),
    ]);
    if (!doc) return { error: "Document not found" };
    if (doc.status === "archived") return { error: "This document is archived." };
    if (doc.audience !== "selected") return { error: "This document already goes to all drivers." };
    if (!driver || driver.role !== "driver" || !driver.active) return { error: "Choose an active driver." };

    const dates = doc.collects_particulars
      ? cleanEmploymentDates(input.startDate, input.continuousDate)
      : null;

    const { count } = await db
      .from("hr_signatures")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id)
      .eq("driver_id", driver.id);
    if (count) return { error: "This driver has already signed this document." };

    const { error } = await db.from("hr_document_assignments").upsert(
      {
        document_id: doc.id,
        driver_id: driver.id,
        assigned_by: admin.id,
        assigned_at: new Date().toISOString(),
        start_date: dates?.startDate ?? null,
        continuous_employment_date: dates?.continuousDate ?? null,
      },
      { onConflict: "document_id,driver_id" },
    );
    return error ? { error: error.message } : {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
