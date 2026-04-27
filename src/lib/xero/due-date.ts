/**
 * Due-date calculator for Xero invoices.
 *
 * Ported verbatim from `XeroExport_FinalLogic.bas#CalculateDueDate`:
 *
 *   eom = endOfMonth(invoiceDate)
 *   dueDate = eom + dueDays days
 *
 * IMPORTANT: this is "n days after end-of-invoice-month", NOT "n days after
 * invoice date". A 30-day customer on a 1 Sep invoice is due 31 Oct, not
 * 1 Oct. Roughly net-60 in practice. Don't simplify it without checking
 * with finance first.
 *
 * Pure, side-effect-free, fully tested in `due-date.test.ts`.
 */

/** Format a Date as "yyyy-MM-dd" (UTC, ISO-style). */
export function toISODate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Format a Date or yyyy-MM-dd string as "dd/MM/yyyy" (Xero UK format). */
export function toXeroDate(input: Date | string): string {
  const d = typeof input === "string" ? parseISODate(input) : input;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Parse a yyyy-MM-dd string into a UTC Date at 00:00. */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid ISO date: ${s}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

/** Last day of the month containing `d`, in UTC. */
export function endOfMonth(d: Date): Date {
  // Day 0 of the next month = last day of this month.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/**
 * Xero due date = end-of-invoice-month + dueDays.
 *
 * @param invoiceDate Date or yyyy-MM-dd
 * @param dueDays     non-negative integer
 * @returns A Date (UTC midnight) representing the due date.
 */
export function calculateDueDate(invoiceDate: Date | string, dueDays: number): Date {
  if (!Number.isFinite(dueDays) || dueDays < 0 || !Number.isInteger(dueDays)) {
    throw new Error(`dueDays must be a non-negative integer (got ${dueDays})`);
  }
  const d = typeof invoiceDate === "string" ? parseISODate(invoiceDate) : invoiceDate;
  const eom = endOfMonth(d);
  const due = new Date(eom);
  due.setUTCDate(eom.getUTCDate() + dueDays);
  return due;
}
