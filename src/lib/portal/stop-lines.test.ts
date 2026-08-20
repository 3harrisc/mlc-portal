/**
 * The structured stops editor round-trips raw_text through these two
 * functions. If serialise(parse(x)) loses ADDR: metadata, geocoding
 * silently degrades for every load that gets edited — so the preservation
 * cases below matter more than they look.
 */

import { describe, it, expect } from "vitest";
import { canRoundTrip, parseStopLines, serialiseStopLines } from "./stop-lines";

describe("parseStopLines", () => {
  it("splits a full line into its parts", () => {
    expect(parseStopLines("NG22 8TX 08:00-12:00 REF:FC156297 ADDR:Unit 4, Newark")).toEqual([
      {
        postcode: "NG22 8TX",
        from: "08:00",
        to: "12:00",
        ref: "FC156297",
        addr: "Unit 4, Newark",
      },
    ]);
  });

  it("treats a point booking as a window with no end", () => {
    expect(parseStopLines("BS20 7XN 14:00")).toEqual([
      { postcode: "BS20 7XN", from: "14:00", to: "", ref: "", addr: "" },
    ]);
  });

  it("skips lines with no postcode", () => {
    expect(parseStopLines("NG22 8TX\n\nnot a stop\nBS20 7XN")).toHaveLength(2);
  });
});

describe("serialiseStopLines", () => {
  it("writes a window as a range", () => {
    expect(
      serialiseStopLines([
        { postcode: "NG22 8TX", from: "08:00", to: "12:00", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX 08:00-12:00");
  });

  it("writes a point booking as a single time", () => {
    expect(
      serialiseStopLines([
        { postcode: "NG22 8TX", from: "08:00", to: "", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX 08:00");
  });

  it("drops an end time with no start — a window needs an opening", () => {
    expect(
      serialiseStopLines([
        { postcode: "NG22 8TX", from: "", to: "12:00", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX");
  });

  it("uppercases the postcode and drops blank rows", () => {
    expect(
      serialiseStopLines([
        { postcode: "ng22 8tx", from: "", to: "", ref: "", addr: "" },
        { postcode: "   ", from: "", to: "", ref: "", addr: "" },
      ]),
    ).toBe("NG22 8TX");
  });
});

describe("round trip", () => {
  it("preserves REF: and ADDR: through parse → serialise", () => {
    const raw = "NG22 8TX 08:00-12:00 REF:FC156297 ADDR:Unit 4, Newark";
    expect(serialiseStopLines(parseStopLines(raw))).toBe(raw);
  });

  it("preserves metadata across a reorder", () => {
    const raw = [
      "NG22 8TX 08:00-12:00 REF:A ADDR:First",
      "BS20 7XN 14:00 REF:B ADDR:Second",
    ].join("\n");
    const [a, b] = parseStopLines(raw);
    expect(serialiseStopLines([b, a])).toBe(
      ["BS20 7XN 14:00 REF:B ADDR:Second", "NG22 8TX 08:00-12:00 REF:A ADDR:First"].join("\n"),
    );
  });

  it("does not invent a ref from a REF: that appears inside the address", () => {
    const raw = "NG22 8TX 08:00-12:00 ADDR:Unit 4, REF:not-a-real-ref, Newark";
    expect(parseStopLines(raw)[0].ref).toBe("");
    expect(serialiseStopLines(parseStopLines(raw))).toBe(raw);
  });

  it("keeps a real ref when the address also contains REF:", () => {
    const raw = "NG22 8TX 08:00-12:00 REF:FC1 ADDR:Unit 4, REF:not-a-real, Newark";
    expect(parseStopLines(raw)[0].ref).toBe("FC1");
    expect(serialiseStopLines(parseStopLines(raw))).toBe(raw);
  });

  it("round-trips an address containing a colon", () => {
    const raw = "NG22 8TX 08:00-12:00 REF:FC1 ADDR:Gate 3: rear entrance";
    expect(serialiseStopLines(parseStopLines(raw))).toBe(raw);
  });

  it("round-trips a stop with no time but with ref and address", () => {
    const raw = "NG22 8TX REF:FC156297 ADDR:Unit 4, Newark";
    expect(serialiseStopLines(parseStopLines(raw))).toBe(raw);
  });
});

describe("canRoundTrip", () => {
  it("is true when every non-blank line yields a postcode", () => {
    expect(canRoundTrip("NG22 8TX 08:00\n\nBS20 7XN")).toBe(true);
  });

  it("is false when a line carries no postcode", () => {
    expect(canRoundTrip("NG22 8TX\nMiddleton Foods")).toBe(false);
  });

  it("is true for empty text", () => {
    expect(canRoundTrip("")).toBe(true);
  });
});
