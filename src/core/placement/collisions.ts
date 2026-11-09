/**
 * Collision checks for placed furniture. Every item is a set of convex prisms (one per part); two items collide when
 * a prism of each overlaps the other by more than 0.5 cm, on the plan and in height. So a chair slides under a table
 * top, and a lamp can stand on a sideboard. Items standing on each other never collide with each other.
 */
import { overlapDepth, rectsOverlap, unionRect, type Rect2 } from "../geometry/convex";
import { parentProblem, type ItemLookup, type WorldPose } from "../layout/poses";
import type { CatalogueItem } from "../schema/catalogue";
import type { Vec2 } from "../schema/common";
import type { LayoutFile, PlacedItem } from "../schema/layout";
import type { ApartmentIndex, WallFace } from "./apartment";
import { angleDiff } from "./snap";
import { frontDirection, makeSolid, rotationFacing, toWorld, worldSolids, type Solid } from "./shapes";

/** Overlaps up to this much (cm) are ignored: touching is fine, and positions are stored to 0.1 cm. */
export const COLLISION_TOLERANCE = 0.5;

export type ConflictKind =
  /** overlaps another placed item */
  | "item"
  /** overlaps a wall */
  | "wall"
  /** overlaps the kitchen, a built-in, the column, … */
  | "fixture"
  /** stands where a door swings open (warning) */
  | "door"
  /** wall item over a window or door (warning) */
  | "opening"
  /** wall item that does not hang on a wall (warning) */
  | "off-wall"
  /** onTop item that stands on the floor although it needs a surface (warning) */
  | "no-surface"
  /** its clearance zone is blocked (warning) */
  | "clearance";

export interface Conflict {
  kind: ConflictKind;
  /** The other placed item (uid) or the apartment element (id). */
  other?: string;
  /** Hard: a real overlap (red; blocks in block mode). Soft: a warning (amber; never blocks). */
  hard: boolean;
  /** Clearance conflicts: the zone that is blocked. */
  side?: ClearanceSide;
}

/** A visible placed item with its world shape. */
export interface Body {
  uid: string;
  placed: PlacedItem;
  item: CatalogueItem;
  pose: WorldPose;
  solids: Solid[];
  /** Plan bounds of all solids (undefined without solids). */
  bounds?: Rect2;
}

export function bodiesOf(doc: Pick<LayoutFile, "items">, lookup: ItemLookup, poses: ReadonlyMap<string, WorldPose>): Body[] {
  const out: Body[] = [];
  for (const placed of doc.items) {
    const item = lookup(placed.item);
    const pose = poses.get(placed.uid);
    if (placed.hidden || !item || !pose) continue;
    const solids = worldSolids(item, pose);
    out.push({ uid: placed.uid, placed, item, pose, solids, bounds: solids.length ? unionRect(solids.map((s) => s.bounds)) : undefined });
  }
  return out;
}

const yOverlap = (a: Pick<Solid, "y0" | "y1">, b: Pick<Solid, "y0" | "y1">) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > COLLISION_TOLERANCE;

export function solidsOverlap(a: Solid, b: Solid): boolean {
  return yOverlap(a, b) && rectsOverlap(a.bounds, b.bounds, COLLISION_TOLERANCE) && overlapDepth(a.poly, b.poly) > COLLISION_TOLERANCE;
}

function anyOverlap(as: readonly Solid[], bs: readonly Solid[]): boolean {
  return as.some((a) => bs.some((b) => solidsOverlap(a, b)));
}

/** Items standing on `uid` (directly or not) and the items it stands on: they never collide with it. */
function relativesOf(doc: Pick<LayoutFile, "items">, lookup: ItemLookup): (a: string, b: string) => boolean {
  const byUid = new Map(doc.items.map((p) => [p.uid, p]));
  const ancestors = new Map<string, Set<string>>();
  const up = (uid: string): Set<string> => {
    let set = ancestors.get(uid);
    if (set) return set;
    set = new Set();
    ancestors.set(uid, set);
    const p = byUid.get(uid);
    if (p?.parent && !parentProblem(p, byUid, lookup)) {
      set.add(p.parent.uid);
      for (const a of up(p.parent.uid)) set.add(a);
    }
    return set;
  };
  return (a, b) => up(a).has(b) || up(b).has(a);
}

/** The wall face a wall item hangs on (its back flush against it), if any. */
export function hangsOn(body: Pick<Body, "item" | "pose">, faces: readonly WallFace[]): { face: WallFace; along: number } | undefined {
  const { pose, item } = body;
  const f = frontDirection(pose.rotation);
  const back: Vec2 = [pose.x - (f[0] * item.dimensions.depth) / 2, pose.z - (f[1] * item.dimensions.depth) / 2];
  for (const face of faces) {
    if (Math.abs(angleDiff(pose.rotation, rotationFacing(face.n))) > 1) continue;
    const gap = (back[0] - face.a[0]) * face.n[0] + (back[1] - face.a[1]) * face.n[1];
    if (Math.abs(gap) > 1) continue;
    const along = (pose.x - face.a[0]) * face.u[0] + (pose.z - face.a[1]) * face.u[1];
    if (along < -1 || along > face.length + 1) continue;
    return { face, along };
  }
  return undefined;
}

export type ClearanceSide = "front" | "back" | "left" | "right";

/**
 * Clearance zones next to the item's footprint, as floor areas up to the item's height. "left" and "right" are as
 * seen standing in front of the item, looking at it (right = +x).
 */
export function clearanceZones(item: CatalogueItem, pose: WorldPose): { side: ClearanceSide; solid: Solid }[] {
  const c = item.clearance;
  if (!c) return [];
  const { width: w, depth: d, height: h } = item.dimensions;
  const zone = (side: ClearanceSide, x0: number, x1: number, z0: number, z1: number) => ({
    side,
    solid: makeSolid(
      ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as Vec2[]).map((p) => toWorld(p, pose)),
      pose.y,
      pose.y + h,
    ),
  });
  const out: { side: ClearanceSide; solid: Solid }[] = [];
  if (c.front) out.push(zone("front", -w / 2, w / 2, d / 2, d / 2 + c.front));
  if (c.back) out.push(zone("back", -w / 2, w / 2, -d / 2 - c.back, -d / 2));
  if (c.right) out.push(zone("right", w / 2, w / 2 + c.right, -d / 2, d / 2));
  if (c.left) out.push(zone("left", -w / 2 - c.left, -w / 2, -d / 2, d / 2));
  return out;
}

export interface ConflictOptions {
  /** Only report conflicts of these items (and pairs involving them). Default: all. */
  only?: ReadonlySet<string>;
  /** Also check clearance zones (default true). */
  clearance?: boolean;
}

/**
 * All conflicts of the layout, by uid. Item pairs are reported on both items. Unknown and hidden items are ignored.
 */
export function layoutConflicts(
  doc: Pick<LayoutFile, "items">,
  lookup: ItemLookup,
  ap: ApartmentIndex,
  poses: ReadonlyMap<string, WorldPose>,
  options: ConflictOptions = {},
): Map<string, Conflict[]> {
  const bodies = bodiesOf(doc, lookup, poses);
  const related = relativesOf(doc, lookup);
  const only = options.only;
  const wanted = (uid: string) => !only || only.has(uid);
  const out = new Map<string, Conflict[]>();
  const add = (uid: string, c: Conflict) => {
    if (!wanted(uid)) return;
    const list = out.get(uid);
    if (list) list.push(c);
    else out.set(uid, [c]);
  };

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (!a.bounds || !b.bounds || (!wanted(a.uid) && !wanted(b.uid))) continue;
      if (!rectsOverlap(a.bounds, b.bounds, COLLISION_TOLERANCE) || related(a.uid, b.uid)) continue;
      if (anyOverlap(a.solids, b.solids)) {
        add(a.uid, { kind: "item", other: b.uid, hard: true });
        add(b.uid, { kind: "item", other: a.uid, hard: true });
      }
    }
  }

  const byUid = new Map(doc.items.map((p) => [p.uid, p]));
  for (const body of bodies) {
    if (!wanted(body.uid)) continue;
    const hit = new Set<string>();
    if (body.bounds) {
      for (const ob of ap.obstacles) {
        if (hit.has(ob.id) || !rectsOverlap(body.bounds, ob.bounds, COLLISION_TOLERANCE)) continue;
        if (body.solids.some((s) => solidsOverlap(s, ob))) {
          hit.add(ob.id);
          add(body.uid, { kind: ob.kind === "wall" ? "wall" : "fixture", other: ob.id, hard: true });
        }
      }
      for (const sw of ap.swings) {
        if (hit.has(sw.id) || !rectsOverlap(body.bounds, sw.bounds, COLLISION_TOLERANCE)) continue;
        if (body.solids.some((s) => solidsOverlap(s, sw))) {
          hit.add(sw.id);
          add(body.uid, { kind: "door", other: sw.id, hard: false });
        }
      }
    }

    const placement = body.item.placement;
    if (placement.type === "wall") {
      const on = hangsOn(body, ap.faces);
      if (!on) add(body.uid, { kind: "off-wall", hard: false });
      else {
        const half = body.item.dimensions.width / 2;
        const [y0, y1] = [body.pose.y, body.pose.y + body.item.dimensions.height];
        for (const o of on.face.openings) {
          const across = Math.min(on.along + half, o.to) - Math.max(on.along - half, o.from);
          const up = Math.min(y1, o.top) - Math.max(y0, o.sill);
          if (across > COLLISION_TOLERANCE && up > COLLISION_TOLERANCE) add(body.uid, { kind: "opening", other: o.id, hard: false });
        }
      }
    } else if (placement.type === "onTop" && !placement.alsoOnFloor) {
      const p = byUid.get(body.uid)!;
      if (!p.parent || parentProblem(p, byUid, lookup)) add(body.uid, { kind: "no-surface", hard: false });
    }

    if (options.clearance !== false) {
      for (const { side, solid } of clearanceZones(body.item, body.pose)) {
        const blocked = new Set<string>();
        for (const o of bodies) {
          if (o.uid === body.uid || !o.bounds || related(body.uid, o.uid)) continue;
          if (rectsOverlap(solid.bounds, o.bounds, COLLISION_TOLERANCE) && o.solids.some((s) => solidsOverlap(solid, s))) blocked.add(o.uid);
        }
        for (const ob of ap.obstacles) {
          if (!blocked.has(ob.id) && solidsOverlap(solid, ob)) blocked.add(ob.id);
        }
        for (const other of blocked) add(body.uid, { kind: "clearance", other, hard: false, side });
      }
    }
  }
  return out;
}

/** Hard conflicts with something the item did not already conflict with in `before`. */
export function newHardConflicts(now: readonly Conflict[] | undefined, before: readonly Conflict[] | undefined): Conflict[] {
  const had = new Set((before ?? []).filter((c) => c.hard).map((c) => `${c.kind}:${c.other}`));
  return (now ?? []).filter((c) => c.hard && !had.has(`${c.kind}:${c.other}`));
}
