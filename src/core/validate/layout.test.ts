import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexApartment } from "../placement/apartment";
import { ApartmentFile } from "../schema/apartment";
import type { CatalogueItem } from "../schema/catalogue";
import { checkLayout, parseLayout } from "./layout";

const sofa = {
  id: "sofa",
  geometry: { type: "parametric", parts: [] },
  materialSlots: { upholstery: { default: "fabric.linen-grey", allowed: ["fabric.*"] } },
  surfaces: [],
} as unknown as CatalogueItem;
const presets = new Set(["fabric.linen-grey", "fabric.boucle-cream", "wood.walnut"]);
const file = "layouts/default.json";

describe("layout validation", () => {
  it("rejects bad JSON, schema errors and duplicate uids", () => {
    expect(parseLayout("{", file).issues[0].message).toMatch(/^Invalid JSON/);
    expect(parseLayout('{"schemaVersion":1,"name":"x","items":[{"uid":"a"}]}', file).issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["items[0].item", "items[0].position"]),
    );
    const dup = parseLayout(
      JSON.stringify({ schemaVersion: 1, name: "x", items: [0, 1].map(() => ({ uid: "a-1", item: "sofa", position: [0, 0], rotation: 0 })) }),
      file,
    );
    expect(dup.layout).toBeUndefined();
    expect(dup.issues[0].message).toBe('duplicate uid "a-1" (also items[0])');
  });

  it("warns about unknown items, unavailable materials and broken parents, keeping the data", () => {
    const { layout } = parseLayout(
      JSON.stringify({
        schemaVersion: 1,
        name: "x",
        items: [
          { uid: "ghost-1", item: "ghost", position: [0, 0], rotation: 0 },
          { uid: "sofa-1", item: "sofa", position: [0, 0], rotation: 0, materials: { upholstery: "wood.walnut", legs: "wood.walnut" } },
          { uid: "sofa-2", item: "sofa", position: [0, 0], rotation: 0, parent: { uid: "sofa-1", surface: 0 } },
        ],
      }),
      file,
    );
    const issues = checkLayout(layout!, file, (id) => (id === "sofa" ? sofa : undefined), presets);
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'items[0].item: unknown catalogue item "ghost" (ghost-1)',
      'items[1].materials.upholstery: "wood.walnut" is not available for this slot; the default "fabric.linen-grey" is used',
      'items[1].materials.legs: "sofa" has no material slot "legs"',
      "items[2].parent: sofa-2: the base item has no surface with this index; it is placed on its own",
    ]);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("warns about doors the apartment doesn't have or that don't open that far", () => {
    const ap = ApartmentFile.parse(JSON.parse(readFileSync(new URL("../../../data/apartment.json", import.meta.url), "utf8")));
    const full = [...indexApartment(ap).doors].find(([, r]) => r.max === 180)![0];
    const { layout } = parseLayout(
      JSON.stringify({ schemaVersion: 1, name: "x", items: [], doors: { [full]: 180, "d-living-balcony-n": 120, "d-nowhere": 0 } }),
      file,
    );
    expect(checkLayout(layout!, file, () => undefined, presets, ap).map((i) => `${i.path}: ${i.message}`)).toEqual([
      "doors.d-living-balcony-n: the door opens at most 90°; it is shown 90° open",
      'doors.d-nowhere: there is no door "d-nowhere" in data/apartment.json; the entry is ignored',
    ]);
    expect(parseLayout(JSON.stringify({ schemaVersion: 1, name: "x", items: [], doors: { [full]: 181 } }), file).layout).toBeUndefined();
  });
});
