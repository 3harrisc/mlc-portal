/**
 * AssetGo licence check: the shape the HR assistant extracts, plus pure
 * helpers to turn it into driver details, warnings and change lists.
 * Browser-safe (zod only) so the driver pages can use the same helpers.
 */
import { z } from "zod";

const date = z.string().nullable().describe("Date as YYYY-MM-DD, or null if blank or not shown");

export const LicenceCheckSchema = z.object({
  check_number: z.string().nullable().describe("AssetGo licence check number, e.g. 36366"),
  checked_on: date.describe("Date the check was carried out, YYYY-MM-DD"),
  surname: z.string(),
  forenames: z.string(),
  gender: z.string().nullable(),
  date_of_birth: date,
  address_lines: z.array(z.string()).describe("Address lines in order, excluding the postcode"),
  postcode: z.string().nullable(),
  licence_number: z.string().nullable(),
  issue_number: z.string().nullable(),
  licence_status: z.string().nullable().describe("e.g. VALID"),
  photocard_expiry: date,
  disqualified: z.boolean().nullable(),
  categories: z.array(
    z.object({
      code: z.string().describe("e.g. C, CE, B"),
      status: z.string().describe("e.g. Full or Provisional"),
      valid_from: date,
      valid_to: date,
      restriction_codes: z.array(z.string()).describe("Restriction codes such as 122; empty if none"),
    }),
  ),
  endorsements: z.array(
    z.object({
      offence_code: z.string(),
      description: z.string().nullable(),
      offence_date: date,
      conviction_date: date,
      expiry_date: date,
      points: z.number().int(),
    }),
  ),
  total_points: z.number().int(),
  tacho_card: z
    .object({ number: z.string().nullable(), status: z.string().nullable(), valid_from: date, expiry: date })
    .nullable(),
  cpc: z.object({ lgv_valid_to: date, pcv_valid_to: date }).nullable(),
});

export type LicenceCheck = z.infer<typeof LicenceCheckSchema>;

export interface LicenceFlag {
  level: "danger" | "warn" | "info";
  message: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** "HARRY ANDREW" -> "Harry Andrew"; keeps hyphen/apostrophe names right (O'Neil, Smith-Jones). */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();
}

/** Accept YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY; return YYYY-MM-DD or null. */
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

function daysUntil(iso: string | null, today: Date): number | null {
  const d = toIsoDate(iso);
  if (!d) return null;
  return Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY);
}

/** Driver record fields that come from a licence check (named as on the driver form). */
export function driverFieldsFromLicence(l: LicenceCheck) {
  return {
    firstNames: titleCase(l.forenames),
    surname: titleCase(l.surname),
    dateOfBirth: toIsoDate(l.date_of_birth),
    address: l.address_lines.map((a) => titleCase(a)).filter(Boolean).join(", "),
    postcode: l.postcode?.toUpperCase().trim() || null,
  };
}

export function hasFullCategory(l: LicenceCheck, code: string): boolean {
  return l.categories.some((c) => c.code.toUpperCase() === code && /full/i.test(c.status));
}

/** Things MLC should know about from a licence check, most serious first. */
export function licenceFlags(l: LicenceCheck, today = new Date()): LicenceFlag[] {
  const flags: LicenceFlag[] = [];
  const expiry = (label: string, iso: string | null) => {
    const days = daysUntil(iso, today);
    if (days == null) return;
    if (days < 0) flags.push({ level: "danger", message: `${label} expired on ${toIsoDate(iso)}` });
    else if (days <= 90) flags.push({ level: "warn", message: `${label} expires in ${days} days (${toIsoDate(iso)})` });
  };

  if (l.disqualified) flags.push({ level: "danger", message: "DVLA shows the driver as disqualified" });
  if (l.licence_status && !/^valid$/i.test(l.licence_status.trim())) {
    flags.push({ level: "danger", message: `Licence status is ${l.licence_status}` });
  }
  if (!hasFullCategory(l, "CE")) {
    flags.push({
      level: hasFullCategory(l, "C") ? "warn" : "danger",
      message: hasFullCategory(l, "C") ? "No full C+E entitlement (rigids only)" : "No full C or C+E entitlement",
    });
  }
  if (l.total_points > 0) {
    flags.push({
      level: l.total_points >= 6 ? "danger" : "warn",
      message: `${l.total_points} penalty point${l.total_points === 1 ? "" : "s"} on the licence`,
    });
  }
  expiry("Photocard", l.photocard_expiry);
  expiry("Driver CPC (LGV)", l.cpc?.lgv_valid_to ?? null);
  expiry("Tachograph card", l.tacho_card?.expiry ?? null);
  if (!l.cpc?.lgv_valid_to) flags.push({ level: "warn", message: "No LGV Driver CPC date shown" });
  if (!l.tacho_card?.number) flags.push({ level: "warn", message: "No tachograph card shown" });

  const ce = l.categories.find((c) => c.code.toUpperCase() === "CE" && /full/i.test(c.status));
  const ceDays = ce ? daysUntil(ce.valid_from, today) : null;
  if (ceDays != null && ceDays > -730) {
    flags.push({ level: "info", message: `C+E held for under 2 years (since ${toIsoDate(ce!.valid_from)}) - check insurer conditions` });
  }
  const order = { danger: 0, warn: 1, info: 2 };
  return flags.sort((a, b) => order[a.level] - order[b.level]);
}

/** What changed between the previous licence check and a new one. */
export function licenceChanges(prev: LicenceCheck | null, next: LicenceCheck): string[] {
  if (!prev) return [];
  const out: string[] = [];
  if (prev.total_points !== next.total_points) out.push(`Penalty points ${prev.total_points} -> ${next.total_points}`);
  const key = (e: LicenceCheck["endorsements"][number]) => `${e.offence_code}|${e.offence_date}`;
  const before = new Set(prev.endorsements.map(key));
  for (const e of next.endorsements) {
    if (!before.has(key(e))) out.push(`New endorsement ${e.offence_code} (${e.points} points, offence ${e.offence_date ?? "date unknown"})`);
  }
  if ((prev.licence_status ?? "") !== (next.licence_status ?? "")) out.push(`Licence status ${prev.licence_status} -> ${next.licence_status}`);
  if (!!prev.disqualified !== !!next.disqualified) out.push(next.disqualified ? "Now shown as disqualified" : "No longer disqualified");
  const cats = (l: LicenceCheck) => new Set(l.categories.filter((c) => /full/i.test(c.status)).map((c) => c.code.toUpperCase()));
  const [pc, nc] = [cats(prev), cats(next)];
  for (const c of nc) if (!pc.has(c)) out.push(`New full category ${c}`);
  for (const c of pc) if (!nc.has(c)) out.push(`Full category ${c} no longer shown`);
  if (prev.photocard_expiry !== next.photocard_expiry) out.push(`Photocard expiry ${prev.photocard_expiry} -> ${next.photocard_expiry}`);
  if (prev.cpc?.lgv_valid_to !== next.cpc?.lgv_valid_to) out.push(`CPC (LGV) valid to ${prev.cpc?.lgv_valid_to} -> ${next.cpc?.lgv_valid_to}`);
  if (prev.tacho_card?.number !== next.tacho_card?.number) out.push("Tachograph card number changed");
  if (prev.tacho_card?.expiry !== next.tacho_card?.expiry) out.push(`Tachograph card expiry ${prev.tacho_card?.expiry} -> ${next.tacho_card?.expiry}`);
  const addr = (l: LicenceCheck) => `${l.address_lines.join(", ")} ${l.postcode ?? ""}`.toUpperCase();
  if (addr(prev) !== addr(next)) out.push("Address on licence changed");
  return out;
}
