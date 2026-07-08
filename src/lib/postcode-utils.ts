export function normalizePostcode(input: string) {
  const s = (input || "").trim().toUpperCase();
  const noSpace = s.replace(/\s+/g, "");
  if (noSpace.length >= 5) {
    const head = noSpace.slice(0, -3);
    const tail = noSpace.slice(-3);
    return `${head} ${tail}`.trim();
  }
  return s;
}

export function extractPostcode(line: string): string | null {
  const m = line
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/);
  if (!m) return null;
  return normalizePostcode(`${m[1]} ${m[2]}`);
}

export function parseStops(rawText: string): string[] {
  const lines = (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const line of lines) {
    const pc = extractPostcode(line);
    if (pc) out.push(pc);
  }
  return out;
}

/**
 * Extract the booking/delivery time on a single raw_text line, e.g.
 * "GU11 2HL 12:30 REF:FC156297 ADDR:…" → "12:30".
 *
 * The time always sits right after the postcode, so we only scan the portion
 * before any REF:/ADDR: metadata — that keeps us from picking up a stray
 * "HH:MM"-shaped token inside a reference number or address. Returns a
 * zero-padded "HH:MM" (24hr) or null when the line carries no time.
 */
export function parseStopTime(line: string): string | null {
  const head = (line || "").split(/\bREF:|\bADDR:/i)[0];
  const m = head.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export interface StopWithTime {
  postcode: string;
  /** Booking/delivery time parsed from the same line, or null. */
  time: string | null;
}

/**
 * Like `parseStops`, but also pulls the booking time off each stop line.
 * Index-aligned with `parseStops` (both only emit a row when a postcode is
 * found), so `parseStopsWithTimes(x)[i].postcode === parseStops(x)[i]`.
 */
export function parseStopsWithTimes(rawText: string): StopWithTime[] {
  const lines = (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: StopWithTime[] = [];
  for (const line of lines) {
    const pc = extractPostcode(line);
    if (pc) out.push({ postcode: pc, time: parseStopTime(line) });
  }
  return out;
}
