"use server";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  HR_BUCKET,
  downloadHrFile,
  errorMessage,
  requestMeta,
  requireAdmin,
} from "@/lib/hr/server";
import { parseSignatureDataUrl } from "@/lib/hr/signature-image";
import { appendCountersignCertificate, sha256Hex } from "@/lib/hr/certificate";
import { COUNTERSIGN_TEXT, MLC_SIGNATORIES } from "@/types/hr";

export interface CountersignInput {
  signatureId: string;
  signatoryName: string;
  agreed: boolean;
  signatureDataUrl: string;
}

/**
 * MLC countersigns one driver signature: the driver-signed PDF gets a second
 * certificate page and the result becomes the complete signed copy.
 */
export async function countersignDocument(
  input: CountersignInput,
): Promise<{ countersignatureId?: string; error?: string }> {
  const uploaded: string[] = [];
  const db = getSupabaseAdmin();
  try {
    const me = await requireAdmin();
    const signatory = MLC_SIGNATORIES.find((s) => s.name === input.signatoryName);
    if (!signatory) return { error: "Choose who is signing for MLC." };
    if (input.agreed !== true) return { error: "Please tick the box to confirm." };
    const signaturePng = parseSignatureDataUrl(input.signatureDataUrl);

    const { data: sig } = await db
      .from("hr_signatures")
      .select(
        "id, driver_id, signed_name, signed_pdf_path, signed_pdf_sha256, " +
          "hr_documents(title, status, requires_countersign), hr_countersignatures(id)",
      )
      .eq("id", input.signatureId)
      .single();
    if (!sig) return { error: "Signature not found" };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const row = sig as any;
    const doc = Array.isArray(row.hr_documents) ? row.hr_documents[0] : row.hr_documents;
    const existing = Array.isArray(row.hr_countersignatures)
      ? row.hr_countersignatures[0]
      : row.hr_countersignatures;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!doc?.requires_countersign) return { error: "This document doesn't need an MLC signature." };
    if (doc.status !== "published") return { error: "This document has been archived." };
    if (existing) return { error: "Already countersigned." };

    const driverSigned = await downloadHrFile(row.signed_pdf_path);
    const inputSha256 = sha256Hex(driverSigned);
    if (inputSha256 !== row.signed_pdf_sha256) {
      return { error: "The driver-signed copy failed an integrity check. Don't countersign; investigate first." };
    }

    const { ipAddress, userAgent } = await requestMeta();
    const id = randomUUID();
    const signedAt = new Date();
    const pdf = await appendCountersignCertificate(driverSigned, signaturePng, {
      countersignatureId: id,
      driverSignatureId: row.id,
      documentTitle: doc.title,
      signerName: signatory.name,
      signerTitle: signatory.title,
      signerEmail: me.email,
      driverSignedName: row.signed_name,
      signedAt,
      ipAddress,
      userAgent,
      agreementText: COUNTERSIGN_TEXT,
      inputSha256,
    });

    const owner = row.driver_id ?? "unknown";
    const pdfPath = `countersigned/${owner}/${id}.pdf`;
    const pngPath = `countersignatures/${owner}/${id}.png`;
    for (const [path, bytes, contentType] of [
      [pngPath, signaturePng, "image/png"],
      [pdfPath, pdf, "application/pdf"],
    ] as const) {
      const { error } = await db.storage.from(HR_BUCKET).upload(path, bytes, { contentType });
      if (error) throw new Error(`Couldn't store countersigned copy: ${error.message}`);
      uploaded.push(path);
    }

    // The unique constraint on signature_id stops a double countersign even
    // if two admins submit at the same moment.
    const { error } = await db.from("hr_countersignatures").insert({
      id,
      signature_id: row.id,
      signer_id: me.id,
      signer_email: me.email,
      signer_name: signatory.name,
      signer_title: signatory.title,
      agreement_text: COUNTERSIGN_TEXT,
      input_pdf_sha256: inputSha256,
      countersigned_pdf_path: pdfPath,
      countersigned_pdf_sha256: sha256Hex(pdf),
      signature_image_path: pngPath,
      ip_address: ipAddress,
      user_agent: userAgent,
      signed_at: signedAt.toISOString(),
    });
    if (error) {
      throw new Error(error.code === "23505" ? "Already countersigned." : error.message);
    }
    return { countersignatureId: id };
  } catch (e) {
    if (uploaded.length) await db.storage.from(HR_BUCKET).remove(uploaded);
    return { error: errorMessage(e) };
  }
}
