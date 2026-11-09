/** Collision shapes of catalogue items: convex footprints with a height range, in the item's frame or the world. */
import { partFootprints, type Footprint } from "../catalogue/bounds";
import { boundsOf, overlapDepth, rectsOverlap, type Rect2 } from "../geometry/convex";
import { rotatePlan, type WorldPose } from "../layout/poses";
import type { CatalogueItem } from "../schema/catalogue";
import type { Vec2 } from "../schema/common";

/** A convex prism: floor area (plan cm) from height y0 to y1. */
export interface Solid {
  poly: Vec2[];
  y0: number;
  y1: number;
  bounds: Rect2;
}

export const makeSolid = (poly: Vec2[], y0: number, y1: number): Solid => ({ poly, y0, y1, bounds: boundsOf(poly) });

/** Overlaps up to this much (cm) are ignored: touching is fine, and positions are stored to 0.1 cm. */
export const COLLISION_TOLERANCE = 0.5;

const yOverlap = (a: Pick<Solid, "y0" | "y1">, b: Pick<Solid, "y0" | "y1">) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > COLLISION_TOLERANCE;

/** Two solids overlap by more than the tolerance, on the plan and in height. */
export function solidsOverlap(a: Solid, b: Solid): boolean {
  return yOverlap(a, b) && rectsOverlap(a.bounds, b.bounds, COLLISION_TOLERANCE) && overlapDepth(a.poly, b.poly) > COLLISION_TOLERANCE;
}

/** Rectangle of width × depth around the origin (x across, z deep), clockwise on the plan. */
export const rectCorners = (width: number, depth: number): Vec2[] => [
  [-width / 2, -depth / 2],
  [width / 2, -depth / 2],
  [width / 2, depth / 2],
  [-width / 2, depth / 2],
];

/** Plan direction an item's front (+z) faces at `rotation` degrees: f(θ) = (−sin θ, cos θ). */
export function frontDirection(rotation: number): Vec2 {
  const a = (rotation * Math.PI) / 180;
  return [-Math.sin(a), Math.cos(a)];
}

/** Rotation (degrees, [0, 360)) at which an item's front faces the plan direction `n`. */
export function rotationFacing(n: Vec2): number {
  const deg = (Math.atan2(-n[0], n[1]) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Item-frame point -> plan point. */
export function toWorld(p: Vec2, pose: Pick<WorldPose, "x" | "z" | "rotation">): Vec2 {
  const [dx, dz] = rotatePlan(p, pose.rotation);
  return [pose.x + dx, pose.z + dz];
}

/** Plan point -> item-frame point. */
export function toLocal(p: Vec2, pose: Pick<WorldPose, "x" | "z" | "rotation">): Vec2 {
  return rotatePlan([p[0] - pose.x, p[1] - pose.z], -pose.rotation);
}

const cache = new WeakMap<CatalogueItem, readonly Footprint[]>();

/** How an item collides: "parts" (default for parametric items), "box" (default for models) or "none" (rugs). */
export function collisionMode(item: CatalogueItem): "parts" | "box" | "none" {
  return item.collision ?? (item.geometry.type === "parametric" ? "parts" : "box");
}

/** The item's collision footprints in its own frame (cached per catalogue item). Empty for `collision: "none"`. */
export function localSolids(item: CatalogueItem): readonly Footprint[] {
  let s = cache.get(item);
  if (!s) {
    s = computeLocal(item);
    cache.set(item, s);
  }
  return s;
}

function computeLocal(item: CatalogueItem): Footprint[] {
  const mode = collisionMode(item);
  if (mode === "none") return [];
  if (mode === "parts") {
    const parts = item.geometry.type === "parametric" ? item.geometry.parts : item.collisionParts;
    if (parts?.length) return partFootprints(parts);
  }
  const { width, depth, height } = item.dimensions;
  return [{ poly: rectCorners(width, depth), y0: 0, y1: height }];
}

export function worldSolids(item: CatalogueItem, pose: WorldPose): Solid[] {
  return localSolids(item).map((f) => makeSolid(f.poly.map((p) => toWorld(p, pose)), pose.y + f.y0, pose.y + f.y1));
}

/** The item's `dimensions` footprint in the world (clockwise: back-left, back-right, front-right, front-left). */
export function worldRect(item: CatalogueItem, pose: Pick<WorldPose, "x" | "z" | "rotation">): Vec2[] {
  return rectCorners(item.dimensions.width, item.dimensions.depth).map((p) => toWorld(p, pose));
}

/** Half extents along the frame axes of a width × depth rectangle turned by `rotation` degrees. */
export function rotatedExtents(width: number, depth: number, rotation: number): Vec2 {
  const a = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return [(width / 2) * c + (depth / 2) * s, (width / 2) * s + (depth / 2) * c];
}
