import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doorGeometry, leafOutline } from "./apartment/doors";
import { pointInPolygon } from "./geometry/polygon";
import { emptyLayout, setDoorOpening } from "./layout/commands";
import { resolvePoses } from "./layout/poses";
import { ApartmentFile } from "./schema/apartment";
import { CatalogueItem } from "./schema/catalogue";
import type { LayoutFile } from "./schema/layout";
import { BODY_RADIUS, standClear, walkSolids, walkStart, walkStep } from "./walk";

const ap = ApartmentFile.parse(JSON.parse(readFileSync(new URL("../../data/apartment.json", import.meta.url), "utf8")));
const room = (id: string) => ap.rooms.find((r) => r.id === id)!.outline;

const block = CatalogueItem.parse({
  schemaVersion: 1,
  id: "block",
  name: "Block",
  category: "test",
  dimensions: { width: 60, depth: 60, height: 100 },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: [{ name: "body", shape: "box", size: { x: 60, y: 100, z: 60 }, position: { x: 0, y: 50, z: 0 }, material: "body" }] },
  materialSlots: { body: { default: "wood.oak-natural" } },
});
const rug = CatalogueItem.parse({ ...block, id: "rug", dimensions: { width: 200, depth: 200, height: 1 }, collision: "none" });
const lookup = (id: string) => (id === "block" ? block : id === "rug" ? rug : undefined);

function solids(doc: LayoutFile, furniture = true) {
  return walkSolids(ap, doc, lookup, resolvePoses(doc, lookup, ap.ceilingHeight), { furniture, eyeHeight: 160 });
}

describe("walking", () => {
  it("starts just inside the entrance door, looking down the entrée into the apartment", () => {
    const start = walkStart(ap);
    expect(pointInPolygon(start.position, room("entree"))).toBe(true);
    // the entrance is in the side of the entrée: straight in (+x) is a wall 80 cm away, along it (−z) the living room
    expect(start.facing[0]).toBeCloseTo(0, 6);
    expect(start.facing[1]).toBeCloseTo(-1, 6);
    const clear = standClear(start.position, solids(emptyLayout()));
    expect(Math.hypot(clear[0] - start.position[0], clear[1] - start.position[1])).toBeLessThan(0.01);
  });

  it("stops at walls and slides along them", () => {
    const s = solids(emptyLayout());
    const start = walkStart(ap).position;
    // the entrée / Zimmer 15.9 wall: face at x = 752.4 − 9, no door at this height of the plan
    const head = walkStep(start, [300, 0], s);
    expect(head[0]).toBeCloseTo(752.4 - 9 - BODY_RADIUS, 0);
    expect(Math.abs(head[1] - start[1])).toBeLessThan(2); // may slide a little at a joint between two walls
    // Zimmer 15.9, walking at its long west wall (face at x = 752.4 + 9) at an angle: you slide along it
    const slide = walkStep([800, 800], [-200, -100], s);
    expect(slide[0]).toBeCloseTo(752.4 + 9 + BODY_RADIUS, 0);
    expect(slide[1]).toBeCloseTo(700, 0);
  });

  it("goes through open doors only", () => {
    const from: [number, number] = [700, 610]; // in the entrée, level with the door to Zimmer 15.9
    const open = walkStep(from, [150, 0], solids(emptyLayout()));
    expect(open[0]).toBeGreaterThan(840);
    expect(pointInPolygon(open, room("zimmer-15-9"))).toBe(true);
    const closed = walkStep(from, [150, 0], solids(setDoorOpening(emptyLayout(), "d-entree-zimmer-15-9", 0)));
    expect(closed[0]).toBeLessThan(752.4 - 9);
    // a door left ajar is still in the way
    const ajar = walkStep(from, [150, 0], solids(setDoorOpening(emptyLayout(), "d-entree-zimmer-15-9", 20)));
    expect(ajar[0]).toBeLessThan(800);
  });

  it("bumps into furniture if asked to, but walks over rugs", () => {
    const from: [number, number] = [660, 700];
    const doc: LayoutFile = {
      ...emptyLayout(),
      items: [
        { uid: "block-1", item: "block", position: [660, 620], rotation: 0 },
        { uid: "rug-1", item: "rug", position: [660, 700], rotation: 0 },
      ],
    };
    expect(walkStep(from, [0, -100], solids(doc))[1]).toBeCloseTo(650 + BODY_RADIUS, 0);
    expect(walkStep(from, [0, -100], solids(doc, false))[1]).toBeCloseTo(600, 0);
  });

  it("steps out onto the round balconies and stops at their railings", () => {
    const s = solids(emptyLayout(), false);
    for (const id of ["balcony-n-railing", "balcony-se-railing"]) {
      const railing = ap.fixtures.find((f) => f.id === id)!;
      const rail = railing.parts.find((p) => p.name === "top rail");
      if (rail?.shape !== "lathe" || rail.arc === undefined) throw new Error(`${id}: expected a lathe top rail with an arc`);
      const inner = Math.min(...rail.profile.map(([r]) => r));
      const centre = railing.position;
      // the railing's circle is centred on the balcony: you can stand there
      const clear = standClear(centre, s);
      expect(Math.hypot(clear[0] - centre[0], clear[1] - centre[1]), id).toBeLessThan(0.01);
      // walking out to the middle of the railing, you stop at it (its 10° blocks bulge less than 0.4 cm inwards)
      const a = ((railing.rotation + (rail.rotation?.y ?? 0) + rail.arc / 2) * Math.PI) / 180;
      const stop = walkStep(centre, [300 * Math.cos(a), 300 * Math.sin(a)], s);
      const reach = Math.hypot(stop[0] - centre[0], stop[1] - centre[1]);
      expect(reach, id).toBeGreaterThan(inner - BODY_RADIUS - 0.5);
      expect(reach, id).toBeLessThan(inner - BODY_RADIUS + 0.1);
    }
  });
});

describe("door leaves", () => {
  it("turn about the hinge from closed (in the opening) to open (as on the plan)", () => {
    const o = ap.openings.find((x) => x.id === "d-entree-zimmer-15-9")!;
    const g = doorGeometry(o)!;
    const t = 18;
    const [leaf] = g.leaves;
    const closed = leafOutline(leaf, g, t, 0);
    // closed: along the wall, flush with the face it swings to (left, z = −9), 4 cm deep into the opening
    expect(closed[1][0]).toBeCloseTo(leaf.x + g.leafWidth, 6);
    expect(closed[1][1]).toBeCloseTo(-9, 6);
    expect(closed[3][1]).toBeCloseTo(-5, 6);
    const open = leafOutline(leaf, g, t, 90);
    expect(open[1][0]).toBeCloseTo(leaf.x, 6);
    expect(open[1][1]).toBeCloseTo(-9 - g.leafWidth, 6);
  });
});
