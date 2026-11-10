import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partFootprints } from "../catalogue/bounds";
import { convexHull, insideConvex, overlapDepth, pushCircleOut, rayToPolygon } from "../geometry/convex";
import { area } from "../geometry/polygon";
import { emptyLayout, setPlacement, setRotation } from "../layout/commands";
import { resolvePoses } from "../layout/poses";
import { ApartmentFile } from "../schema/apartment";
import { CatalogueItem } from "../schema/catalogue";
import type { Vec2 } from "../schema/common";
import type { LayoutFile, PlacedItem } from "../schema/layout";
import { DEFAULT_AIDS, readAids, rotationStep, type Aids } from "./aids";
import { doorSwings, indexApartment, leafSolid } from "./apartment";
import { clearanceZones, layoutConflicts, solidsOverlap } from "./collisions";
import { sideDistances } from "./distances";
import { constrainToAxis, snapMeasurePoint } from "./measure";
import { frontDirection, localSolids, rotationFacing, worldRect } from "./shapes";
import { angleDiff, snapToWall } from "./snap";
import { currentAttempt, moveTo, refused, solvePlacement, type Mover, type PlacementContext } from "./solve";

const ap = ApartmentFile.parse(JSON.parse(readFileSync(new URL("../../../data/apartment.json", import.meta.url), "utf8")));
const index = indexApartment(ap);

const box = (name: string, size: [number, number, number], pos: [number, number, number], material = "body") => ({
  name,
  shape: "box",
  size: { x: size[0], y: size[1], z: size[2] },
  position: { x: pos[0], y: pos[1], z: pos[2] },
  material,
});

function item(id: string, dims: [number, number, number], extra: Record<string, unknown> = {}, parts?: unknown[]): CatalogueItem {
  const [w, d, h] = dims;
  return CatalogueItem.parse({
    schemaVersion: 1,
    id,
    name: id,
    category: "test",
    dimensions: { width: w, depth: d, height: h },
    placement: { type: "floor" },
    geometry: { type: "parametric", parts: parts ?? [box("body", [w, h, d], [0, h / 2, 0])] },
    materialSlots: { body: { default: "wood.oak-natural" } },
    ...extra,
  });
}

const sideboard = item("sideboard", [180, 45, 75], { surfaces: [{ name: "top", height: 75, width: 176, depth: 41 }] });
const lamp = item("lamp", [30, 30, 45], { placement: { type: "onTop" } });
const wardrobe = item("wardrobe", [150, 60, 220], { clearance: { front: 70 } });
const shelf = item("shelf", [80, 22, 36], { placement: { type: "wall", defaultElevation: 140 } });
const rug = item("rug", [200, 300, 1], { collision: "none" });
const table = item("table", [160, 90, 75], {}, [
  box("top", [160, 3, 90], [0, 73.5, 0]),
  { ...box("legs", [5, 72, 5], [-72.5, 36, -37.5]), repeat: { count: 2, step: { x: 145, y: 0, z: 0 } }, mirror: ["z"] },
]);
const chair = item("chair", [45, 50, 85], { clearance: { back: 60 } }, [
  box("seat", [45, 4, 45], [0, 43, 2.5]),
  box("back", [45, 40, 4], [0, 65, -23]),
  { ...box("legs", [3, 41, 3], [-21, 20.5, -23.5]), repeat: { count: 2, step: { x: 42, y: 0, z: 0 } }, mirror: ["z"] },
]);
const catalogue = new Map([sideboard, lamp, wardrobe, shelf, rug, table, chair].map((i) => [i.id, i]));
const lookup = (id: string) => catalogue.get(id);

const placed = (uid: string, itemId: string, position: Vec2, rotation = 0, extra: Partial<PlacedItem> = {}): PlacedItem => ({
  uid,
  item: itemId,
  position,
  rotation,
  ...extra,
});
const layout = (...items: PlacedItem[]): LayoutFile => ({ ...emptyLayout(), items });
const conflictsOf = (doc: LayoutFile, aids: Aids = DEFAULT_AIDS) =>
  layoutConflicts(doc, lookup, index, resolvePoses(doc, lookup, ap.ceilingHeight), { clearance: aids.clearance });
const ctx = (doc: LayoutFile, aids: Partial<Aids> = {}): PlacementContext => ({
  doc,
  lookup,
  ap: index,
  aids: { ...DEFAULT_AIDS, ...aids },
  poses: resolvePoses(doc, lookup, ap.ceilingHeight),
});

describe("convex geometry", () => {
  const square: Vec2[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it("measures overlap depth and separation", () => {
    expect(overlapDepth(square, square.map(([x, z]) => [x + 7, z + 2] as Vec2))).toBeCloseTo(3);
    expect(overlapDepth(square, square.map(([x, z]) => [x + 12, z] as Vec2))).toBeCloseTo(-2);
  });
  it("casts rays and tests points with either winding", () => {
    expect(rayToPolygon([-5, 5], [1, 0], square)).toBeCloseTo(5);
    expect(rayToPolygon([5, 5], [1, 0], square)).toBe(0);
    expect(rayToPolygon([-5, 50], [1, 0], square)).toBeUndefined();
    expect(insideConvex([10, 5], [...square].reverse())).toBe(true);
    expect(insideConvex([10.4, 5], square, 0.5)).toBe(true);
    expect(insideConvex([9.8, 5], square, -0.5)).toBe(false);
  });
  it("makes hulls from degenerate input and pushes circles out", () => {
    expect(convexHull([[1, 1]]).length).toBe(4);
    expect(convexHull([[0, 0], [5, 0], [10, 0]]).length).toBe(4);
    const push = pushCircleOut([12, 5], 5, square)!;
    expect(push[0]).toBeCloseTo(3);
    expect(pushCircleOut([20, 5], 5, square)).toBeUndefined();
    const out = pushCircleOut([9, 5], 2, square)!;
    expect(out[0]).toBeCloseTo(3);
  });
});

describe("collision shapes", () => {
  it("gives every repeated or mirrored part copy its own footprint and height range", () => {
    const fps = localSolids(table);
    expect(fps.length).toBe(5); // top + 4 legs
    const legs = fps.filter((f) => f.y1 < 73);
    expect(legs.length).toBe(4);
    expect(Math.min(...legs.flatMap((f) => f.poly.map((p) => p[0])))).toBeCloseTo(-75);
  });
  it("turns cylinders into 16-gons and skips rugs", () => {
    const cyl = partFootprints([{ name: "c", shape: "cylinder", radius: 10, height: 50, position: { x: 0, y: 25, z: 0 }, material: "m" }]);
    expect(cyl[0].poly.length).toBe(16);
    expect(cyl[0].y0).toBeCloseTo(0);
    expect(cyl[0].y1).toBeCloseTo(50);
    expect(localSolids(rug)).toEqual([]);
  });
  it("relates rotations and front directions", () => {
    expect(frontDirection(90)[0]).toBeCloseTo(-1);
    expect(rotationFacing([1, 0])).toBeCloseTo(270);
    expect(rotationFacing(frontDirection(123))).toBeCloseTo(123);
    expect(angleDiff(350, 10)).toBeCloseTo(-20);
  });
});

describe("apartment index", () => {
  it("has two faces per wall, swings for every door leaf and corners outside the walls", () => {
    expect(index.faces.length).toBe(ap.walls.length * 2);
    expect(index.swings.length).toBe(ap.openings.filter((o) => o.kind === "door").length);
    expect(index.obstacles.some((o) => o.kind === "fixture" && o.id === "column")).toBe(true);
    // a room corner of Zimmer 13.0 (inside face of the exterior wall meets the party wall)
    const near = (p: Vec2) => index.corners.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 2);
    expect(near([29.7, 281.7])).toBe(true);
    // Zimmer 15.9: its west wall stops 0.5 cm short of the south wall; the corner is where the faces meet
    const exact = (p: Vec2) => index.corners.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 0.05);
    expect(exact([761.4, 868.2])).toBe(true);
    expect(exact([761.4, 867.7])).toBe(false);
  });
  it("leaves door openings passable and keeps windows closed", () => {
    const door = ap.openings.find((o) => o.id === "d-entree-zimmer-15-9")!;
    const wall = ap.walls.find((w) => w.id === door.wall)!;
    const mid: Vec2 = [wall.start[0], wall.start[1] + door.centerFromStart]; // vertical wall
    const blocks = (p: Vec2, y: number) => index.obstacles.some((o) => o.kind === "wall" && o.y0 < y && o.y1 > y && insideConvex(p, o.poly));
    expect(blocks(mid, 100)).toBe(false);
    expect(blocks(mid, 230)).toBe(true); // lintel
  });
  it("opens interior doors up to 180° unless a wall or fixture stops a leaf, the others 90°", () => {
    const free = (id: string, deg: number) =>
      index.leaves.filter((l) => l.door === id).every((l) => !index.obstacles.some((ob) => solidsOverlap(leafSolid(l, deg), ob)));
    for (const o of ap.openings.filter((x) => x.door)) {
      const range = index.doors.get(o.id)!;
      const interior = !o.door!.isEntrance && !o.id.includes("balcony");
      expect(o.door!.maxOpening, o.id).toBe(interior ? 180 : undefined);
      expect(range.max, o.id).toBeGreaterThanOrEqual(90);
      expect(range.max, o.id).toBeLessThanOrEqual(o.door!.maxOpening ?? 90);
      if (!interior) expect(range.max, o.id).toBe(90);
      if (range.max > 90) expect(free(o.id, range.max), o.id).toBe(true);
      if (range.max < (o.door!.maxOpening ?? 90)) {
        // stopped one degree before the leaf would run into the wall or fixture it names
        expect(range.stoppedBy, o.id).toBeDefined();
        expect(free(o.id, range.max + 1), o.id).toBe(false);
      } else expect(range.stoppedBy, o.id).toBeUndefined();
    }
    expect([...index.doors.values()].filter((r) => r.max === 180).length).toBeGreaterThan(0);
  });
  it("widens a door's swing area as far as a layout opens the door, never below 90°", () => {
    const at = (id: string) => index.leaves.findIndex((l) => l.door === id);
    const open = [...index.doors].find(([, r]) => r.max === 180)![0];
    expect(doorSwings(index, undefined)).toBe(index.swings);
    expect(doorSwings(index, { [open]: 45 })).toBe(index.swings);
    const wide = doorSwings(index, { [open]: 180 });
    expect(wide.filter((s, i) => s !== index.swings[i]).map((s) => s.id)).toEqual([open]);
    // a half disc instead of a quarter
    expect(Math.abs(area(wide[at(open)].poly)) / Math.abs(area(index.swings[at(open)].poly))).toBeCloseTo(2, 2);
    // a door a wall stops only sweeps up to there
    const stopped = [...index.doors].find(([, r]) => r.stoppedBy);
    if (stopped) {
      const [id, range] = stopped;
      const capped = doorSwings(index, { [id]: 180 })[at(id)];
      expect(Math.abs(area(capped.poly)) / Math.abs(area(index.swings[at(id)].poly))).toBeCloseTo(range.max / 90, 2);
    }
  });
});

describe("wall snapping", () => {
  const face = index.faces.find((f) => f.id === "w-zimmer-13-0-exterior:left")!;
  it("turns a sideboard near a Zimmer 13.0 wall to the wall's 13.9° and puts it flush", () => {
    // 10 cm in front of the wall, not quite parallel
    const along = 96;
    const p: Vec2 = [face.a[0] + face.u[0] * along + face.n[0] * 32.5, face.a[1] + face.u[1] * along + face.n[1] * 32.5];
    const snap = snapToWall(p, 0, sideboard.dimensions, index.faces)!;
    expect(snap.face.id).toBe(face.id);
    expect(Math.abs(angleDiff(snap.rotation, -13.94))).toBeLessThan(0.1);
    const back = worldRect(sideboard, { x: snap.position[0], z: snap.position[1], rotation: snap.rotation }).slice(0, 2);
    for (const c of back) expect((c[0] - face.a[0]) * face.n[0] + (c[1] - face.a[1]) * face.n[1]).toBeCloseTo(0, 6);
  });
  it("does not snap when the item is far away or turned away", () => {
    const far: Vec2 = [face.a[0] + face.u[0] * 96 + face.n[0] * 80, face.a[1] + face.u[1] * 96 + face.n[1] * 80];
    expect(snapToWall(far, 0, sideboard.dimensions, index.faces)).toBeUndefined();
  });
  it("slides into a corner and applies the grid along the wall", () => {
    const doc = layout();
    // near the west end of the wall, 6 cm away from the party wall
    const sol = solvePlacement(sideboard, { point: [130, 280], rotation: 346 }, ctx(doc), new Set());
    expect(sol.snap).toBe("corner");
    const conflicts = conflictsOf(layout(placed("s", "sideboard", sol.placement.position, sol.placement.rotation)));
    expect(conflicts.get("s")?.filter((c) => c.hard) ?? []).toEqual([]);
  });
});

describe("collisions", () => {
  // living room, clear of walls, the kitchen (worktop from z ≈ 478) and the column ([822.7, 340.6])
  const free: Vec2 = [650, 400];
  it("lets a chair slide under the dining table but not its backrest", () => {
    // south of the table, facing it (rotation 180: front towards −z), seat 20 cm under the table top (edge at z 445)
    const under = layout(placed("t", "table", free), placed("c", "chair", [free[0], free[1] + 45 + 25 - 20], 180));
    expect(conflictsOf(under).get("c")?.filter((c) => c.hard) ?? []).toEqual([]);
    const tooFar = layout(placed("t", "table", free), placed("c", "chair", [free[0], free[1] + 15], 180)); // backrest under the top
    expect(conflictsOf(tooFar).get("c")).toContainEqual({ kind: "item", other: "t", hard: true });
  });
  it("flags a wardrobe pushed into the column, on both sides of the pair", () => {
    const doc = layout(placed("w", "wardrobe", [822.7, 340.6 + 30 + 5]));
    expect(conflictsOf(doc).get("w")).toContainEqual({ kind: "fixture", other: "column", hard: true });
    const pair = conflictsOf(layout(placed("a", "wardrobe", free), placed("b", "sideboard", [free[0] + 100, free[1]])));
    expect(pair.get("a")).toContainEqual({ kind: "item", other: "b", hard: true });
    expect(pair.get("b")).toContainEqual({ kind: "item", other: "a", hard: true });
  });
  it("ignores rugs, hidden items and items standing on each other", () => {
    const doc = layout(
      placed("r", "rug", free),
      placed("s", "sideboard", free),
      placed("l", "lamp", [0, 0], 0, { parent: { uid: "s", surface: 0 } }),
      placed("h", "wardrobe", free, 0, { hidden: true }),
    );
    const c = conflictsOf(doc);
    expect(c.get("r")).toBeUndefined();
    expect(c.get("l")).toBeUndefined();
    expect(c.get("s")).toBeUndefined();
  });
  it("warns about door swings, blocked clearance, wall items over openings and lamps on the floor", () => {
    const door = index.swings.find((s) => s.id === "d-entree-zimmer-15-9")!;
    const [cx, cz] = [(door.bounds.minX + door.bounds.maxX) / 2, (door.bounds.minZ + door.bounds.maxZ) / 2];
    expect(conflictsOf(layout(placed("x", "sideboard", [cx, cz], 90))).get("x")).toContainEqual({ kind: "door", other: door.id, hard: false });

    const blocked = conflictsOf(layout(placed("w", "wardrobe", free), placed("s", "sideboard", [free[0], free[1] + 30 + 40 + 22.5])));
    expect(blocked.get("w")).toContainEqual({ kind: "clearance", other: "s", hard: false, side: "front" });
    expect(clearanceZones(wardrobe, { x: 0, z: 0, y: 0, rotation: 0 })[0].solid.bounds.maxZ).toBeCloseTo(100);

    expect(conflictsOf(layout(placed("l", "lamp", free))).get("l")).toContainEqual({ kind: "no-surface", hard: false });
    expect(conflictsOf(layout(placed("sh", "shelf", free))).get("sh")).toContainEqual({ kind: "off-wall", hard: false });
  });
  it("flags furniture where a door folds back only in layouts that open the door that far", () => {
    const id = [...index.doors].find(([, r]) => r.max === 180)![0];
    const l = index.leaves.find((x) => x.door === id)!;
    // a small item beside the hinge, where the leaf passes at 150°
    const r = l.geometry.leafWidth * 0.6;
    const th = (150 * Math.PI) / 180;
    const p = l.at(l.leaf.x + l.leaf.dir * r * Math.cos(th), l.geometry.sgn * (l.thickness / 2 + r * Math.sin(th)));
    const doc = layout(placed("x", "lamp", p, 0));
    const door = { kind: "door", other: id, hard: false };
    expect(conflictsOf(doc).get("x")).not.toContainEqual(door);
    expect(conflictsOf({ ...doc, doors: { [id]: 120 } }).get("x")).not.toContainEqual(door);
    expect(conflictsOf({ ...doc, doors: { [id]: 180 } }).get("x")).toContainEqual(door);
  });
});

describe("collisions with real catalogue items", () => {
  const real = (id: string) => CatalogueItem.parse(JSON.parse(readFileSync(new URL(`../../../catalogue/${id}.json`, import.meta.url), "utf8")));
  const items = new Map(
    ["dining-table-160", "dining-chair", "wardrobe-150", "sideboard-180", "table-lamp-globe", "bistro-table-60", "bistro-chair"].map((id) => [id, real(id)]),
  );
  const look = (id: string) => items.get(id);
  const check = (doc: LayoutFile) => layoutConflicts(doc, look, index, resolvePoses(doc, look, ap.ceilingHeight));
  const hard = (doc: LayoutFile, uid: string) => (check(doc).get(uid) ?? []).filter((c) => c.hard);

  it("slides the dining chair's seat under the dining table", () => {
    // chair south of the table facing it; the table's edge is at z 445
    const chair = (z: number) => layout(placed("t", "dining-table-160", [650, 400]), placed("c", "dining-chair", [650, z], 180));
    expect(hard(chair(445 + 26 - 15), "c")).toEqual([]); // seat 15 cm under the top
    expect(hard(chair(400), "c").length).toBeGreaterThan(0); // pushed right through the table
  });
  it("flags the wardrobe in the column and lets a lamp stand on the sideboard", () => {
    expect(hard(layout(placed("w", "wardrobe-150", [822.7, 340.6 + 35])), "w")).toContainEqual({ kind: "fixture", other: "column", hard: true });
    const doc = layout(placed("s", "sideboard-180", [650, 400]), placed("l", "table-lamp-globe", [40, 0], 0, { parent: { uid: "s", surface: 0 } }));
    expect(check(doc).get("l")).toBeUndefined();
  });
  it("lets the bistro set stand on both round balconies; the railing still stops a chair, also in block mode", () => {
    for (const balcony of ["balcony-n", "balcony-se"]) {
      const railing = ap.fixtures.find((f) => f.id === `${balcony}-railing`)!;
      const rail = railing.parts.find((p) => p.name === "top rail");
      if (rail?.shape !== "lathe" || rail.arc === undefined) throw new Error(`${balcony}: expected a lathe top rail with an arc`);
      const inner = Math.min(...rail.profile.map(([r]) => r));
      // u: from the circle's centre to the middle of the railing (away from the façade), v: along the façade
      const a = ((railing.rotation + (rail.rotation?.y ?? 0) + rail.arc / 2) * Math.PI) / 180;
      const u: Vec2 = [Math.cos(a), Math.sin(a)];
      const v: Vec2 = [-u[1], u[0]];
      const at = (s: number, t: number): Vec2 => [railing.position[0] + u[0] * s + v[0] * t, railing.position[1] + u[1] * s + v[1] * t];
      const inward = rotationFacing([-u[0], -u[1]]);

      const set = layout(
        placed("t", "bistro-table-60", at(15, 0)),
        placed("c1", "bistro-chair", at(15, 60), rotationFacing([-v[0], -v[1]])),
        placed("c2", "bistro-chair", at(15, -60), rotationFacing(v)),
      );
      for (const uid of ["t", "c1", "c2"]) expect(hard(set, uid), `${balcony} ${uid}`).toEqual([]);
      const onRailing = layout(placed("c", "bistro-chair", at(inner, 0), inward));
      expect(hard(onRailing, "c"), balcony).toContainEqual({ kind: "fixture", other: railing.id, hard: true });

      const doc = layout(placed("c", "bistro-chair", at(0, 0), inward));
      const c: PlacementContext = {
        doc,
        lookup: look,
        ap: index,
        aids: { ...DEFAULT_AIDS, collisions: "block", wallSnap: false },
        poses: resolvePoses(doc, look, ap.ceilingHeight),
      };
      const m: Mover = { item: look("bistro-chair")!, uid: "c", moving: new Set(["c"]), isNew: false, before: new Map() };
      const across = moveTo(m, { point: at(50, 0), rotation: inward }, c, currentAttempt(m, c));
      expect(across.blocked, balcony).toBe(false);
      const out = moveTo(m, { point: at(inner, 0), rotation: inward }, c, across);
      expect(out.blocked, balcony).toBe(true);
      expect((out.conflicts.get("c") ?? []).filter((x) => x.hard), balcony).toEqual([]);
    }
  });
});

describe("placement solver", () => {
  const along = (faceId: string, s: number, off: number): Vec2 => {
    const f = index.faces.find((x) => x.id === faceId)!;
    return [f.a[0] + f.u[0] * s + f.n[0] * off, f.a[1] + f.u[1] * s + f.n[1] * off];
  };
  it("mounts wall items on the nearest wall and warns over a door", () => {
    const sol = solvePlacement(shelf, { point: along("w-zimmer-13-0-exterior:left", 96, 60), rotation: 0 }, ctx(layout()), new Set());
    expect(sol.face).toBe("w-zimmer-13-0-exterior:left");
    expect(conflictsOf(layout(placed("sh", "shelf", sol.placement.position, sol.placement.rotation))).get("sh")).toBeUndefined();

    const door = solvePlacement(shelf, { point: along("w-entree-living:left", 40, 50), rotation: 0 }, ctx(layout()), new Set());
    expect(door.face).toBe("w-entree-living:left");
    const doc = layout(placed("sh", "shelf", door.placement.position, door.placement.rotation));
    expect(conflictsOf(doc).get("sh")).toContainEqual({ kind: "opening", other: "d-entree-living", hard: false });
  });
  it("puts a lamp on the sideboard; the lamp follows when the sideboard turns", () => {
    let doc = layout(placed("s", "sideboard", [650, 400]), placed("l", "lamp", [0, 0]));
    const c = ctx(doc);
    const sol = solvePlacement(lamp, { point: [650 + 85, 400 + 3], rotation: 0 }, c, new Set(["l"]));
    expect(sol.placement.parent).toEqual({ uid: "s", surface: 0 });
    expect(sol.placement.position[0]).toBeCloseTo(88 - 15); // kept on the 176 cm top
    doc = setPlacement(doc, "l", sol.placement);
    doc = setRotation(doc, "s", 90);
    const lampPose = resolvePoses(doc, lookup, ap.ceilingHeight).get("l")!;
    expect(lampPose.x).toBeCloseTo(650 - 3);
    expect(lampPose.z).toBeCloseTo(400 + 73);
    expect(lampPose.y).toBe(75);
    expect(lampPose.rotation).toBe(90);
  });
  it("prefers the surface the pointer is on in 3D and leaves the floor for onTop items off surfaces", () => {
    const doc = layout(placed("s", "sideboard", [650, 400]));
    expect(solvePlacement(lamp, { point: [500, 300], rotation: 0 }, ctx(doc), new Set()).placement.parent).toBeUndefined();
    expect(solvePlacement(lamp, { point: [610, 425], rotation: 0, hint: { uid: "s", y: 75 } }, ctx(doc), new Set()).placement.parent).toEqual({
      uid: "s",
      surface: 0,
    });
  });
  it("snaps to the grid on the plan", () => {
    const sol = solvePlacement(wardrobe, { point: [903.4, 446.2], rotation: 0 }, ctx(layout(), { grid: true, gridSize: 10, wallSnap: false }), new Set());
    expect(sol.placement.position).toEqual([900, 450]);
  });
  it("stops at obstacles in block mode and slides along them", () => {
    // south of the column, in line with it
    const start: Vec2 = [822.7, 420];
    const doc = layout(placed("w", "wardrobe", start));
    const c = ctx(doc, { collisions: "block", wallSnap: false });
    const m: Mover = { item: wardrobe, uid: "w", moving: new Set(["w"]), isNew: false, before: new Map() };
    const first = moveTo(m, { point: start, rotation: 0 }, c);
    expect(first.blocked).toBe(false);
    // straight into the column: it stays; diagonally: it slides along x
    const into = moveTo(m, { point: [822.7, 370], rotation: 0 }, c, first);
    expect(into.blocked).toBe(true);
    expect(into.target.point).toEqual(start);
    const slide = moveTo(m, { point: [900, 370], rotation: 0 }, c, first);
    expect(slide.blocked).toBe(true);
    expect(slide.target.point).toEqual([900, 420]);
    // warn mode lets it through
    const warn = moveTo(m, { point: [822.7, 370], rotation: 0 }, ctx(doc, { wallSnap: false }), first);
    expect(warn.conflicts.get("w")).toContainEqual({ kind: "fixture", other: "column", hard: true });
  });

  it("keeps an item where it was if the very first step of a gesture is blocked", () => {
    // back 1 cm south of the column; the first pointer move goes 8 cm north, into it
    const start: Vec2 = [822.7, 379.3 + 1];
    const doc = layout(placed("w", "wardrobe", start));
    const c = ctx(doc, { collisions: "block", wallSnap: false });
    const m: Mover = { item: wardrobe, uid: "w", moving: new Set(["w"]), isNew: false, before: new Map() };
    const here = currentAttempt(m, c)!;
    expect(here.solution.placement.position).toEqual(start);
    expect(refused(here, m, c)).toBe(false);
    const step = moveTo(m, { point: [822.7, start[1] - 8], rotation: 0 }, c, here);
    expect(step.blocked).toBe(true);
    expect(step.solution.placement.position).toEqual(start);
    expect(refused(step, m, c)).toBe(false);
    // without a starting point the blocked attempt is returned, and must be refused
    const unseeded = moveTo(m, { point: [822.7, start[1] - 8], rotation: 0 }, c);
    expect(refused(unseeded, m, c)).toBe(true);
    expect(refused(unseeded, m, ctx(doc, { collisions: "warn", wallSnap: false }))).toBe(false);
  });
});

describe("measuring", () => {
  it("snaps to corners, then midpoints, then edges", () => {
    const targets = { corners: [[0, 0]] as Vec2[], edges: [[[0, 0], [100, 0]]] as [Vec2, Vec2][] };
    expect(snapMeasurePoint([2, 3], targets, 5)).toEqual({ point: [0, 0], kind: "corner" });
    expect(snapMeasurePoint([52, 3], targets, 5)).toEqual({ point: [50, 0], kind: "midpoint" });
    expect(snapMeasurePoint([30, 3], targets, 5)).toEqual({ point: [30, 0], kind: "edge" });
    expect(snapMeasurePoint([30, 30], targets, 5).kind).toBe("free");
    expect(constrainToAxis([0, 0], [10, 3])).toEqual([10, 0]);
  });
  it("measures from each side of an item to the nearest obstacle", () => {
    const pose = { x: 900, z: 450, y: 0, rotation: 0 };
    const wall = { poly: [[1000, 0], [1010, 0], [1010, 900], [1000, 900]] as Vec2[], y0: 0, y1: 250, bounds: { minX: 1000, maxX: 1010, minZ: 0, maxZ: 900 } };
    const d = sideDistances(wardrobe.dimensions, pose, [wall]);
    expect(d).toHaveLength(1);
    expect(d[0].side).toBe("right");
    expect(d[0].length).toBeCloseTo(25);
    // a table top above the item doesn't hide the wall behind it
    const top = { poly: [[850, 380], [1020, 380], [1020, 520], [850, 520]] as Vec2[], y0: 72, y1: 75, bounds: { minX: 850, maxX: 1020, minZ: 380, maxZ: 520 } };
    expect(sideDistances(wardrobe.dimensions, pose, [top, wall]).map((x) => x.side)).toEqual(["right"]);
  });
});

describe("aids", () => {
  it("reads stored settings with defaults and picks rotation steps", () => {
    expect(readAids(undefined)).toEqual(DEFAULT_AIDS);
    expect(readAids({ grid: true, gridSize: 7, collisions: "block" })).toMatchObject({ grid: true, gridSize: DEFAULT_AIDS.gridSize, collisions: "block" });
    expect(rotationStep(DEFAULT_AIDS, {})).toBe(15);
    expect(rotationStep(DEFAULT_AIDS, { shiftKey: true })).toBe(90);
    expect(rotationStep(DEFAULT_AIDS, { altKey: true })).toBe(0);
    expect(rotationStep({ rotationSnap: false }, {})).toBe(0);
  });
});
