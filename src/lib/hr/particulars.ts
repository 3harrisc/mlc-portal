/** Validation for Schedule of Particulars details. Throws driver/admin-readable messages. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Driver-entered name and address, tidied. */
export function cleanDriverDetails(legalName: unknown, address: unknown): { legalName: string; address: string } {
  const name = String(legalName ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) throw new Error("Please enter your full legal name.");
  const addr = String(address ?? "")
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  if (addr.length < 8 || addr.length > 300) throw new Error("Please enter your full home address, including postcode.");
  return { legalName: name, address: addr };
}

/** MLC-entered dates. Continuous employment defaults to the start date and can't be later than it. */
export function cleanEmploymentDates(
  startDate: unknown,
  continuousDate: unknown,
): { startDate: string; continuousDate: string } {
  const start = String(startDate ?? "");
  if (!isRealDate(start)) throw new Error("Enter a valid start date.");
  const cont = continuousDate ? String(continuousDate) : start;
  if (!isRealDate(cont)) throw new Error("Enter a valid continuous employment date.");
  if (cont > start) throw new Error("Continuous employment date can't be after the start date.");
  return { startDate: start, continuousDate: cont };
}
