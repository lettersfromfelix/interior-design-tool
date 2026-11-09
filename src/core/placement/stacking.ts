/** Stacking: items with `placement: onTop` stand on surfaces of other placed items and move with them. */
import { insideConvex } from "../geometry/convex";
import { normalizeRotation } from "../layout/commands";
import type { ItemLookup, WorldPose } from "../layout/poses";
import type { Surface } from "../schema/catalogue";
import type { Vec2 } from "../schema/common";
import type { LayoutFile } from "../schema/layout";
import type { Size } from "./snap";
import { rectCorners, rotatedExtents, toLocal, toWorld } from "./shapes";

/** A surface of a placed item, in the world. */
export interface WorldSurface {
  uid: string;
  /** Index into the catalogue item's `surfaces`. */
  index: number;
  /** Height above the floor. */
  y: number;
  /** World pose of the item the surface belongs to. */
  base: WorldPose;
  surface: Surface;
  /** Outline on the plan. */
  poly: Vec2[];
}

/** All surfaces of visible placed items, except those of `exclude` (the moving item and what stands on it). */
export function worldSurfaces(
  doc: Pick<LayoutFile, "items">,
  lookup: ItemLookup,
  poses: ReadonlyMap<string, WorldPose>,
  exclude: ReadonlySet<string>,
): WorldSurface[] {
  const out: WorldSurface[] = [];
  for (const p of doc.items) {
    if (exclude.has(p.uid) || p.hidden) continue;
    const surfaces = lookup(p.item)?.surfaces;
    const base = poses.get(p.uid);
    if (!surfaces || !base) continue;
    surfaces.forEach((surface, index) => {
      const [cx, cz] = surface.center ?? [0, 0];
      const poly = rectCorners(surface.width, surface.depth).map(([x, z]) => toWorld([x + cx, z + cz], base));
      out.push({ uid: p.uid, index, y: base.y + surface.height, base, surface, poly });
    });
  }
  return out;
}

const fits = (s: WorldSurface, height: number) => s.surface.maxItemHeight === undefined || height <= s.surface.maxItemHeight + 0.5;

/**
 * The surface an item of `height` goes on at `point`: the highest one under the point with enough free height.
 * With a `hint` (3D: the item and height the pointer is on), the surface of that item nearest to that height.
 */
export function pickSurface(
  point: Vec2,
  surfaces: readonly WorldSurface[],
  height: number,
  hint?: { uid: string; y: number },
): WorldSurface | undefined {
  if (hint) {
    const own = surfaces.filter((s) => s.uid === hint.uid && fits(s, height));
    if (own.length) return own.reduce((a, b) => (Math.abs(b.y - hint.y) < Math.abs(a.y - hint.y) ? b : a));
  }
  let best: WorldSurface | undefined;
  for (const s of surfaces) {
    if (fits(s, height) && insideConvex(point, s.poly, 1) && (!best || s.y > best.y)) best = s;
  }
  return best;
}

/**
 * Position and rotation relative to the base item for an item standing on surface `s` near the world `point`,
 * kept inside the surface (centred if it is too big for it).
 */
export function placeOnSurface(point: Vec2, worldRotation: number, size: Size, s: WorldSurface): { position: Vec2; rotation: number } {
  const rel = toLocal(point, s.base);
  const rotation = normalizeRotation(worldRotation - s.base.rotation);
  const [ex, ez] = rotatedExtents(size.width, size.depth, rotation);
  const [cx, cz] = s.surface.center ?? [0, 0];
  const keep = (v: number, c: number, half: number, e: number) => (half >= e ? Math.min(c + half - e, Math.max(c - half + e, v)) : c);
  return { position: [keep(rel[0], cx, s.surface.width / 2, ex), keep(rel[1], cz, s.surface.depth / 2, ez)], rotation };
}
