/**
 * The editable view of a raw_text stop list.
 *
 * `raw_text` is the storage format ("NG22 8TX 08:00-12:00 REF:… ADDR:…",
 * one stop per line) and stays the single source of truth. This module is
 * the bridge to a structured editor: parse lines into rows, let the UI edit
 * them, serialise straight back.
 *
 * The `addr` field is deliberately carried even though the editor never
 * shows it — the email parser writes it and the geocoder uses it to pin
 * locations more precisely than a postcode centroid can. Dropping it on
 * save would quietly degrade positioning for every edited load.
 */

import { extractPostcode, parseStopTime, parseStopWindow } from "@/lib/postcode-utils";

export interface StopLine {
  /** Normalised postcode, e.g. "NG22 8TX". */
  postcode: string;
  /** Window start, or the single booking time. "" when unset. */
  from: string;
  /** Window end. "" for a point booking. */
  to: string;
  /** Customer reference, "" when absent. */
  ref: string;
  /** Full address hint for the geocoder. Preserved, never surfaced. */
  addr: string;
}

function splitLines(rawText: string): string[] {
  return (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Pull a `REF:` / `ADDR:` value off a line. REF stops at ADDR; ADDR runs on. */
function readTag(line: string, tag: "REF" | "ADDR"): string {
  const re =
    tag === "REF" ? /\bREF:(.*?)(?=\s*\bADDR:|$)/i : /\bADDR:(.*)$/i;
  const m = line.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Parse raw_text into editable rows. Lines carrying no postcode are skipped
 * — call `canRoundTrip` first if you need to know whether that would lose
 * anything.
 */
export function parseStopLines(rawText: string): StopLine[] {
  const out: StopLine[] = [];
  for (const line of splitLines(rawText)) {
    const postcode = extractPostcode(line);
    if (!postcode) continue;
    const win = parseStopWindow(line);
    out.push({
      postcode,
      from: win?.from ?? parseStopTime(line) ?? "",
      to: win?.to ?? "",
      ref: readTag(line, "REF"),
      addr: readTag(line, "ADDR"),
    });
  }
  return out;
}

/**
 * Serialise rows back to raw_text. A row with a `to` but no `from` loses the
 * `to` — a window has to have an opening, and silently inventing one would
 * be worse than dropping it. The editor prevents this state anyway.
 */
export function serialiseStopLines(stops: StopLine[]): string {
  return stops
    .map((s) => {
      const postcode = s.postcode.trim().toUpperCase();
      if (!postcode) return "";
      const parts = [postcode];
      const from = s.from.trim();
      const to = s.to.trim();
      if (from && to) parts.push(`${from}-${to}`);
      else if (from) parts.push(from);
      if (s.ref.trim()) parts.push(`REF:${s.ref.trim()}`);
      if (s.addr.trim()) parts.push(`ADDR:${s.addr.trim()}`);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * True when every non-blank line yields a postcode, i.e. the structured
 * editor can represent this raw_text without losing a line. When false the
 * caller should fall back to plain textarea editing.
 */
export function canRoundTrip(rawText: string): boolean {
  return splitLines(rawText).every((l) => extractPostcode(l) !== null);
}
