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
