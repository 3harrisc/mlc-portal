import { describe, it, expect } from "vitest";
import { extractJsonObject } from "./claude-json";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"runs":[{"name":"Tamworth Load 1"}]}')).toEqual({
      runs: [{ name: "Tamworth Load 1" }],
    });
  });

  it("parses a fenced JSON block", () => {
    const text = '```json\n{\n  "runs": []\n}\n```';
    expect(extractJsonObject(text)).toEqual({ runs: [] });
  });

  it("parses a fenced block followed by prose", () => {
    // Verbatim shape of the response that failed in production on 2026-06-29:
    // the fence closes, then Claude explains itself, so stripping a *trailing*
    // fence left the prose attached and JSON.parse threw.
    const text = [
      "```json",
      "{",
      '  "runs": []',
      "}",
      "```",
      "",
      "The email indicates that load SD5701860 has been cancelled, so there is",
      "no run to create.",
    ].join("\n");
    expect(extractJsonObject(text)).toEqual({ runs: [] });
  });

  it("parses a fenced block preceded by prose", () => {
    const text = 'Here is the parsed load:\n\n```json\n{"runs":[{"name":"Portbury"}]}\n```';
    expect(extractJsonObject(text)).toEqual({ runs: [{ name: "Portbury" }] });
  });

  it("parses an unfenced object surrounded by prose", () => {
    const text = 'Sure thing:\n{"runs":[]}\nHope that helps.';
    expect(extractJsonObject(text)).toEqual({ runs: [] });
  });

  it("keeps braces that live inside string values", () => {
    const text = '```json\n{"runs":[{"notes":"call the {gate} on arrival"}]}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({
      runs: [{ notes: "call the {gate} on arrival" }],
    });
  });

  it("keeps escaped quotes inside string values", () => {
    const text = '{"runs":[{"notes":"driver said \\"no access\\" here"}]} and that is all';
    expect(extractJsonObject(text)).toEqual({
      runs: [{ notes: 'driver said "no access" here' }],
    });
  });

  it("throws with a preview when there is no JSON at all", () => {
    expect(() => extractJsonObject("I could not find any loads in this email.")).toThrow(
      /Failed to parse Claude response as JSON: I could not find/
    );
  });

  it("throws when the object is truncated mid-way", () => {
    // max_tokens cut the response off — better to fail loudly than half-parse.
    expect(() => extractJsonObject('```json\n{"runs":[{"name":"Tamw')).toThrow(
      /Failed to parse Claude response as JSON/
    );
  });

  it("throws on an empty response", () => {
    expect(() => extractJsonObject("   ")).toThrow(/empty response/);
  });
});
