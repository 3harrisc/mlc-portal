export type HrCategory = "contract" | "health_safety" | "policy" | "handbook" | "other";
export type HrAudience = "all" | "selected";
export type HrDocumentStatus = "draft" | "published" | "archived";

/** Where a driver stands on one document. Derived, never stored. */
export type SignStatus = "outstanding" | "signed" | "due_soon" | "expired";

export const HR_CATEGORIES: { value: HrCategory; label: string }[] = [
  { value: "contract", label: "Contract" },
  { value: "health_safety", label: "Health & safety" },
  { value: "policy", label: "Policy" },
  { value: "handbook", label: "Handbook" },
  { value: "other", label: "Other" },
];

export function categoryLabel(c: HrCategory): string {
  return HR_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";
}

/** The declaration a driver agrees to. Stored verbatim on each signature. */
export const AGREEMENT_TEXT =
  "I confirm that I have read and understood this document and agree to its terms. " +
  "I agree that my electronic signature is the legal equivalent of my handwritten signature.";

/** People who may countersign for MLC. The certificate records who signed. */
export const MLC_SIGNATORIES = [
  { name: "Callum Harris", title: "Transport Manager" },
  { name: "David Harris", title: "Company Director" },
] as const;

export type MlcSignatory = (typeof MLC_SIGNATORIES)[number];

/** The declaration an MLC signatory agrees to. Stored verbatim on each countersignature. */
export const COUNTERSIGN_TEXT =
  "I sign this document for and on behalf of MLC Transport Ltd and confirm that MLC Transport Ltd " +
  "agrees to its terms. I agree that my electronic signature is the legal equivalent of my " +
  "handwritten signature.";

export interface HrDocument {
  id: string;
  title: string;
  category: HrCategory;
  description: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileSha256: string;
  audience: HrAudience;
  resignMonths: number | null;
  status: HrDocumentStatus;
  requiresCountersign: boolean;
  createdAt: string;
  publishedAt: string | null;
}

export interface HrAssignment {
  documentId: string;
  driverId: string;
}

export interface HrSignature {
  id: string;
  documentId: string;
  driverId: string | null;
  signedName: string;
  signedAt: string;
  countersign: {
    signerName: string;
    signerTitle: string;
    signedAt: string;
  } | null;
}

export interface HrDriver {
  id: string;
  email: string;
  fullName: string | null;
  active: boolean;
}

/** One document from a driver's point of view. */
export interface DriverDocumentView {
  document: HrDocument;
  status: SignStatus;
  lastSignature: HrSignature | null;
  expiresAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function rowToHrDocument(r: any): HrDocument {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description ?? null,
    fileName: r.file_name ?? null,
    fileSize: r.file_size ?? null,
    fileSha256: r.file_sha256,
    audience: r.audience,
    resignMonths: r.resign_months ?? null,
    status: r.status,
    requiresCountersign: r.requires_countersign ?? false,
    createdAt: r.created_at,
    publishedAt: r.published_at ?? null,
  };
}

export function rowToHrSignature(r: any): HrSignature {
  // Embedded one-to-one relation: PostgREST may return an object or a 1-item array.
  const c = Array.isArray(r.hr_countersignatures) ? r.hr_countersignatures[0] : r.hr_countersignatures;
  return {
    id: r.id,
    documentId: r.document_id,
    driverId: r.driver_id ?? null,
    signedName: r.signed_name,
    signedAt: r.signed_at,
    countersign: c
      ? { signerName: c.signer_name, signerTitle: c.signer_title, signedAt: c.signed_at }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
