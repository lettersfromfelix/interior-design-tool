import { describe, expect, it } from "vitest";
import { jsonErrorOffset, parseJson } from "./issues";

describe("JSON syntax errors", () => {
  const where = (text: string) => {
    const r = parseJson(text, "f.json");
    if (r.ok) throw new Error("expected an error");
    return /\(line (\d+), column (\d+)\)/.exec(r.issue.message)?.slice(1).map(Number);
  };

  it("finds the offending character", () => {
    expect(jsonErrorOffset('{"a": 1,}')).toBe(8);
    expect(jsonErrorOffset('{"a" 1}')).toBe(5);
    expect(jsonErrorOffset("[1, 2] x")).toBe(7);
    expect(jsonErrorOffset('{"a": "unclosed')).toBe(15);
    expect(jsonErrorOffset('{"a": [true, nul]}')).toBe(13);
    const valid = '{"a": {"b": [1, {"c": -0.5e3}]}}';
    expect(jsonErrorOffset(valid)).toBe(valid.length);
  });

  it("reports line and column, without the engine's excerpt", () => {
    expect(where('{\n  "id": "stool",\n  "name": }')).toEqual([3, 11]);
    expect(where('{\n  "a": 1,\n}')).toEqual([3, 1]);
    const r = parseJson('{ "a": }', "f.json");
    expect(!r.ok && r.issue.message).toMatch(/^Invalid JSON \(line 1, column 8\): Unexpected token '?}'?$/);
  });
});
