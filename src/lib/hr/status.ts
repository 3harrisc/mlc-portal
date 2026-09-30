import type {
  DriverDocumentView,
  HrAssignment,
  HrDocument,
  HrSignature,
  SignStatus,
} from "@/types/hr";

/** Days before a re-sign deadline that a signature counts as "due soon". */
export const DUE_SOON_DAYS = 30;

/**
 * Add calendar months, clamping to the last day of the target month so
 * 31 Jan + 1 month is 28/29 Feb rather than rolling into March.
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function signStatus(
  resignMonths: number | null,
  lastSignedAt: string | null,
  now: Date,
): { status: SignStatus; expiresAt: string | null } {
  if (!lastSignedAt) return { status: "outstanding", expiresAt: null };
  if (!resignMonths) return { status: "signed", expiresAt: null };

  const expires = addMonths(new Date(lastSignedAt), resignMonths);
  const expiresAt = expires.toISOString();
  if (now.getTime() >= expires.getTime()) return { status: "expired", expiresAt };
  const dueSoonFrom = expires.getTime() - DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() >= dueSoonFrom) return { status: "due_soon", expiresAt };
  return { status: "signed", expiresAt };
}

/** Whether a driver has to sign this document at all. */
export function appliesToDriver(
  doc: HrDocument,
  driverId: string,
  assignments: HrAssignment[],
): boolean {
  if (doc.status !== "published") return false;
  if (doc.audience === "all") return true;
  return assignments.some((a) => a.documentId === doc.id && a.driverId === driverId);
}

/** Most recent signature per `${driverId}:${documentId}`. */
export function latestSignatures(signatures: HrSignature[]): Map<string, HrSignature> {
  const out = new Map<string, HrSignature>();
  for (const s of signatures) {
    if (!s.driverId) continue;
    const key = `${s.driverId}:${s.documentId}`;
    const prev = out.get(key);
    if (!prev || s.signedAt > prev.signedAt) out.set(key, s);
  }
  return out;
}

/** Every document a driver has to sign, with where they stand on each. */
export function driverDocumentViews(
  driverId: string,
  docs: HrDocument[],
  assignments: HrAssignment[],
  signatures: HrSignature[],
  now: Date,
): DriverDocumentView[] {
  const latest = latestSignatures(signatures);
  return docs
    .filter((d) => appliesToDriver(d, driverId, assignments))
    .map((document) => {
      const lastSignature = latest.get(`${driverId}:${document.id}`) ?? null;
      const { status, expiresAt } = signStatus(
        document.resignMonths,
        lastSignature?.signedAt ?? null,
        now,
      );
      return { document, status, lastSignature, expiresAt };
    });
}

/** A signature is needed when nothing is on file or the last one lapsed. */
export function needsSignature(status: SignStatus): boolean {
  return status === "outstanding" || status === "expired" || status === "due_soon";
}

/** Sort order for driver-facing lists: most urgent first. */
export const STATUS_PRIORITY: Record<SignStatus, number> = {
  expired: 0,
  outstanding: 1,
  due_soon: 2,
  signed: 3,
};
