/** Browser-safe formatting helpers for HR screens and PDFs. */

/** 2026-10-01 -> "1 October 2026" (date-only, no timezone shift). */
export function ukDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
