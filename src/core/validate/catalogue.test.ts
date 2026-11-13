import { describe, expect, it } from "vitest";
import type { MaterialPreset } from "../schema/materials";
import { assetIndex, validateCatalogue, validateCatalogueFile, type CatalogueContext } from "./catalogue";

const presets = new Map<string, MaterialPreset>(
  ["wood.oak-natural", "wood.walnut", "fabric.linen-grey", "metal.black-matte"].map((id) => [id, { id, name: id, color: "#888888" }]),
);
const ctx: CatalogueContext = {
  presets,
  assets: assetIndex(["catalogue/stool/model.glb"]),
  ceilingHeight: 255,
};

const stool = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: "stool",
  name: "Stool",
  category: "seating",
  dimensions: { width: 40, depth: 40, height: 45 },
  placement: { type: "floor" },
  geometry: {
    type: "parametric",
    parts: [
      { name: "seat", shape: "cylinder", radius: 20, height: 4, position: { x: 0, y: 43, z: 0 }, material: "seat" },
      { name: "leg", shape: "cylinder", radius: 1.5, height: 41, position: { x: 14, y: 20.5, z: 14 }, mirror: ["x", "z"], material: "legs" },
    ],
  },
  materialSlots: {
    seat: { label: "Seat", default: "wood.oak-natural", allowed: ["wood.*"] },
    legs: { default: "metal.black-matte" },
  },
  ...patch,
});

const run = (value: unknown, file = "catalogue/stool.json") => validateCatalogueFile(file, JSON.stringify(value), ctx);
const messages = (r: ReturnType<typeof run>) => r.issues.map((i) => `${i.severity} ${i.path}: ${i.message}`);

describe("catalogue validation", () => {
  it("accepts a valid parametric item without issues", () => {
    const r = run(stool());
    expect(r.issues).toEqual([]);
    expect(r.item?.id).toBe("stool");
  });

  it("reports JSON syntax errors with line and column", () => {
    const r = validateCatalogueFile("catalogue/stool.json", '{\n  "id": "stool",\n  "name": }', ctx);
    expect(r.item).toBeUndefined();
    expect(r.issues[0].message).toMatch(/Invalid JSON \(line 3, column/);
  });

  it("reports schema errors with the property path", () => {
    const r = run(stool({ placement: { type: "wal" }, dimensions: { width: 40, depth: 0, height: 45 } }));
    expect(r.item).toBeUndefined();
    expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["placement.type", "dimensions.depth"]));
  });

  it("warns about unknown presets with a suggestion, and about defaults that are not allowed", () => {
    const r = run(stool({ materialSlots: { seat: { default: "wood.oak", allowed: ["wood.*"] }, legs: { default: "wood.walnut", allowed: ["metal.*"] } } }));
    expect(r.item).toBeDefined();
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^warning materialSlots.seat.default: unknown material preset "wood.oak" \(did you mean "wood.oak-natural"\?\)/),
        'warning materialSlots.legs.default: the default "wood.walnut" is not in "allowed"',
      ]),
    );
  });

  it("rejects parts that use an undefined slot and @original on parametric items", () => {
    const value = stool();
    (value.geometry as { parts: { material: string }[] }).parts[1].material = "leg";
    (value.materialSlots as Record<string, unknown>).seat = { default: "@original" };
    const r = run(value);
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^error geometry.parts\[1\].material: material slot "leg" is not defined/),
        'error materialSlots.seat.default: "@original" only works for 3D model items (geometry.type "model")',
      ]),
    );
  });

  it("warns when the parts are larger than the declared dimensions", () => {
    const r = run(stool({ dimensions: { width: 30, depth: 40, height: 45 } }));
    expect(messages(r)).toEqual([expect.stringMatching(/^warning geometry.parts: the parts extend beyond the declared dimensions: x from -20 to 20 \(width 30/)]);
  });

  it("lets the parts of onTop items hang below their bottom by hangsBelow, and no further", () => {
    // a cloth: a top 2 cm thick and a side hanging 20 cm below the surface it lies on
    const cloth = (placement: Record<string, unknown>) =>
      stool({
        dimensions: { width: 50, depth: 50, height: 2 },
        placement,
        geometry: {
          type: "parametric",
          parts: [
            { name: "top", shape: "box", size: { x: 50, y: 2, z: 50 }, position: { x: 0, y: 1, z: 0 }, material: "seat" },
            { name: "side", shape: "box", size: { x: 50, y: 20, z: 1 }, position: { x: 0, y: -10, z: 24.5 }, material: "legs" },
          ],
        },
      });
    expect(run(cloth({ type: "onTop", hangsBelow: 20 })).issues).toEqual([]);
    expect(messages(run(cloth({ type: "onTop", hangsBelow: 10 })))).toEqual([
      expect.stringMatching(/the parts extend beyond the declared dimensions: y from -20 to 2 \(height 2, hangsBelow 10: -10 to 2\)/),
    ]);
    expect(messages(run(cloth({ type: "onTop" })))).toEqual([expect.stringMatching(/y from -20 to 2 \(height 2: 0 to 2\)/)]);
    expect(run(cloth({ type: "floor", hangsBelow: 20 })).item).toBeUndefined();
  });

  it("warns when the file name and the id differ", () => {
    expect(messages(run(stool(), "catalogue/bar-stool.json"))).toEqual(['warning id: id "stool" does not match the file name "bar-stool"']);
    expect(run(stool(), "catalogue/stool/item.json").issues).toEqual([]);
  });

  it("checks that the model file of a GLB item exists", () => {
    const model = stool({
      geometry: { type: "model", src: "model.glb", materialMap: { Seat: "seat", Legs: "legs" } },
      materialSlots: { seat: { default: "@original", allowed: ["wood.*"] }, legs: { default: "metal.black-matte" } },
    });
    const ok = run(model, "catalogue/stool/item.json");
    expect(ok.issues).toEqual([]);
    expect(ok.modelPath).toBe("catalogue/stool/model.glb");
    expect(messages(run(model, "catalogue/other/item.json"))).toEqual(
      expect.arrayContaining(['error geometry.src: model file not found: catalogue/other/model.glb']),
    );
    const escape = { ...model, geometry: { type: "model", src: "../../src/x.glb" } };
    expect(messages(run(escape, "catalogue/stool/item.json"))[0]).toMatch(/points outside the catalogue folder/);
  });

  it("checks surfaces and wall heights", () => {
    const shelf = stool({
      placement: { type: "wall", defaultElevation: 230 },
      surfaces: [{ height: 45, width: 40, depth: 40, center: [5, 0] }],
    });
    expect(messages(run(shelf))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^warning surfaces\[0\]: the surface extends beyond the item's footprint/),
        expect.stringMatching(/^warning placement.defaultElevation: at its default elevation the item reaches 275 cm/),
      ]),
    );
  });

  it("skips invalid files and duplicate ids but keeps the rest", () => {
    const res = validateCatalogue(
      [
        { path: "catalogue/b/stool.json", text: JSON.stringify(stool()) },
        { path: "catalogue/a/stool.json", text: JSON.stringify(stool()) },
        { path: "catalogue/broken.json", text: "{" },
        { path: "catalogue/locked.json", error: "EBUSY" },
      ],
      ctx,
    );
    expect(res.items.map((i) => i.file)).toEqual(["catalogue/a/stool.json"]);
    expect(res.issues.map((i) => `${i.file}: ${i.message}`)).toEqual([
      'catalogue/b/stool.json: duplicate id "stool" (also used by catalogue/a/stool.json); this file is skipped',
      expect.stringMatching(/^catalogue\/broken.json: Invalid JSON/),
      "catalogue/locked.json: could not read the file: EBUSY",
    ]);
  });
});
