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

/** `HH:MM` in 24hr, hour optionally unpadded. Capturing: hour, minute. */
const TIME_SRC = String.raw`([01]?\d|2[0-3]):([0-5]\d)`;

/** A range: two times joined by a hyphen / en-dash / em-dash. */
const WINDOW_RE = new RegExp(String.raw`\b${TIME_SRC}\s*[-–—]\s*${TIME_SRC}\b`);

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

export interface StopWindow {
  /** Start of the window, "HH:MM". Also what `parseStopTime` returns. */
  from: string;
  /** End of the window, "HH:MM". */
  to: string;
}

/**
 * Extract a delivery window from a raw_text stop line, e.g.
 * "NG22 8TX 08:00-12:00 REF:FC1" → { from: "08:00", to: "12:00" }.
 *
 * Like `parseStopTime`, only the portion of the line BEFORE any REF:/ADDR:
 * marker is scanned, so a hyphenated reference or a time-shaped fragment
 * inside an address can never be mistaken for a window.
 *
 * Returns null when the line carries a single time or no time at all — a
 * malformed range (e.g. "08:00-25:00") also degrades to null, and
 * `parseStopTime` still picks up the valid leading "08:00".
 */
export function parseStopWindow(line: string): StopWindow | null {
  const head = (line || "").split(/\bREF:|\bADDR:/i)[0];
  const m = head.match(WINDOW_RE);
  if (!m) return null;
  return {
    from: `${m[1].padStart(2, "0")}:${m[2]}`,
    to: `${m[3].padStart(2, "0")}:${m[4]}`,
  };
}

export interface StopWithTime {
  postcode: string;
  /** Booking/delivery time parsed from the same line, or null. For a
   *  windowed stop this is the window START. */
  time: string | null;
  /** End of the delivery window when the line carries a range, else null. */
  windowEnd: string | null;
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
    if (pc) {
      const win = parseStopWindow(line);
      out.push({
        postcode: pc,
        time: win?.from ?? parseStopTime(line),
        windowEnd: win?.to ?? null,
      });
    }
  }
  return out;
}
