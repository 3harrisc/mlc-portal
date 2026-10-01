/** Browser-safe pieces of the HR assistant protocol. */

export const NOTES_MARKER = "===NOTES===";

export type AssistantMode = "draft" | "revise" | "review";

/** Split a draft/revise response into the document and the notes for MLC. */
export function splitNotes(output: string): { document: string; notes: string } {
  const i = output.indexOf(NOTES_MARKER);
  if (i < 0) return { document: output.trim(), notes: "" };
  return { document: output.slice(0, i).trim(), notes: output.slice(i + NOTES_MARKER.length).trim() };
}
