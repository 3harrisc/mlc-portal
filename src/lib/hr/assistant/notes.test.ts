import { describe, expect, it } from "vitest";
import { NOTES_MARKER, splitNotes } from "./notes";

describe("splitNotes", () => {
  it("separates the document from notes for MLC", () => {
    expect(splitNotes(`# Policy\n\nText\n${NOTES_MARKER}\n- Check the date`)).toEqual({
      document: "# Policy\n\nText",
      notes: "- Check the date",
    });
  });

  it("returns the whole output when there are no notes", () => {
    expect(splitNotes("  # Policy\nText  ")).toEqual({ document: "# Policy\nText", notes: "" });
  });
});
