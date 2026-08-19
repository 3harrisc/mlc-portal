/**
 * Pull the JSON object out of a Claude completion.
 *
 * The prompt asks for bare JSON, but the model regularly wraps it in a ```json
 * fence and — the case that quietly dropped inbound load emails through June —
 * follows the *closing* fence with a sentence explaining itself. The old
 * stripper only peeled a leading fence and a trailing one anchored at the end
 * of the string, so that explanation stayed attached, JSON.parse threw, and the
 * email was logged as "Parse failed" and lost.
 *
 * Try the cheap shapes first and fall back to scanning:
 *   1. the whole response parses          — the prompt was obeyed
 *   2. the first fenced block parses      — fenced, with or without prose around it
 *   3. the first balanced {...} run parses — unfenced object buried in prose
 *
 * A truncated response (max_tokens) matches none of these and still throws, so
 * a half-written run is never silently accepted.
 */
export function extractJsonObject(raw: string): unknown {
  const text = (raw ?? "").trim();
  if (!text) throw new Error("Claude returned an empty response");

  const candidates = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const balanced = firstBalancedObject(text);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }

  throw new Error(
    `Failed to parse Claude response as JSON: ${text.slice(0, 200)}`
  );
}

/**
 * The first brace-balanced run in the string, or null if there isn't one.
 * Braces and quotes inside string values are ignored, so a note like
 * "call the {gate} on arrival" doesn't throw the depth count off.
 */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }

  return null;
}
