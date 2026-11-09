import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateApartment } from "./apartment";
import { validateMaterials } from "./materials";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("data/apartment.json", () => {
  const mats = validateMaterials(read("data/materials.json"));
  const res = validateApartment(read("data/apartment.json"), mats.byId);

  it("has valid materials", () => {
    expect(mats.issues).toEqual([]);
  });

  it("passes schema and semantic validation without errors", () => {
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(res.apartment).toBeDefined();
  });

  it("reproduces every printed room area within ±1.5 %", () => {
    expect(res.areaChecks.length).toBe(5);
    for (const c of res.areaChecks) expect(Math.abs(c.deviation), c.name).toBeLessThanOrEqual(0.015);
  });

  it("models the expected elements", () => {
    const ap = res.apartment!;
    expect(ap.ceilingHeight).toBe(255);
    expect(ap.rooms.filter((r) => r.kind === "balcony")).toHaveLength(2);
    expect(ap.openings.filter((o) => o.kind === "door")).toHaveLength(10);
    expect(ap.openings.filter((o) => o.door?.isEntrance)).toHaveLength(1);
    const ids = ap.fixtures.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["kitchen", "built-in-wardrobe", "column"]));
    expect(ap.checks?.length).toBeGreaterThanOrEqual(30);
  });

  it("flags every value that is not read directly from the plan", () => {
    const ap = res.apartment!;
    for (const o of ap.openings) {
      expect(o.provenance.fields?.height?.confidence, o.id).toBe("low");
    }
  });
});

describe("validateApartment", () => {
  const base = JSON.parse(read("data/apartment.json"));
  const mats = validateMaterials(read("data/materials.json")).byId;

  it("reports invalid JSON with line and column", () => {
    const res = validateApartment('{\n  "a": 1,\n  oops\n}', mats);
    expect(res.issues[0].message).toMatch(/line 3/);
  });

  it("reports an opening that does not fit into its wall", () => {
    const bad = structuredClone(base);
    bad.openings[0].centerFromStart = 10_000;
    const res = validateApartment(JSON.stringify(bad), mats);
    expect(res.issues.some((i) => i.severity === "error" && /does not fit/.test(i.message))).toBe(true);
  });

  it("reports unknown material presets with a hint", () => {
    const bad = structuredClone(base);
    bad.defaults.wallMaterial = "paint.does-not-exist";
    const res = validateApartment(JSON.stringify(bad), mats);
    const found = res.issues.find((i) => i.path === "defaults.wallMaterial");
    expect(found?.hint).toMatch(/paint\./);
  });

  it("reports duplicate ids and unknown keys", () => {
    const bad = structuredClone(base);
    bad.walls[1].id = bad.walls[0].id;
    expect(validateApartment(JSON.stringify(bad), mats).issues.some((i) => /duplicate id/.test(i.message))).toBe(true);
    const typo = structuredClone(base);
    typo.walls[0].thicknes = 3;
    expect(validateApartment(JSON.stringify(typo), mats).issues[0].message).toMatch(/thicknes/);
  });
});
