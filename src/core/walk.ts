/**
 * Walking through the apartment in first person (plan cm): where you start, and what stops you. Walls, door leaves
 * (as far as the layout shows them open), fixtures and, optionally, furniture block the way; you slide along them.
 */
import { doorGeometry, leafOutline, wallToPlan } from "./apartment/doors";
import { pushCircleOut, rayToPolygon } from "./geometry/convex";
import { area, direction, labelPoint } from "./geometry/polygon";
import { DOOR_OPEN } from "./layout/commands";
import type { ItemLookup, WorldPose } from "./layout/poses";
import { indexApartment } from "./placement/apartment";
import { bodiesOf } from "./placement/collisions";
import { makeSolid, type Solid } from "./placement/shapes";
import type { ApartmentFile } from "./schema/apartment";
import type { Vec2 } from "./schema/common";
import type { LayoutFile } from "./schema/layout";

/** Half the width of your shoulders, cm. */
export const BODY_RADIUS = 20;
/** You step over anything lower than this (rugs, door sills), cm. */
export const STEP_HEIGHT = 20;
/** Longest move checked in one go, so you can't slip through a wall when the frame rate drops. */
const MAX_STEP = 5;

export interface WalkStart {
  position: Vec2;
  /** Plan direction you look in (unit vector). */
  facing: Vec2;
}

/**
 * Just inside the entrance door (or in the middle of the largest room), looking the way you can see furthest
 * (within 90° of straight in): when the door is in the side of a corridor, that is along the corridor.
 */
export function walkStart(ap: ApartmentFile): WalkStart {
  const rooms = new Map(ap.rooms.map((r) => [r.id, r]));
  const indoor = (id: string | undefined) => !!id && rooms.get(id)?.kind === "indoor";
  const entrance = ap.openings.find((o) => o.door?.isEntrance);
  const wall = entrance && ap.walls.find((w) => w.id === entrance.wall);
  let position: Vec2;
  let inward: Vec2;
  if (entrance && wall) {
    const u = direction(wall.start, wall.end);
    // into the apartment: towards the side with an indoor room (the other side is the staircase)
    const s = indoor(wall.sides?.left) && !indoor(wall.sides?.right) ? -1 : 1;
    inward = [-u[1] * s, u[0] * s];
    const [x, z] = wallToPlan(wall)(entrance.centerFromStart, 0);
    const d = wall.thickness / 2 + 60;
    position = [x + inward[0] * d, z + inward[1] * d];
  } else {
    const inside = ap.rooms.filter((r) => r.kind === "indoor");
    const room = (inside.length ? inside : ap.rooms).reduce((a, b) => (area(b.outline) > area(a.outline) ? b : a));
    position = labelPoint(room.outline);
    inward = [0, -1];
  }
  const walls = indexApartment(ap).obstacles.filter((o) => o.y1 > STEP_HEIGHT && o.y0 < 170);
  const view = (dir: Vec2) => Math.min(1000, ...walls.map((o) => rayToPolygon(position, dir, o.poly) ?? Infinity));
  let facing = inward;
  let best = view(inward) * 1.1; // straight in wins unless another way is clearly more open
  for (const deg of [-90, -45, 45, 90]) {
    const a = (deg * Math.PI) / 180;
    const dir: Vec2 = [inward[0] * Math.cos(a) - inward[1] * Math.sin(a), inward[0] * Math.sin(a) + inward[1] * Math.cos(a)];
    const d = view(dir);
    if (d > best) {
      best = d;
      facing = dir;
    }
  }
  return { position, facing };
}

export interface WalkOptions {
  /** Bump into furniture too. */
  furniture: boolean;
  eyeHeight: number;
}

/** Everything that stops you, as solids that reach from above the step height to your head. */
export function walkSolids(
  ap: ApartmentFile,
  doc: Pick<LayoutFile, "items" | "doors">,
  lookup: ItemLookup,
  poses: ReadonlyMap<string, WorldPose>,
  options: WalkOptions,
): Solid[] {
  const head = options.eyeHeight + 10;
  const inTheWay = (s: Solid) => s.y1 > STEP_HEIGHT && s.y0 < head;
  // walls (open at doors, closed at windows) and fixtures
  const out: Solid[] = indexApartment(ap).obstacles.filter(inTheWay);
  const walls = new Map(ap.walls.map((w) => [w.id, w]));
  for (const o of ap.openings) {
    const g = doorGeometry(o);
    const w = walls.get(o.wall);
    if (!g || !w) continue;
    const at = wallToPlan(w);
    const deg = doc.doors?.[o.id] ?? DOOR_OPEN;
    for (const leaf of g.leaves) {
      const poly = leafOutline(leaf, g, w.thickness, deg).map(([x, z]) => at(x, z));
      const s = makeSolid(poly, o.sill, o.sill + o.height);
      if (inTheWay(s)) out.push(s);
    }
  }
  if (options.furniture) {
    for (const body of bodiesOf(doc, lookup, poses)) out.push(...body.solids.filter(inTheWay));
  }
  return out;
}

/** Push a standing position out of everything it overlaps. */
export function standClear(p: Vec2, solids: readonly Solid[], radius = BODY_RADIUS): Vec2 {
  let [x, z] = p;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const s of solids) {
      const b = s.bounds;
      if (x < b.minX - radius || x > b.maxX + radius || z < b.minZ - radius || z > b.maxZ + radius) continue;
      const push = pushCircleOut([x, z], radius, s.poly);
      if (!push) continue;
      x += push[0];
      z += push[1];
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Walk from `from` by `delta` (plan cm), sliding along whatever is in the way. */
export function walkStep(from: Vec2, delta: Vec2, solids: readonly Solid[], radius = BODY_RADIUS): Vec2 {
  const steps = Math.max(1, Math.ceil(Math.hypot(delta[0], delta[1]) / MAX_STEP));
  let p = from;
  for (let i = 0; i < steps; i++) p = standClear([p[0] + delta[0] / steps, p[1] + delta[1] / steps], solids, radius);
  return p;
}
