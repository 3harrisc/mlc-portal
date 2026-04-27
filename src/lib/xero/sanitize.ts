/**
 * CSV-safe text sanitisation.
 *
 * Ported from `XeroExport_FinalLogic.bas#SanitizeForCsv` and `CsvQuote`.
 *
 * Xero rejects CSVs containing certain characters, and the planner's daily
 * sheets accumulate Unicode noise (smart quotes from copy-paste, em-dashes
 * from auto-correct, → arrows, NBSPs from web pastes). We replace the known
 * offenders with ASCII equivalents, then drop anything outside printable
 * ASCII 32–126.
 *
 * Pure, side-effect-free, fully tested in `sanitize.test.ts`.
 */

const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  // En-dash / em-dash / minus → hyphen.
  [/[–—−]/g, "-"],
  // Bullet → asterisk.
  [/[•]/g, "*"],
  // Arrows → ASCII arrows.
  [/[→]/g, "->"],
  [/[←]/g, "<-"],
  [/[↔]/g, "<->"],
  // Smart double quotes → ".
  [/[“”]/g, '"'],
  // Smart single quotes → '.
  [/[‘’]/g, "'"],
  // Non-breaking space → space.
  [/ /g, " "],
];

/**
 * Replace common Unicode noise with ASCII equivalents and drop anything
 * outside printable ASCII (codepoints 32–126).
 */
export function sanitizeForCsv(input: string): string {
  if (input == null) return "";
  let s = String(input);
  for (const [pattern, replacement] of REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  // Filter to printable ASCII.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 32 && code <= 126) out += s.charAt(i);
  }
  return out;
}

/**
 * Quote a value for a CSV cell. Escapes embedded double-quotes by doubling
 * them, then wraps the whole thing in double-quotes.
 */
export function csvQuote(input: string): string {
  const safe = sanitizeForCsv(input);
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Format a number as a CSV-safe decimal string with two decimals. */
export function formatCsvAmount(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  // Use a fixed decimal point regardless of locale.
  return n.toFixed(2);
}
