/**
 * Door leaves in the host wall's local frame: x along the centre line from the wall's start, z across it
 * (+z = the wall's right side). Shared by the renderer (leaves, swing arcs) and placement (door-swing areas).
 */
import type { Opening, Wall } from "../schema/apartment";
import type { Vec2 } from "../schema/common";

/** Thickness of a door leaf (cm). */
export const DOOR_LEAF_THICKNESS = 4;

/** How far doors are open unless a layout says otherwise: 90°, as drawn on the plan. */
export const DOOR_OPEN = 90;

/** Wall-local [x, z] -> plan [x, z] (x along the centre line from the wall's start, +z = the wall's right side). */
export function wallToPlan(w: Pick<Wall, "start" | "end">): (x: number, z: number) => Vec2 {
  const L = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) || 1;
  const ux = (w.end[0] - w.start[0]) / L;
  const uz = (w.end[1] - w.start[1]) / L;
  return (x, z) => [w.start[0] + ux * x - uz * z, w.start[1] + uz * x + ux * z];
}

export interface DoorLeaf {
  /** Hinge position along the wall. */
  x: number;
  /** +1: the leaf closes towards larger x; −1: towards smaller x. */
  dir: 1 | -1;
}

export interface DoorGeometry {
  /** Opening from `a` to `b` along the wall. */
  a: number;
  b: number;
  jamb: number;
  leafWidth: number;
  /** +1: the leaves swing to the wall's right side, −1: to its left side. */
  sgn: 1 | -1;
  leaves: DoorLeaf[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Start of an opening along its wall (cm from the wall's start). */
export const openingStart = (o: Opening): number => Math.max(0, o.centerFromStart - o.width / 2);

export function doorGeometry(o: Opening): DoorGeometry | undefined {
  const d = o.door;
  if (!d) return undefined;
  const a = openingStart(o);
  const b = a + o.width;
  const leafWidth = d.leafWidth ?? (o.width - 8) / d.leaves;
  const jamb = clamp((o.width - d.leaves * leafWidth) / 2, 2, 8);
  const leaves: DoorLeaf[] =
    d.leaves === 2
      ? [
          { x: a + jamb, dir: 1 },
          { x: b - jamb, dir: -1 },
        ]
      : [d.hinge === "start" ? { x: a + jamb, dir: 1 } : { x: b - jamb, dir: -1 }];
  return { a, b, jamb, leafWidth, sgn: d.opensTo === "right" ? 1 : -1, leaves };
}

/**
 * Outline of a leaf's swing (a disc sector around the hinge) in wall-local [x, z], from the closed position to open
 * at `deg` degrees (default 90°, as on the plan; at most 180°, so the sector stays convex). `t` is the wall thickness.
 */
export function swingOutline(leaf: DoorLeaf, g: DoorGeometry, t: number, segments = 12, deg = DOOR_OPEN): [number, number][] {
  const pts: [number, number][] = [[leaf.x, (g.sgn * t) / 2]];
  const n = Math.max(1, Math.ceil((segments * deg) / DOOR_OPEN));
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.min(deg, 180) * (Math.PI / 180);
    pts.push([leaf.x + leaf.dir * g.leafWidth * Math.cos(th), g.sgn * (t / 2 + g.leafWidth * Math.sin(th))]);
  }
  return pts;
}

/**
 * The leaf (wall-local [x, z] corners) when it is open `deg` degrees: 0 = closed, lying in the opening flush with the
 * face it swings to; 90 = open as drawn on the plan; 180 = folded back flat against that face. It turns about its
 * hinge at [leaf.x, sgn·t/2].
 */
export function leafOutline(leaf: DoorLeaf, g: DoorGeometry, t: number, deg: number): [number, number][] {
  const th = (deg * Math.PI) / 180;
  const hx = leaf.x;
  const hz = (g.sgn * t) / 2;
  // along the leaf, from the hinge to its free edge, and across it (towards the opening when open)
  const d: Vec2 = [leaf.dir * Math.cos(th), g.sgn * Math.sin(th)];
  const m: Vec2 = [leaf.dir * Math.sin(th), -g.sgn * Math.cos(th)];
  const w = g.leafWidth;
  const k = DOOR_LEAF_THICKNESS;
  return [
    [hx, hz],
    [hx + w * d[0], hz + w * d[1]],
    [hx + w * d[0] + k * m[0], hz + w * d[1] + k * m[1]],
    [hx + k * m[0], hz + k * m[1]],
  ];
}
