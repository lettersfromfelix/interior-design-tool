import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./buildSnapshot";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const files = [
  { path: "data/apartment.json", text: read("data/apartment.json") },
  { path: "data/materials.json", text: read("data/materials.json") },
];

describe("buildSnapshot", () => {
  it("knows whether the underlay image is there (it is local only)", () => {
    const image = buildSnapshot(files, 1).apartment?.underlay?.image;
    expect(image).toBeDefined();
    expect(buildSnapshot(files, 1).underlayAvailable).toBe(false);
    expect(buildSnapshot(files, 1, [{ path: image!, size: 1, mtime: 1 }]).underlayAvailable).toBe(true);
  });
});
