/**
 * ISO 8601 week number / week-year helpers.
 *
 * Ported from the Master Planner spreadsheet's WeekUtils.bas
 * (`ISOWeekNumSafe`, `ISOYear`, `ISOWeeksInYear`).
 *
 * Pure, side-effect-free, tested in `iso-week.test.ts`.
 */

/**
 * ISO 8601 week number (1..53). The week containing the year's first
 * Thursday is week 1.
 */
export function isoWeekNum(d: Date): number {
  // Copy to UTC to avoid local-time DST drift around midnight.
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Shift to the Thursday of the same ISO week.
  const day = utc.getUTCDay() || 7; // Sunday → 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  // Day-of-year of that Thursday tells us which week we're in.
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  const diffMs = utc.getTime() - yearStart;
  const dayOfYear = Math.floor(diffMs / 86_400_000) + 1;
  return Math.ceil(dayOfYear / 7);
}

/**
 * The ISO week-numbering year. Differs from the calendar year for the first
 * few days of January and the last few of December when those days belong to
 * the adjacent year's ISO week.
 */
export function isoYear(d: Date): number {
  const wn = isoWeekNum(d);
  const calendarYear = d.getFullYear();
  const month = d.getMonth(); // 0..11
  if (month === 0 && wn >= 52) return calendarYear - 1;
  if (month === 11 && wn === 1) return calendarYear + 1;
  return calendarYear;
}

/** Total number of ISO weeks in a given year (52 or 53). */
export function isoWeeksInYear(year: number): number {
  // A year has 53 weeks iff Jan 1 is a Thursday, or it's a leap year and
  // Jan 1 is a Wednesday.
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const day = jan1.getUTCDay() || 7;
  const isLeap =
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (day === 4) return 53;
  if (day === 3 && isLeap) return 53;
  return 52;
}

/**
 * Returns a YYYY-MM-DD string for the Monday of a given ISO week.
 */
export function isoWeekMonday(year: number, week: number): string {
  // Jan 4th is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format an ISO week reference: "Week 39 (2025)".
 * Used as the default Reference field on Xero invoices when a per-line
 * load reference is not present. Matches the legacy VBA's
 * `referenceText` value.
 */
export function isoWeekReference(year: number, week: number): string {
  return `Week ${week} (${year})`;
}
