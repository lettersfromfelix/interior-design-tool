/** What furniture placement needs to know about the fixed apartment: wall faces, obstacles and measuring points. */
import { DOOR_OPEN, doorGeometry, leafOutline, openingStart, swingOutline, type DoorGeometry, type DoorLeaf } from "../apartment/doors";
import { partFootprints } from "../catalogue/bounds";
import { convexHull, insideConvex } from "../geometry/convex";
import { direction, length } from "../geometry/polygon";
import type { ApartmentFile, Opening, Wall } from "../schema/apartment";
import type { Vec2 } from "../schema/common";
import { makeSolid, solidsOverlap, toWorld, type Solid } from "./shapes";

export interface FaceOpening {
  id: string;
  kind: Opening["kind"];
  /** Along the face, cm from its start `a`. */
  from: number;
  to: number;
  sill: number;
  top: number;
}

/** One side of a wall: the line furniture stands against. */
export interface WallFace {
  /** "<wallId>:left|right", the key layouts use for wall colours. */
  id: string;
  wall: string;
  side: "left" | "right";
  kind: Wall["kind"];
  a: Vec2;
  b: Vec2;
  /** Unit direction a -> b. */
  u: Vec2;
  /** Unit normal pointing away from the wall (into the room on this side). */
  n: Vec2;
  length: number;
  height: number;
  thickness: number;
  openings: FaceOpening[];
}

export interface Obstacle extends Solid {
  kind: "wall" | "fixture" | "door-swing";
  /** Element id: wall, fixture or door. */
  id: string;
}

/** How far a door can be opened. */
export interface DoorRange {
  /** Degrees: the door's `maxOpening` (default 90), or less where a leaf would run into a wall or fixture. */
  max: number;
  /** The wall or fixture that stops the door before its `maxOpening`. */
  stoppedBy?: string;
}

/** A door leaf with what it takes to work out where it is at any opening. */
export interface LeafSwing {
  door: string;
  leaf: DoorLeaf;
  geometry: DoorGeometry;
  /** Thickness of the wall the door is in. */
  thickness: number;
  /** Wall-local [x, z] -> plan [x, z]. */
  at: (x: number, z: number) => Vec2;
  /** Height range of the door opening. */
  y0: number;
  y1: number;
}

export interface ApartmentIndex {
  ceilingHeight: number;
  faces: WallFace[];
  /** Walls (open at doors, closed at windows) and fixtures: furniture must not overlap them. */
  obstacles: Obstacle[];
  /** Areas door leaves swing through at their normal 90°: overlapping them is only a warning. */
  swings: Obstacle[];
  /** Every door leaf, in the same order as `swings`. */
  leaves: LeafSwing[];
  /** How far each door (by id) can be opened. */
  doors: Map<string, DoorRange>;
  /** Points the tape measure snaps to: room corners, ends of openings, fixture corners. */
  corners: Vec2[];
  /** Segments the tape measure snaps to: wall faces and fixture outlines. */
  edges: [Vec2, Vec2][];
}

const cache = new WeakMap<ApartmentFile, ApartmentIndex>();

/** Index of the apartment (cached per apartment object). */
export function indexApartment(ap: ApartmentFile): ApartmentIndex {
  let idx = cache.get(ap);
  if (!idx) {
    idx = build(ap);
    cache.set(ap, idx);
  }
  return idx;
}

function build(ap: ApartmentFile): ApartmentIndex {
  const faces: WallFace[] = [];
  const obstacles: Obstacle[] = [];
  const swings: Obstacle[] = [];
  const leaves: LeafSwing[] = [];
  const wallCorners: Vec2[] = [];
  const edges: [Vec2, Vec2][] = [];
  const wallRects: Vec2[][] = [];
  const byWall = new Map<string, Opening[]>();
  for (const o of ap.openings) byWall.set(o.wall, [...(byWall.get(o.wall) ?? []), o]);

  for (const w of ap.walls) {
    const L = length(w.start, w.end);
    if (L < 1e-6) continue;
    const u = direction(w.start, w.end);
    const right: Vec2 = [-u[1], u[0]];
    const left: Vec2 = [u[1], -u[0]];
    const t = w.thickness;
    const h = w.height ?? ap.ceilingHeight;
    // wall-local x (along the centre line) and z (across it, + = right side) -> plan
    const at = (x: number, z: number): Vec2 => [w.start[0] + u[0] * x + right[0] * z, w.start[1] + u[1] * x + right[1] * z];
    const rect = (x0: number, x1: number): Vec2[] => [at(x0, -t / 2), at(x1, -t / 2), at(x1, t / 2), at(x0, t / 2)];
    wallRects.push(rect(0, L));
    const openings = (byWall.get(w.id) ?? [])
      .map((o) => ({ o, from: openingStart(o), to: Math.min(L, openingStart(o) + o.width) }))
      .sort((p, q) => p.from - q.from);

    // the wall as obstacles, open at doors; windows stay closed (the glass is in the way too)
    const piece = (x0: number, x1: number, y0: number, y1: number) => {
      if (x1 - x0 > 0.01 && y1 - y0 > 0.01) obstacles.push({ kind: "wall", id: w.id, ...makeSolid(rect(x0, x1), y0, y1) });
    };
    let cursor = 0;
    for (const { o, from, to } of openings) {
      if (o.kind !== "door") continue;
      piece(cursor, from, 0, h);
      piece(from, to, 0, o.sill);
      piece(from, to, o.sill + o.height, h);
      cursor = Math.max(cursor, to);
      const g = doorGeometry(o)!;
      for (const leaf of g.leaves) {
        const swing: LeafSwing = { door: o.id, leaf, geometry: g, thickness: t, at, y0: o.sill, y1: o.sill + o.height };
        leaves.push(swing);
        swings.push(swingArea(swing, DOOR_OPEN));
      }
    }
    piece(cursor, L, 0, h);

    for (const side of ["left", "right"] as const) {
      const z = side === "right" ? t / 2 : -t / 2;
      const a = at(0, z);
      const b = at(L, z);
      faces.push({
        id: `${w.id}:${side}`,
        wall: w.id,
        side,
        kind: w.kind,
        a,
        b,
        u,
        n: side === "right" ? right : left,
        length: L,
        height: h,
        thickness: t,
        openings: openings.map(({ o, from, to }) => ({ id: o.id, kind: o.kind, from, to, sill: o.sill, top: o.sill + o.height })),
      });
      edges.push([a, b]);
      wallCorners.push(a, b);
      for (const { from, to } of openings) wallCorners.push(at(from, z), at(to, z));
    }
  }

  // inner room corners where two faces meet without a wall end there (walls joined at their centre lines)
  const meets: Vec2[] = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const p = faces[i];
      const q = faces[j];
      if (p.wall === q.wall) continue;
      const den = p.u[0] * q.u[1] - p.u[1] * q.u[0];
      if (Math.abs(den) < 0.2) continue; // (nearly) parallel
      const dx = q.a[0] - p.a[0];
      const dz = q.a[1] - p.a[1];
      const s = (dx * q.u[1] - dz * q.u[0]) / den;
      const r = (dx * p.u[1] - dz * p.u[0]) / den;
      const margin = Math.max(p.thickness, q.thickness) + 1;
      if (s < -margin || s > p.length + margin || r < -margin || r > q.length + margin) continue;
      meets.push([p.a[0] + p.u[0] * s, p.a[1] + p.u[1] * s]);
    }
  }
  // where two faces meet, that is the corner: wall ends a few millimetres off it (walls that don't quite touch in the
  // data) would only compete with it
  const offCorner = (c: Vec2) => !meets.some((m) => Math.hypot(m[0] - c[0], m[1] - c[1]) < 2);
  const visible = (c: Vec2) => !wallRects.some((r) => insideConvex(c, r, -0.5)); // points inside a wall are no use
  const corners = [...meets, ...wallCorners.filter(offCorner)].filter(visible);

  for (const f of ap.fixtures) {
    const pose = { x: f.position[0], z: f.position[1], rotation: f.rotation };
    const y = f.elevation ?? 0;
    for (const fp of partFootprints(f.parts)) {
      const poly = fp.poly.map((p) => toWorld(p, pose));
      if (f.collides !== false) obstacles.push({ kind: "fixture", id: f.id, ...makeSolid(poly, y + fp.y0, y + fp.y1) });
      if (poly.length <= 8) corners.push(...poly);
      poly.forEach((p, i) => edges.push([p, poly[(i + 1) % poly.length]]));
    }
  }

  const doors = new Map<string, DoorRange>();
  for (const o of ap.openings) {
    if (o.door) doors.set(o.id, doorRange(o.door.maxOpening ?? DOOR_OPEN, leaves.filter((l) => l.door === o.id), obstacles));
  }

  return { ceilingHeight: ap.ceilingHeight, faces, obstacles, swings, leaves, doors, corners: dedupe(corners), edges };
}

/** The area a leaf sweeps from closed to `deg` degrees open. */
function swingArea(l: LeafSwing, deg: number): Obstacle {
  const poly = convexHull(swingOutline(l.leaf, l.geometry, l.thickness, 12, deg).map(([x, z]) => l.at(x, z)));
  return { kind: "door-swing", id: l.door, ...makeSolid(poly, l.y0, l.y1) };
}

/** The leaf as a solid when it is `deg` degrees open. */
export function leafSolid(l: LeafSwing, deg: number): Solid {
  return makeSolid(
    leafOutline(l.leaf, l.geometry, l.thickness, deg).map(([x, z]) => l.at(x, z)),
    l.y0,
    l.y1,
  );
}

/** Open the leaves degree by degree beyond 90° up to `want`, until one would run into a wall or a fixture. */
function doorRange(want: number, leaves: readonly LeafSwing[], obstacles: readonly Obstacle[]): DoorRange {
  for (let deg = DOOR_OPEN + 1; deg <= want; deg++) {
    for (const l of leaves) {
      const solid = leafSolid(l, deg);
      const hit = obstacles.find((ob) => solidsOverlap(solid, ob));
      if (hit) return { max: deg - 1, stoppedBy: hit.id };
    }
  }
  return { max: want };
}

/** How far the layout shows a door open: its `doors` entry (default 90°), within what the door can do. */
export function shownOpening(index: ApartmentIndex, open: Readonly<Record<string, number>> | undefined, doorId: string): number {
  const max = index.doors.get(doorId)?.max ?? DOOR_OPEN;
  return Math.min(max, Math.max(0, open?.[doorId] ?? DOOR_OPEN));
}

const wideSwings = new WeakMap<ApartmentIndex, Map<string, Obstacle>>();

/**
 * The areas the door leaves sweep in a layout: always their normal 90° swing, so furniture leaves room to open a door
 * (even when the layout shows it closed), and further where the layout opens a door further.
 */
export function doorSwings(index: ApartmentIndex, open: Readonly<Record<string, number>> | undefined): Obstacle[] {
  if (!open || !index.leaves.some((l) => shownOpening(index, open, l.door) > DOOR_OPEN)) return index.swings;
  let cache = wideSwings.get(index);
  if (!cache) wideSwings.set(index, (cache = new Map()));
  return index.leaves.map((l, i) => {
    const deg = shownOpening(index, open, l.door);
    if (deg <= DOOR_OPEN) return index.swings[i];
    const key = `${i}:${deg}`;
    let area = cache.get(key);
    if (!area) cache.set(key, (area = swingArea(l, deg)));
    return area;
  });
}

/** Drop points closer than 0.5 cm to an earlier one. */
function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
