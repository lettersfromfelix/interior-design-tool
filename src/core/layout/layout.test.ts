import { describe, expect, it } from "vitest";
import type { CatalogueItem } from "../schema/catalogue";
import type { LayoutFile, PlacedItem } from "../schema/layout";
import {
  addItem,
  duplicateItem,
  emptyLayout,
  moveItem,
  nextUid,
  normalizeRotation,
  removeItem,
  rotateItem,
  setElevation,
  setFlag,
  setSlotMaterial,
} from "./commands";
import { baseElevation, descendants, resolvePoses, rotatePlan } from "./poses";
import { formatJson, serializeLayout } from "./serialize";

const place = (uid: string, item: string, extra: Partial<PlacedItem> = {}): PlacedItem => ({ uid, item, position: [100, 200], rotation: 0, ...extra });

const sideboard = {
  id: "sideboard",
  dimensions: { width: 180, depth: 45, height: 75 },
  placement: { type: "floor" },
  surfaces: [{ height: 75, width: 176, depth: 41 }],
} as unknown as CatalogueItem;
const lamp = { id: "lamp", dimensions: { width: 25, depth: 25, height: 40 }, placement: { type: "onTop" } } as unknown as CatalogueItem;
const shelf = { id: "shelf", dimensions: { width: 80, depth: 20, height: 3 }, placement: { type: "wall", defaultElevation: 140 } } as unknown as CatalogueItem;
const pendant = { id: "pendant", dimensions: { width: 40, depth: 40, height: 60 }, placement: { type: "ceiling" } } as unknown as CatalogueItem;
const items = new Map([sideboard, lamp, shelf, pendant].map((i) => [i.id, i]));
const lookup = (id: string) => items.get(id);

describe("layout commands", () => {
  const doc: LayoutFile = { ...emptyLayout(), items: [place("sideboard-1", "sideboard"), place("lamp-1", "lamp", { parent: { uid: "sideboard-1", surface: 0 }, position: [-60, 0] })] };

  it("numbers new uids per catalogue item", () => {
    expect(nextUid(doc, "sideboard")).toBe("sideboard-2");
    expect(nextUid(doc, "stool")).toBe("stool-1");
    expect(nextUid(doc, "sideboard", new Set(["sideboard-2"]))).toBe("sideboard-3");
  });

  it("returns the same document when nothing changes", () => {
    expect(moveItem(doc, "sideboard-1", [100, 200])).toBe(doc);
    expect(rotateItem(doc, "sideboard-1", 360)).toBe(doc);
    expect(moveItem(doc, "nope", [1, 2])).toBe(doc);
    expect(setFlag(doc, "sideboard-1", "locked", false)).toBe(doc);
  });

  it("rounds positions and normalises rotations", () => {
    const next = rotateItem(moveItem(doc, "sideboard-1", [12.345, -0.04]), "sideboard-1", -15);
    expect(next.items[0]).toMatchObject({ position: [12.3, 0], rotation: 345 });
    expect(normalizeRotation(-0.01)).toBe(0);
    expect(normalizeRotation(719.96)).toBe(0);
    expect(doc.items[0].position).toEqual([100, 200]); // the original is untouched
  });

  it("adds, removes (with what stands on it) and duplicates (with new uids)", () => {
    const added = addItem(doc, place("shelf-1", "shelf", { rotation: 450 }));
    expect(added.items.at(-1)).toMatchObject({ uid: "shelf-1", rotation: 90 });
    expect(descendants(doc, "sideboard-1")).toEqual(["lamp-1"]);
    expect(removeItem(doc, "sideboard-1").items).toEqual([]);
    const dup = duplicateItem(setFlag(doc, "sideboard-1", "locked", true), "sideboard-1", "sideboard-2", [20, 20]);
    expect(dup.items.slice(2)).toEqual([
      { uid: "sideboard-2", item: "sideboard", position: [120, 220], rotation: 0 },
      { uid: "lamp-2", item: "lamp", position: [-60, 0], rotation: 0, parent: { uid: "sideboard-2", surface: 0 } },
    ]);
  });

  it("sets and resets materials, elevation and flags", () => {
    let next = setSlotMaterial(doc, "sideboard-1", "body", "wood.walnut");
    expect(next.items[0].materials).toEqual({ body: "wood.walnut" });
    next = setSlotMaterial(next, "sideboard-1", "body", undefined);
    expect(next.items[0]).not.toHaveProperty("materials");
    next = setElevation(next, "sideboard-1", 149.96);
    expect(next.items[0].elevation).toBe(150);
    expect(setElevation(next, "sideboard-1", undefined).items[0]).not.toHaveProperty("elevation");
    expect(setFlag(next, "sideboard-1", "hidden", true).items[0].hidden).toBe(true);
  });
});

describe("world poses", () => {
  it("rotates plan vectors clockwise seen from above", () => {
    const [x, z] = rotatePlan([10, 0], 90);
    expect(x).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(10, 9);
  });

  it("derives elevations from the placement type", () => {
    expect(baseElevation(sideboard, {}, 255)).toBe(0);
    expect(baseElevation(shelf, {}, 255)).toBe(140);
    expect(baseElevation(shelf, { elevation: 120 }, 255)).toBe(120);
    expect(baseElevation(pendant, {}, 255)).toBe(195);
    expect(baseElevation(lamp, {}, 255)).toBe(0);
    expect(baseElevation(undefined, {}, 255)).toBe(0);
  });

  it("places children on their base item's surface, following its rotation", () => {
    const doc: LayoutFile = {
      ...emptyLayout(),
      items: [place("sb", "sideboard", { position: [500, 300], rotation: 90 }), place("l", "lamp", { parent: { uid: "sb", surface: 0 }, position: [-60, 0], rotation: 10 })],
    };
    const poses = resolvePoses(doc, lookup, 255);
    const l = poses.get("l")!;
    expect(l.x).toBeCloseTo(500, 9);
    expect(l.z).toBeCloseTo(240, 9);
    expect(l).toMatchObject({ y: 75, rotation: 100 });
    // dragging the base moves the child
    const moved = resolvePoses(doc, lookup, 255, new Map([["sb", { position: [600, 300] as [number, number] }]]));
    expect(moved.get("l")!.x).toBeCloseTo(600, 9);
  });

  it("places items with a broken parent on their own", () => {
    const doc: LayoutFile = {
      ...emptyLayout(),
      items: [
        place("a", "lamp", { parent: { uid: "b", surface: 0 }, position: [1, 2] }),
        place("b", "lamp", { parent: { uid: "a", surface: 0 }, position: [3, 4] }),
        place("c", "lamp", { parent: { uid: "missing", surface: 0 }, position: [5, 6] }),
      ],
    };
    const poses = resolvePoses(doc, lookup, 255);
    expect([...poses.values()].map((p) => [p.x, p.z, p.y])).toEqual([[1, 2, 0], [3, 4, 0], [5, 6, 0]]);
  });
});

describe("layout files", () => {
  it("keeps short objects on one line and orders keys", () => {
    expect(formatJson({ b: [1, 2], a: { c: true } })).toBe('{\n  "b": [1, 2],\n  "a": { "c": true }\n}');
    const doc: LayoutFile = {
      ...emptyLayout("Variant A"),
      items: [
        { rotation: 90.04, position: [412.54, 300], item: "sofa", uid: "sofa-1" },
        { uid: "sofa-2", item: "sofa", position: [0, 0], rotation: 0, materials: { upholstery: "fabric.linen-grey", legs: "wood.walnut-oiled" } },
      ],
    };
    expect(serializeLayout(doc, "2026-11-20T18:04:11.000Z")).toBe(
      [
        "{",
        '  "$schema": "../schemas/layout.schema.json",',
        '  "schemaVersion": 1,',
        '  "name": "Variant A",',
        '  "updatedAt": "2026-11-20T18:04:11.000Z",',
        '  "items": [',
        '    { "uid": "sofa-1", "item": "sofa", "position": [412.5, 300], "rotation": 90 },',
        "    {",
        '      "uid": "sofa-2",',
        '      "item": "sofa",',
        '      "position": [0, 0],',
        '      "rotation": 0,',
        '      "materials": { "upholstery": "fabric.linen-grey", "legs": "wood.walnut-oiled" }',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("round-trips through JSON", () => {
    const doc: LayoutFile = { ...emptyLayout(), items: [place("a-1", "a", { label: "Long label ".repeat(20), hidden: true })] };
    expect(JSON.parse(serializeLayout(doc))).toEqual(doc);
  });
});
