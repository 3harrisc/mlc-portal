"use server";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  HR_BUCKET,
  SIGNATURE_SELECT,
  URL_TTL_SECONDS,
  downloadHrFile,
  errorMessage,
  getSessionProfile,
  requestMeta,
  requireAdmin,
  requireDriver,
  type SessionProfile,
} from "@/lib/hr/server";
import {
  AGREEMENT_TEXT,
  HR_CATEGORIES,
  categoryLabel,
  rowToHrDocument,
  rowToHrSignature,
  type DriverDocumentView,
  type HrAssignment,
  type HrAudience,
  type HrCategory,
  type HrDocument,
  type HrDriver,
  type HrSignature,
} from "@/types/hr";
import {
  appliesToDriver,
  driverDocumentViews,
  needsSignature,
  STATUS_PRIORITY,
} from "@/lib/hr/status";
import { looksLikePdf, parseSignatureDataUrl } from "@/lib/hr/signature-image";
import {
  appendSignatureCertificate,
  assertSignablePdf,
  sha256Hex,
} from "@/lib/hr/certificate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_PATH_RE = /^documents\/[0-9a-f-]{36}\.pdf$/i;

// ────────────────────────────────────────────────────────────────────────────
// Admin
// ────────────────────────────────────────────────────────────────────────────

export interface HrOverview {
  documents: HrDocument[];
  assignments: HrAssignment[];
  signatures: HrSignature[];
  drivers: HrDriver[];
}

export async function listHrOverview(): Promise<{ data?: HrOverview; error?: string }> {
  try {
    await requireAdmin();
    const db = getSupabaseAdmin();
    const [docs, assigns, sigs, drivers] = await Promise.all([
      db.from("hr_documents").select("*").order("created_at", { ascending: false }),
      db.from("hr_document_assignments").select("document_id, driver_id"),
      db.from("hr_signatures").select(SIGNATURE_SELECT),
      db
        .from("profiles")
        .select("id, email, full_name, active")
        .eq("role", "driver")
        .order("full_name", { ascending: true }),
    ]);
    const failed = [docs, assigns, sigs, drivers].find((r) => r.error);
    if (failed?.error) return { error: failed.error.message };
    return {
      data: {
        documents: (docs.data ?? []).map(rowToHrDocument),
        assignments: (assigns.data ?? []).map((a) => ({
          documentId: a.document_id,
          driverId: a.driver_id,
        })),
        signatures: (sigs.data ?? []).map(rowToHrSignature),
        drivers: (drivers.data ?? []).map((d) => ({
          id: d.id,
          email: d.email,
          fullName: d.full_name,
          active: d.active,
        })),
      },
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Step 1 of upload: a one-time URL the browser uploads the PDF to directly. */
export async function createDocumentUpload(
  fileName: string,
): Promise<{ path?: string; token?: string; error?: string }> {
  try {
    await requireAdmin();
    if (!/\.pdf$/i.test(fileName)) return { error: "Only PDF files can be uploaded." };
    const path = `documents/${randomUUID()}.pdf`;
    const { data, error } = await getSupabaseAdmin()
      .storage.from(HR_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) return { error: error?.message ?? "Couldn't start upload" };
    return { path, token: data.token };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export interface FinalizeDocumentInput {
  path: string;
  fileName: string;
  title: string;
  category: HrCategory;
  description: string;
  audience: HrAudience;
  driverIds: string[];
  resignMonths: number | null;
  requiresCountersign: boolean;
  publish: boolean;
}

/** Step 2 of upload: verify the uploaded file and record the document. */
export async function finalizeDocument(
  input: FinalizeDocumentInput,
): Promise<{ id?: string; error?: string }> {
  let admin: SessionProfile;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return { error: errorMessage(e) };
  }
  const db = getSupabaseAdmin();
  const discard = () => db.storage.from(HR_BUCKET).remove([input.path]);

  if (!UPLOAD_PATH_RE.test(input.path)) return { error: "Invalid upload path" };
  const title = input.title?.trim() ?? "";
  if (!title || title.length > 200) {
    await discard();
    return { error: "Title is required (max 200 characters)." };
  }
  if (!HR_CATEGORIES.some((c) => c.value === input.category)) {
    await discard();
    return { error: "Unknown category" };
  }
  if (input.audience !== "all" && input.audience !== "selected") {
    await discard();
    return { error: "Unknown audience" };
  }
  const driverIds = [...new Set(input.driverIds ?? [])];
  if (input.audience === "selected" && (driverIds.length === 0 || !driverIds.every((id) => UUID_RE.test(id)))) {
    await discard();
    return { error: "Pick at least one driver." };
  }
  const resign = input.resignMonths;
  if (resign != null && (!Number.isInteger(resign) || resign < 1 || resign > 120)) {
    await discard();
    return { error: "Re-sign period must be 1–120 months." };
  }

  try {
    const bytes = await downloadHrFile(input.path);
    if (!looksLikePdf(bytes)) throw new Error("That file isn't a PDF.");
    await assertSignablePdf(bytes);

    const now = new Date().toISOString();
    const { data: doc, error } = await db
      .from("hr_documents")
      .insert({
        title,
        category: input.category,
        description: input.description?.trim() || null,
        storage_path: input.path,
        file_name: input.fileName.slice(0, 255),
        file_size: bytes.length,
        file_sha256: sha256Hex(bytes),
        audience: input.audience,
        resign_months: resign,
        requires_countersign: input.requiresCountersign === true,
        status: input.publish ? "published" : "draft",
        published_at: input.publish ? now : null,
        created_by: admin.id,
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Couldn't save document");

    if (input.audience === "selected") {
      const { error: aErr } = await db.from("hr_document_assignments").insert(
        driverIds.map((driver_id) => ({
          document_id: doc.id,
          driver_id,
          assigned_by: admin.id,
        })),
      );
      if (aErr) {
        await db.from("hr_documents").delete().eq("id", doc.id);
        throw new Error(aErr.message);
      }
    }
    return { id: doc.id };
  } catch (e) {
    await discard();
    return { error: errorMessage(e) };
  }
}

export async function publishDocument(id: string): Promise<{ error?: string }> {
  try {
    await requireAdmin();
    const { error } = await getSupabaseAdmin()
      .from("hr_documents")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft");
    return error ? { error: error.message } : {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function archiveDocument(id: string): Promise<{ error?: string }> {
  try {
    await requireAdmin();
    const { error } = await getSupabaseAdmin()
      .from("hr_documents")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", id);
    return error ? { error: error.message } : {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Drafts were never shown to drivers, so they can be removed outright. */
export async function deleteDraftDocument(id: string): Promise<{ error?: string }> {
  try {
    await requireAdmin();
    const db = getSupabaseAdmin();
    const { data: doc } = await db
      .from("hr_documents")
      .select("storage_path, status")
      .eq("id", id)
      .single();
    if (!doc) return { error: "Document not found" };
    if (doc.status !== "draft") return { error: "Only drafts can be deleted — archive it instead." };
    const { error } = await db.from("hr_documents").delete().eq("id", id);
    if (error) return { error: error.message };
    await db.storage.from(HR_BUCKET).remove([doc.storage_path]);
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Viewing files (admin or the driver it applies to)
// ────────────────────────────────────────────────────────────────────────────

export async function getDocumentUrl(documentId: string): Promise<{ url?: string; error?: string }> {
  try {
    const me = await getSessionProfile();
    const db = getSupabaseAdmin();
    const { data: row } = await db.from("hr_documents").select("*").eq("id", documentId).single();
    if (!row) return { error: "Document not found" };

    if (me.role !== "admin") {
      if (me.role !== "driver") return { error: "Not authorized" };
      const { data: assigns } = await db
        .from("hr_document_assignments")
        .select("document_id, driver_id")
        .eq("document_id", documentId)
        .eq("driver_id", me.id);
      const assignments = (assigns ?? []).map((a) => ({ documentId: a.document_id, driverId: a.driver_id }));
      if (!appliesToDriver(rowToHrDocument(row), me.id, assignments)) return { error: "Not authorized" };
    }

    const { data, error } = await db.storage
      .from(HR_BUCKET)
      .createSignedUrl(row.storage_path, URL_TTL_SECONDS);
    if (error || !data) return { error: error?.message ?? "Couldn't open document" };
    return { url: data.signedUrl };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function getSignedCopyUrl(signatureId: string): Promise<{ url?: string; error?: string }> {
  try {
    const me = await getSessionProfile();
    const db = getSupabaseAdmin();
    const { data: row } = await db
      .from("hr_signatures")
      .select("driver_id, signed_pdf_path, hr_countersignatures(countersigned_pdf_path)")
      .eq("id", signatureId)
      .single();
    if (!row) return { error: "Signature not found" };
    if (me.role !== "admin" && row.driver_id !== me.id) return { error: "Not authorized" };
    // Once MLC has countersigned, the countersigned PDF is the complete copy.
    const cs = Array.isArray(row.hr_countersignatures)
      ? row.hr_countersignatures[0]
      : row.hr_countersignatures;
    const path: string = cs?.countersigned_pdf_path ?? row.signed_pdf_path;
    const { data, error } = await db.storage
      .from(HR_BUCKET)
      .createSignedUrl(path, URL_TTL_SECONDS, { download: true });
    if (error || !data) return { error: error?.message ?? "Couldn't open signed copy" };
    return { url: data.signedUrl };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Driver
// ────────────────────────────────────────────────────────────────────────────

async function loadDriverViews(driverId: string): Promise<DriverDocumentView[]> {
  const db = getSupabaseAdmin();
  const [docs, assigns, sigs] = await Promise.all([
    db.from("hr_documents").select("*").eq("status", "published"),
    db.from("hr_document_assignments").select("document_id, driver_id").eq("driver_id", driverId),
    db
      .from("hr_signatures")
      .select(SIGNATURE_SELECT)
      .eq("driver_id", driverId),
  ]);
  const failed = [docs, assigns, sigs].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  return driverDocumentViews(
    driverId,
    (docs.data ?? []).map(rowToHrDocument),
    (assigns.data ?? []).map((a) => ({ documentId: a.document_id, driverId: a.driver_id })),
    (sigs.data ?? []).map(rowToHrSignature),
    new Date(),
  ).sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
}

export async function listMyDocuments(): Promise<{ views?: DriverDocumentView[]; error?: string }> {
  try {
    const me = await requireDriver();
    return { views: await loadDriverViews(me.id) };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export interface SignDocumentInput {
  documentId: string;
  signedName: string;
  agreed: boolean;
  signatureDataUrl: string;
}

export async function signDocument(
  input: SignDocumentInput,
): Promise<{ signatureId?: string; error?: string }> {
  const uploaded: string[] = [];
  const db = getSupabaseAdmin();
  try {
    const me = await requireDriver();
    if (input.agreed !== true) return { error: "Please tick the box to confirm you've read the document." };
    const signedName = (input.signedName ?? "").trim().replace(/\s+/g, " ");
    if (signedName.length < 2 || signedName.length > 100) {
      return { error: "Please type your full name." };
    }
    const signaturePng = parseSignatureDataUrl(input.signatureDataUrl);

    const view = (await loadDriverViews(me.id)).find((v) => v.document.id === input.documentId);
    if (!view) return { error: "This document isn't available to you." };
    if (!needsSignature(view.status)) return { error: "You've already signed this document." };

    const { data: row } = await db
      .from("hr_documents")
      .select("storage_path, file_sha256")
      .eq("id", input.documentId)
      .single();
    if (!row) return { error: "Document not found" };

    const original = await downloadHrFile(row.storage_path);
    const documentSha256 = sha256Hex(original);
    if (documentSha256 !== row.file_sha256) {
      return { error: "This document failed an integrity check. Please tell the office." };
    }

    const { ipAddress, userAgent } = await requestMeta();
    const signatureId = randomUUID();
    const signedAt = new Date();

    const signedPdf = await appendSignatureCertificate(original, signaturePng, {
      signatureId,
      documentTitle: view.document.title,
      documentCategory: categoryLabel(view.document.category),
      documentId: view.document.id,
      documentSha256,
      signedName,
      driverName: me.full_name,
      driverEmail: me.email,
      signedAt,
      ipAddress,
      userAgent,
      agreementText: AGREEMENT_TEXT,
    });

    const pdfPath = `signed/${me.id}/${signatureId}.pdf`;
    const pngPath = `signatures/${me.id}/${signatureId}.png`;
    const store = async (path: string, bytes: Uint8Array, contentType: string) => {
      const { error } = await db.storage.from(HR_BUCKET).upload(path, bytes, { contentType });
      if (error) throw new Error(`Couldn't store signed copy: ${error.message}`);
      uploaded.push(path);
    };
    await store(pngPath, signaturePng, "image/png");
    await store(pdfPath, signedPdf, "application/pdf");

    const { error } = await db.from("hr_signatures").insert({
      id: signatureId,
      document_id: view.document.id,
      driver_id: me.id,
      driver_email: me.email,
      driver_name: me.full_name,
      signed_name: signedName,
      agreement_text: AGREEMENT_TEXT,
      document_sha256: documentSha256,
      signed_pdf_path: pdfPath,
      signed_pdf_sha256: sha256Hex(signedPdf),
      signature_image_path: pngPath,
      ip_address: ipAddress,
      user_agent: userAgent,
      signed_at: signedAt.toISOString(),
    });
    if (error) throw new Error(error.message);
    return { signatureId };
  } catch (e) {
    if (uploaded.length) await db.storage.from(HR_BUCKET).remove(uploaded);
    return { error: errorMessage(e) };
  }
}
